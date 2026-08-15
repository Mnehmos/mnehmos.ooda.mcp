import { describe, it, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { handleBatchTools } from './batchDispatcher.js';
import { getToolDefinition, validateToolName } from './actionEnum.js';
import { closeDb } from '../storage/db.js';

const TEST_DIR = path.join(os.tmpdir(), 'batch-dispatcher-test-' + Date.now());

/**
 * Parse the markdown-formatted batch_tools result text back into a structured
 * summary for test assertions. The markdown format is the user-facing shape;
 * tests verify semantics (success/fail counts, per-operation outcomes) not
 * exact string formatting.
 */
function parseBatchMarkdown(text: string): {
    executionMode: string;
    total: number;
    successful: number;
    failed: number;
    results: Array<{ index: number; tool: string; label?: string; success: boolean; error?: string }>;
} {
    const mode = text.match(/\*\*Execution Mode:\*\*\s*(\w+)/)?.[1] ?? '';
    const total = parseInt(text.match(/\*\*Total Operations:\*\*\s*(\d+)/)?.[1] ?? '0');
    const successful = parseInt(text.match(/\*\*Successful:\*\*\s*(\d+)/)?.[1] ?? '0');
    const failed = parseInt(text.match(/\*\*Failed:\*\*\s*(\d+)/)?.[1] ?? '0');

    // Each result is rendered as: **N.** `tool`[(label)] - ✅/❌ status
    // Followed by optional ```code block``` or **Error:** message
    const resultRegex = /\*\*(\d+)\.\*\*\s*`([^`]+)`(?:\s*\(([^)]+)\))?\s*-\s*(✅ Success|❌ Failed)/g;
    const results: any[] = [];
    let match;
    while ((match = resultRegex.exec(text)) !== null) {
        const index = parseInt(match[1]) - 1;
        const tool = match[2];
        const label = match[3];
        const success = match[4].startsWith('✅');

        // Find the error line if this was a failure. It follows the status line.
        let error: string | undefined;
        if (!success) {
            const resultStart = match.index + match[0].length;
            const nextResult = text.slice(resultStart).match(/\*\*\d+\.\*\*/);
            const resultEnd = nextResult
                ? resultStart + nextResult.index!
                : text.length;
            const currentResult = text.slice(resultStart, resultEnd);
            const errMatch = currentResult.match(/\*\*Error:\*\*\s*([^\n]+)/);
            if (errMatch) error = errMatch[1];
        }

        results.push({ index, tool, label, success, error });
    }

    return { executionMode: mode, total, successful, failed, results };
}

describe('batchDispatcher', () => {
    beforeEach(() => {
        if (!fs.existsSync(TEST_DIR)) {
            fs.mkdirSync(TEST_DIR, { recursive: true });
        }
    });

    afterEach(() => {
        if (fs.existsSync(TEST_DIR)) {
            fs.rmSync(TEST_DIR, { recursive: true, force: true });
        }
    });    describe('handleBatchTools', () => {
        it('should execute multiple read_file operations in parallel', async () => {
            const file1 = path.join(TEST_DIR, 'file1.txt');
            const file2 = path.join(TEST_DIR, 'file2.txt');
            fs.writeFileSync(file1, 'Content of file 1');
            fs.writeFileSync(file2, 'Content of file 2');

            const result = await handleBatchTools({
                operations: [
                    { tool: 'read_file', args: { path: file1 }, label: 'file1' },
                    { tool: 'read_file', args: { path: file2 }, label: 'file2' }
                ],
                executionMode: 'parallel'
            });

            const parsed = parseBatchMarkdown(result.content[0].text);

            assert.strictEqual(parsed.total, 2);
            assert.strictEqual(parsed.successful, 2);
            assert.strictEqual(parsed.failed, 0);
            assert.strictEqual(parsed.results.length, 2);
            assert.strictEqual(parsed.results[0].success, true);
            assert.strictEqual(parsed.results[1].success, true);
        });

        it('should execute operations sequentially when specified', async () => {
            const file1 = path.join(TEST_DIR, 'seq1.txt');
            const file2 = path.join(TEST_DIR, 'seq2.txt');

            const result = await handleBatchTools({
                operations: [
                    { tool: 'write_file', args: { path: file1, content: 'First' } },
                    { tool: 'write_file', args: { path: file2, content: 'Second' } }
                ],
                executionMode: 'sequential'
            });

            const parsed = parseBatchMarkdown(result.content[0].text);

            assert.strictEqual(parsed.total, 2);
            assert.strictEqual(parsed.successful, 2);
            assert.strictEqual(parsed.executionMode, 'sequential');

            assert.strictEqual(fs.readFileSync(file1, 'utf-8'), 'First');
            assert.strictEqual(fs.readFileSync(file2, 'utf-8'), 'Second');
        });

        it('should stop on error in sequential mode when stopOnError is true', async () => {
            const file1 = path.join(TEST_DIR, 'stop1.txt');
            const nonexistent = path.join(TEST_DIR, 'nonexistent', 'file.txt');
            const file3 = path.join(TEST_DIR, 'stop3.txt');

            const result = await handleBatchTools({
                operations: [
                    { tool: 'write_file', args: { path: file1, content: 'Success' } },
                    { tool: 'read_file', args: { path: nonexistent } },
                    { tool: 'write_file', args: { path: file3, content: 'Should not run' } }
                ],
                executionMode: 'sequential',
                stopOnError: true
            });

            const parsed = parseBatchMarkdown(result.content[0].text);

            assert.strictEqual(parsed.successful, 1);
            assert.strictEqual(parsed.failed, 1);
            assert.strictEqual(parsed.results.length, 2);
            assert.strictEqual(fs.existsSync(file3), false);
        });

        it('should continue on error when stopOnError is false', async () => {
            const file1 = path.join(TEST_DIR, 'cont1.txt');
            const nonexistent = path.join(TEST_DIR, 'nonexistent', 'file.txt');
            const file3 = path.join(TEST_DIR, 'cont3.txt');

            const result = await handleBatchTools({
                operations: [
                    { tool: 'write_file', args: { path: file1, content: 'Success' } },
                    { tool: 'read_file', args: { path: nonexistent } },
                    { tool: 'write_file', args: { path: file3, content: 'Should run' } }
                ],
                executionMode: 'sequential',
                stopOnError: false
            });

            const parsed = parseBatchMarkdown(result.content[0].text);

            assert.strictEqual(parsed.successful, 2);
            assert.strictEqual(parsed.failed, 1);
            assert.strictEqual(parsed.results.length, 3);
            assert.strictEqual(fs.existsSync(file3), true);
        });

        it('should reject unknown tools with helpful error', async () => {
            const result = await handleBatchTools({
                operations: [
                    { tool: 'unknown_tool_xyz', args: {} }
                ]
            });

            const parsed = parseBatchMarkdown(result.content[0].text);

            assert.strictEqual(parsed.failed, 1);
            assert.strictEqual(parsed.results[0].success, false);
            assert.ok(parsed.results[0].error?.includes('Unknown tool'));
        });

        it('should reject nested batch_tools operations', async () => {
            const result = await handleBatchTools({
                operations: [
                    { tool: 'batch_tools', args: { operations: [] } }
                ]
            });

            const parsed = parseBatchMarkdown(result.content[0].text);

            assert.strictEqual(parsed.failed, 1);
            assert.ok(parsed.results[0].error?.includes('Nested batch_tools is not allowed'));
        });

        it('should only resolve own tool registry properties', () => {
            assert.strictEqual(validateToolName('read_file'), true);
            assert.strictEqual(validateToolName('toString'), false);
            assert.strictEqual(getToolDefinition('constructor'), undefined);
        });

        it('should preserve operation labels in results', async () => {
            const file = path.join(TEST_DIR, 'labeled.txt');
            fs.writeFileSync(file, 'Test content');

            const result = await handleBatchTools({
                operations: [
                    { tool: 'read_file', args: { path: file }, label: 'my-custom-label' }
                ]
            });

            const parsed = parseBatchMarkdown(result.content[0].text);

            assert.strictEqual(parsed.results[0].label, 'my-custom-label');
        });

        it('should enforce maxOperations limit', async () => {
            const operations = Array(100).fill(null).map((_, i) => ({
                tool: 'list_directory',
                args: { path: TEST_DIR }
            }));

            try {
                await handleBatchTools({
                    operations,
                    safetyLimits: { maxOperations: 10 }
                });
                assert.fail('Should have thrown an error');
            } catch (error: any) {
                assert.ok(error.message.includes('exceeds limit'));
            }
        });

        // REGRESSION TEST — this is exactly the case that was broken pre-fix.
        // Mixed tool types in a batch previously crashed with
        // "result.content.split is not a function" because the dispatcher
        // assumed read_file returned { content: string } rather than the real
        // MCP shape { content: [{type:'text', text:string}] }.
        it('should handle mixed tool types without crashing (regression)', async () => {
            const file = path.join(TEST_DIR, 'mixed.txt');
            fs.writeFileSync(file, 'Mixed test');

            const result = await handleBatchTools({
                operations: [
                    { tool: 'read_file', args: { path: file } },
                    { tool: 'list_directory', args: { path: TEST_DIR } },
                    { tool: 'file_info', args: { path: file } }
                ]
            });

            const parsed = parseBatchMarkdown(result.content[0].text);

            assert.strictEqual(parsed.total, 3);
            // All three must succeed. Pre-fix, at least one crashed silently.
            assert.strictEqual(parsed.successful, 3);
            assert.strictEqual(parsed.failed, 0);
        });

        it('should report elapsed time', async () => {
            const result = await handleBatchTools({
                operations: [
                    { tool: 'list_directory', args: { path: TEST_DIR } }
                ]
            });

            const text = result.content[0].text;
            const elapsedMatch = text.match(/\*\*Elapsed Time:\*\*\s*(\d+)ms/);
            assert.ok(elapsedMatch, 'Elapsed time should be present in output');
            const elapsed = parseInt(elapsedMatch![1]);
            assert.ok(elapsed >= 0);
        });

        it('should default to parallel execution mode', async () => {
            const result = await handleBatchTools({
                operations: [
                    { tool: 'list_directory', args: { path: TEST_DIR } }
                ]
            });

            const parsed = parseBatchMarkdown(result.content[0].text);
            assert.strictEqual(parsed.executionMode, 'parallel');
        });
    });
});
