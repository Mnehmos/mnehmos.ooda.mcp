import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { handleBatchTools } from './batchDispatcher.js';

// Test directory for file operations
const TEST_DIR = path.join(os.tmpdir(), 'batch-dispatcher-test-' + Date.now());

describe('batchDispatcher', () => {
    beforeEach(() => {
        // Create test directory
        if (!fs.existsSync(TEST_DIR)) {
            fs.mkdirSync(TEST_DIR, { recursive: true });
        }
    });

    afterEach(() => {
        // Cleanup test directory
        if (fs.existsSync(TEST_DIR)) {
            fs.rmSync(TEST_DIR, { recursive: true, force: true });
        }
    });

    describe('handleBatchTools', () => {
        it('should execute multiple read_file operations in parallel', async () => {
            // Create test files
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

            const parsed = JSON.parse(result.content[0].text);
            
            assert.strictEqual(parsed.summary.total, 2);
            assert.strictEqual(parsed.summary.successful, 2);
            assert.strictEqual(parsed.summary.failed, 0);
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

            const parsed = JSON.parse(result.content[0].text);
            
            assert.strictEqual(parsed.summary.total, 2);
            assert.strictEqual(parsed.summary.successful, 2);
            assert.strictEqual(parsed.summary.executionMode, 'sequential');
            
            // Verify files were created
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
                    { tool: 'read_file', args: { path: nonexistent } }, // Will fail
                    { tool: 'write_file', args: { path: file3, content: 'Should not run' } }
                ],
                executionMode: 'sequential',
                stopOnError: true
            });

            const parsed = JSON.parse(result.content[0].text);
            
            assert.strictEqual(parsed.summary.successful, 1);
            assert.strictEqual(parsed.summary.failed, 1);
            // Third operation should not have run
            assert.strictEqual(parsed.results.length, 2);
            
            // Verify file3 was not created
            assert.strictEqual(fs.existsSync(file3), false);
        });

        it('should continue on error when stopOnError is false', async () => {
            const file1 = path.join(TEST_DIR, 'cont1.txt');
            const nonexistent = path.join(TEST_DIR, 'nonexistent', 'file.txt');
            const file3 = path.join(TEST_DIR, 'cont3.txt');

            const result = await handleBatchTools({
                operations: [
                    { tool: 'write_file', args: { path: file1, content: 'Success' } },
                    { tool: 'read_file', args: { path: nonexistent } }, // Will fail
                    { tool: 'write_file', args: { path: file3, content: 'Should run' } }
                ],
                executionMode: 'sequential',
                stopOnError: false
            });

            const parsed = JSON.parse(result.content[0].text);
            
            assert.strictEqual(parsed.summary.successful, 2);
            assert.strictEqual(parsed.summary.failed, 1);
            assert.strictEqual(parsed.results.length, 3);
            
            // Verify file3 was created
            assert.strictEqual(fs.existsSync(file3), true);
        });

        it('should reject unknown tools with helpful error', async () => {
            const result = await handleBatchTools({
                operations: [
                    { tool: 'unknown_tool_xyz', args: {} }
                ]
            });

            const parsed = JSON.parse(result.content[0].text);
            
            assert.strictEqual(parsed.summary.failed, 1);
            assert.strictEqual(parsed.results[0].success, false);
            assert.ok(parsed.results[0].error.includes('Unknown tool'));
        });

        it('should preserve operation labels in results', async () => {
            const file = path.join(TEST_DIR, 'labeled.txt');
            fs.writeFileSync(file, 'Test content');

            const result = await handleBatchTools({
                operations: [
                    { tool: 'read_file', args: { path: file }, label: 'my-custom-label' }
                ]
            });

            const parsed = JSON.parse(result.content[0].text);
            
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

        it('should handle mixed tool types', async () => {
            const file = path.join(TEST_DIR, 'mixed.txt');
            fs.writeFileSync(file, 'Mixed test');

            const result = await handleBatchTools({
                operations: [
                    { tool: 'read_file', args: { path: file } },
                    { tool: 'list_directory', args: { path: TEST_DIR } },
                    { tool: 'file_info', args: { path: file } }
                ]
            });

            const parsed = JSON.parse(result.content[0].text);
            
            assert.strictEqual(parsed.summary.total, 3);
            assert.strictEqual(parsed.summary.successful, 3);
        });

        it('should report elapsed time', async () => {
            const result = await handleBatchTools({
                operations: [
                    { tool: 'list_directory', args: { path: TEST_DIR } }
                ]
            });

            const parsed = JSON.parse(result.content[0].text);
            
            assert.ok(typeof parsed.summary.elapsed_ms === 'number');
            assert.ok(parsed.summary.elapsed_ms >= 0);
        });

        it('should default to parallel execution mode', async () => {
            const result = await handleBatchTools({
                operations: [
                    { tool: 'list_directory', args: { path: TEST_DIR } }
                ]
            });

            const parsed = JSON.parse(result.content[0].text);
            
            assert.strictEqual(parsed.summary.executionMode, 'parallel');
        });
    });
});
