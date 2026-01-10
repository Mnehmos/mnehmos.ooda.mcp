/**
 * TDD Red Phase Tests for batch_edit_blocks tool
 * 
 * These tests define the expected behavior for the batch_edit_blocks tool
 * as specified in ADR-002. Tests are written BEFORE implementation exists.
 * 
 * Expected failures until implementation is complete:
 * - Module not found: './batchEditBlocks.js' (implementation doesn't exist yet)
 * - After implementation: all tests should pass
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

// This import WILL FAIL until implementation exists - that's expected for RED phase
import { handleBatchEditBlocks, BatchEditBlocksResult } from './batchEditBlocks.js';

describe('batch_edit_blocks', () => {
    let tempDir: string;
    let testFile: string;

    beforeEach(() => {
        // Create a fresh temp directory for each test
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-edit-test-'));
        testFile = path.join(tempDir, 'test.txt');
    });

    afterEach(() => {
        // Clean up temp directory after each test
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // =========================================================================
    // Test Case 1: Multiple successful edits
    // =========================================================================
    describe('should apply multiple edits successfully when all edits match', () => {
        it('applies all edits in sequence and returns success', async () => {
            // Setup: Create file with content that has multiple distinct patterns
            const initialContent = `function greet(name) {
    console.log("Hello, " + name);
    return "greeting complete";
}

function farewell(name) {
    console.log("Goodbye, " + name);
    return "farewell complete";
}`;
            fs.writeFileSync(testFile, initialContent);

            // Execute: Apply multiple edits
            const result: BatchEditBlocksResult = await handleBatchEditBlocks({
                path: testFile,
                edits: [
                    { search: 'console.log("Hello,', replace: 'console.info("Hi,' },
                    { search: 'console.log("Goodbye,', replace: 'console.info("Bye,' },
                    { search: 'greeting complete', replace: 'greeted successfully' },
                ],
            });

            // Verify: All edits succeeded
            assert.strictEqual(result.success, true, 'All edits should succeed');
            assert.strictEqual(result.totalEdits, 3, 'Should report 3 total edits');
            assert.strictEqual(result.successfulEdits, 3, 'Should report 3 successful edits');
            assert.strictEqual(result.failedEdits, 0, 'Should report 0 failed edits');
            assert.strictEqual(result.results.length, 3, 'Should have 3 result entries');

            // Verify file was actually modified
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            assert.ok(finalContent.includes('console.info("Hi,'), 'First edit should be applied');
            assert.ok(finalContent.includes('console.info("Bye,'), 'Second edit should be applied');
            assert.ok(finalContent.includes('greeted successfully'), 'Third edit should be applied');
        });
    });

    // =========================================================================
    // Test Case 2: Partial failure (default behavior - continue on error)
    // =========================================================================
    describe('should continue processing when some edits fail (default behavior)', () => {
        it('applies successful edits and reports failures without stopping', async () => {
            // Setup: Create file with specific content
            const initialContent = `line1: apple
line2: banana
line3: cherry`;
            fs.writeFileSync(testFile, initialContent);

            // Execute: Mix of valid and invalid edits (middle one fails)
            const result: BatchEditBlocksResult = await handleBatchEditBlocks({
                path: testFile,
                edits: [
                    { search: 'apple', replace: 'apricot' },           // Should succeed
                    { search: 'NONEXISTENT_PATTERN', replace: 'xyz' }, // Should fail
                    { search: 'cherry', replace: 'cranberry' },        // Should succeed
                ],
            });

            // Verify: Partial success reported
            assert.strictEqual(result.success, false, 'Overall success should be false when any edit fails');
            assert.strictEqual(result.totalEdits, 3, 'Should report 3 total edits');
            assert.strictEqual(result.successfulEdits, 2, 'Should report 2 successful edits');
            assert.strictEqual(result.failedEdits, 1, 'Should report 1 failed edit');

            // Verify individual results
            assert.strictEqual(result.results[0].success, true, 'First edit should succeed');
            assert.strictEqual(result.results[1].success, false, 'Second edit should fail');
            assert.strictEqual(result.results[2].success, true, 'Third edit should succeed (continued after failure)');

            // Verify file contains successful edits
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            assert.ok(finalContent.includes('apricot'), 'First successful edit should be applied');
            assert.ok(finalContent.includes('cranberry'), 'Third successful edit should be applied');
            assert.ok(finalContent.includes('banana'), 'Unchanged content should remain');
        });
    });

    // =========================================================================
    // Test Case 3: stopOnError: true - Halts on first failure
    // =========================================================================
    describe('should stop on first error when stopOnError is true', () => {
        it('halts processing and saves completed work before failure point', async () => {
            // Setup: Create file with specific content
            const initialContent = `alpha
beta
gamma
delta`;
            fs.writeFileSync(testFile, initialContent);

            // Execute: First succeeds, second fails, third never attempted
            const result: BatchEditBlocksResult = await handleBatchEditBlocks({
                path: testFile,
                edits: [
                    { search: 'alpha', replace: 'ALPHA' },             // Should succeed
                    { search: 'DOES_NOT_EXIST', replace: 'xyz' },      // Should fail - stops here
                    { search: 'gamma', replace: 'GAMMA' },             // Should NOT be attempted
                ],
                stopOnError: true,
            });

            // Verify: Stopped at failure
            assert.strictEqual(result.success, false, 'Overall success should be false');
            assert.strictEqual(result.totalEdits, 3, 'Should report 3 total edits');
            assert.strictEqual(result.successfulEdits, 1, 'Only 1 edit succeeded before failure');
            assert.strictEqual(result.failedEdits, 1, 'Should report 1 failed edit');

            // Verify only 2 results (stopped after failure)
            assert.strictEqual(result.results.length, 2, 'Should have 2 results (stopped after failure)');
            assert.strictEqual(result.results[0].success, true, 'First edit should succeed');
            assert.strictEqual(result.results[1].success, false, 'Second edit should fail');

            // Verify file state: first edit applied, third edit NOT applied
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            assert.ok(finalContent.includes('ALPHA'), 'First edit should be saved');
            assert.ok(finalContent.includes('gamma'), 'Third edit should NOT be applied (was never attempted)');
            assert.ok(!finalContent.includes('GAMMA'), 'Third edit should NOT be applied');
        });
    });

    // =========================================================================
    // Test Case 4: dryRun: true - Returns preview without modifying file
    // =========================================================================
    describe('should return preview without modifying file when dryRun is true', () => {
        it('shows what would change without actually changing the file', async () => {
            // Setup: Create file with specific content
            const initialContent = `Hello World
This is a test file.
Goodbye World`;
            fs.writeFileSync(testFile, initialContent);

            // Execute: Dry run with multiple edits
            const result: BatchEditBlocksResult = await handleBatchEditBlocks({
                path: testFile,
                edits: [
                    { search: 'Hello', replace: 'Greetings' },
                    { search: 'Goodbye', replace: 'Farewell' },
                ],
                dryRun: true,
            });

            // Verify: Reports success but file unchanged
            assert.strictEqual(result.success, true, 'Dry run should report success for valid edits');
            assert.strictEqual(result.totalEdits, 2, 'Should report 2 total edits');
            assert.strictEqual(result.successfulEdits, 2, 'Should report 2 successful edits');

            // Verify file is UNCHANGED
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            assert.strictEqual(finalContent, initialContent, 'File should NOT be modified in dryRun mode');

            // Verify diff preview is provided
            assert.ok(result.finalDiff, 'Should include finalDiff preview');
            assert.ok(result.finalDiff!.includes('Greetings') || result.finalDiff!.includes('+'), 
                'Diff should show proposed changes');
        });
    });

    // =========================================================================
    // Test Case 5: Empty edits array - Edge case
    // =========================================================================
    describe('should handle empty edits array gracefully', () => {
        it('succeeds with no changes when edits array is empty', async () => {
            // Setup: Create file with content
            const initialContent = 'Some content that should not change';
            fs.writeFileSync(testFile, initialContent);

            // Execute: Empty edits array
            const result: BatchEditBlocksResult = await handleBatchEditBlocks({
                path: testFile,
                edits: [],
            });

            // Verify: Success with zero edits
            assert.strictEqual(result.success, true, 'Should succeed with empty edits');
            assert.strictEqual(result.totalEdits, 0, 'Should report 0 total edits');
            assert.strictEqual(result.successfulEdits, 0, 'Should report 0 successful edits');
            assert.strictEqual(result.failedEdits, 0, 'Should report 0 failed edits');
            assert.deepStrictEqual(result.results, [], 'Results array should be empty');

            // Verify file unchanged
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            assert.strictEqual(finalContent, initialContent, 'File should remain unchanged');
        });
    });

    // =========================================================================
    // Test Case 6: File not found - Error handling
    // =========================================================================
    describe('should handle file not found error gracefully', () => {
        it('returns failure with descriptive error when file does not exist', async () => {
            const nonExistentFile = path.join(tempDir, 'does-not-exist.txt');

            // Execute: Try to edit non-existent file
            const result: BatchEditBlocksResult = await handleBatchEditBlocks({
                path: nonExistentFile,
                edits: [
                    { search: 'foo', replace: 'bar' },
                ],
            });

            // Verify: Graceful failure with clear message
            assert.strictEqual(result.success, false, 'Should fail when file not found');
            assert.strictEqual(result.totalEdits, 1, 'Should report 1 total edit');
            assert.strictEqual(result.successfulEdits, 0, 'Should report 0 successful edits');
            assert.strictEqual(result.failedEdits, 1, 'Should report 1 failed edit');

            // Verify error message is descriptive
            assert.ok(result.results[0].message.toLowerCase().includes('not found') ||
                      result.results[0].message.toLowerCase().includes('enoent') ||
                      result.results[0].message.toLowerCase().includes('does not exist'),
                'Error message should indicate file not found');
        });
    });

    // =========================================================================
    // Test Case 7: Label tracking - Labels appear in results
    // =========================================================================
    describe('should track labels in results for progress monitoring', () => {
        it('includes provided labels in result entries', async () => {
            // Setup: Create file with content
            const initialContent = `version: 1.0.0
author: unknown
license: MIT`;
            fs.writeFileSync(testFile, initialContent);

            // Execute: Edits with labels
            const result: BatchEditBlocksResult = await handleBatchEditBlocks({
                path: testFile,
                edits: [
                    { search: '1.0.0', replace: '2.0.0', label: 'update-version' },
                    { search: 'unknown', replace: 'Jane Doe', label: 'set-author' },
                    { search: 'MIT', replace: 'Apache-2.0' }, // No label - should be undefined
                ],
            });

            // Verify: Labels are preserved in results
            assert.strictEqual(result.results[0].label, 'update-version', 'First result should have label');
            assert.strictEqual(result.results[1].label, 'set-author', 'Second result should have label');
            assert.strictEqual(result.results[2].label, undefined, 'Third result should have no label');

            // Verify indices are tracked
            assert.strictEqual(result.results[0].index, 0, 'First result should have index 0');
            assert.strictEqual(result.results[1].index, 1, 'Second result should have index 1');
            assert.strictEqual(result.results[2].index, 2, 'Third result should have index 2');
        });
    });

    // =========================================================================
    // Test Case 8: Cascading edits - Second edit depends on first edit's result
    // =========================================================================
    describe('should support cascading edits where later edits depend on earlier ones', () => {
        it('applies edits sequentially so later edits see earlier changes', async () => {
            // Setup: Create file with initial content
            const initialContent = 'const value = OLD_VALUE;';
            fs.writeFileSync(testFile, initialContent);

            // Execute: Cascading edits - second edit targets result of first
            const result: BatchEditBlocksResult = await handleBatchEditBlocks({
                path: testFile,
                edits: [
                    { search: 'OLD_VALUE', replace: 'INTERMEDIATE_VALUE' },
                    // This edit targets the result of the FIRST edit
                    { search: 'INTERMEDIATE_VALUE', replace: 'FINAL_VALUE' },
                ],
            });

            // Verify: Both edits succeeded
            assert.strictEqual(result.success, true, 'Cascading edits should succeed');
            assert.strictEqual(result.successfulEdits, 2, 'Both edits should succeed');

            // Verify: Final file has result of cascaded edits
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            assert.strictEqual(finalContent, 'const value = FINAL_VALUE;', 
                'Final content should reflect cascaded edits');
            assert.ok(!finalContent.includes('OLD_VALUE'), 
                'Original value should be replaced');
            assert.ok(!finalContent.includes('INTERMEDIATE_VALUE'), 
                'Intermediate value should also be replaced');
        });

        it('fails second edit if first edit changes expected pattern', async () => {
            // Setup: Create file where both edits target overlapping content
            const initialContent = 'prefix_SHARED_suffix';
            fs.writeFileSync(testFile, initialContent);

            // Execute: First edit removes what second edit needs
            const result: BatchEditBlocksResult = await handleBatchEditBlocks({
                path: testFile,
                edits: [
                    { search: 'SHARED', replace: 'REPLACED' },
                    // This edit will fail because 'SHARED' no longer exists
                    { search: 'SHARED', replace: 'ANOTHER' },
                ],
            });

            // Verify: First succeeds, second fails (pattern no longer exists)
            assert.strictEqual(result.success, false, 'Should fail because second edit cannot find pattern');
            assert.strictEqual(result.results[0].success, true, 'First edit should succeed');
            assert.strictEqual(result.results[1].success, false, 'Second edit should fail - pattern consumed');
        });
    });

    // =========================================================================
    // Additional Edge Case: expectedReplacements validation
    // =========================================================================
    describe('should validate expectedReplacements count', () => {
        it('fails when actual replacements differ from expected', async () => {
            // Setup: Create file with multiple occurrences
            const initialContent = 'foo bar foo baz foo';
            fs.writeFileSync(testFile, initialContent);

            // Execute: Expect 2 replacements but pattern appears 3 times
            const result: BatchEditBlocksResult = await handleBatchEditBlocks({
                path: testFile,
                edits: [
                    { search: 'foo', replace: 'qux', expectedReplacements: 2 },
                ],
            });

            // Verify: Fails due to count mismatch
            assert.strictEqual(result.success, false, 'Should fail when count differs from expected');
            assert.ok(result.results[0].message.includes('expected') || 
                      result.results[0].message.includes('2') ||
                      result.results[0].message.includes('3'),
                'Error message should explain the count mismatch');
        });

        it('succeeds when actual replacements match expected', async () => {
            // Setup: Create file with exactly 2 occurrences
            const initialContent = 'foo bar foo';
            fs.writeFileSync(testFile, initialContent);

            // Execute: Expect exactly 2 replacements
            const result: BatchEditBlocksResult = await handleBatchEditBlocks({
                path: testFile,
                edits: [
                    { search: 'foo', replace: 'qux', expectedReplacements: 2 },
                ],
            });

            // Verify: Succeeds
            assert.strictEqual(result.success, true, 'Should succeed when count matches expected');
            
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            assert.strictEqual(finalContent, 'qux bar qux', 'All occurrences should be replaced');
        });
    });

    // =========================================================================
    // Result structure validation
    // =========================================================================
    describe('should return properly structured result object', () => {
        it('includes all required fields in BatchEditBlocksResult', async () => {
            const initialContent = 'test content';
            fs.writeFileSync(testFile, initialContent);

            const result: BatchEditBlocksResult = await handleBatchEditBlocks({
                path: testFile,
                edits: [{ search: 'test', replace: 'demo' }],
            });

            // Verify all required fields exist
            assert.ok('success' in result, 'Result should have success field');
            assert.ok('totalEdits' in result, 'Result should have totalEdits field');
            assert.ok('successfulEdits' in result, 'Result should have successfulEdits field');
            assert.ok('failedEdits' in result, 'Result should have failedEdits field');
            assert.ok('results' in result, 'Result should have results array');
            assert.ok(Array.isArray(result.results), 'results should be an array');

            // Verify result entry structure
            const entry = result.results[0];
            assert.ok('index' in entry, 'Result entry should have index');
            assert.ok('success' in entry, 'Result entry should have success');
            assert.ok('message' in entry, 'Result entry should have message');
            assert.strictEqual(typeof entry.index, 'number', 'index should be a number');
            assert.strictEqual(typeof entry.success, 'boolean', 'success should be a boolean');
            assert.strictEqual(typeof entry.message, 'string', 'message should be a string');
        });
    });
});
