/**
 * TDD Red Phase Tests for write_from_line tool
 * 
 * These tests define the expected behavior for the write_from_line tool
 * as specified in ADR-002. Tests are written BEFORE implementation exists.
 * 
 * Expected failures until implementation is complete:
 * - Module not found: './writeFromLine.js' (implementation doesn't exist yet)
 * - After implementation: all tests should pass
 * 
 * Key behaviors (from ADR-002):
 * - startLine: 2070 keeps lines 1-2069, replaces from 2070 onward
 * - startLine: 2070, endLine: 3000 keeps 1-2069 and 3001+, replaces 2070-3000
 * - No fuzzy matching - purely line-based operations
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

// This import WILL FAIL until implementation exists - that's expected for RED phase
import { handleWriteFromLine, WriteFromLineResult } from './writeFromLine.js';

/**
 * Helper function to create test files with numbered lines for clarity
 * @param lineCount Number of lines to generate
 * @returns String content with numbered lines "Line 1\nLine 2\n..."
 */
function createNumberedFile(lineCount: number): string {
    return Array.from({ length: lineCount }, (_, i) => `Line ${i + 1}`).join('\n');
}

describe('write_from_line', () => {
    let tempDir: string;
    let testFile: string;

    beforeEach(() => {
        // Create a fresh temp directory for each test
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-from-line-test-'));
        testFile = path.join(tempDir, 'test.txt');
    });

    afterEach(() => {
        // Clean up temp directory after each test
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // =========================================================================
    // Test Case 1: Replace to EOF (startLine only)
    // =========================================================================
    describe('should replace from startLine to end of file when endLine is omitted', () => {
        it('keeps lines 1-4 and replaces lines 5+ with new content', async () => {
            // Setup: Create file with 10 numbered lines
            const initialContent = createNumberedFile(10);
            fs.writeFileSync(testFile, initialContent);

            // Execute: Replace from line 5 to end
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 5,
                content: 'New content line A\nNew content line B',
            });

            // Verify: Success reported
            assert.strictEqual(result.success, true, 'Should succeed');
            assert.strictEqual(result.linesReplaced, 6, 'Should report 6 lines replaced (lines 5-10)');
            assert.strictEqual(result.newLineCount, 2, 'Should report 2 new lines inserted');

            // Verify: File content is correct
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            const lines = finalContent.split('\n');
            
            assert.strictEqual(lines[0], 'Line 1', 'Line 1 should be preserved');
            assert.strictEqual(lines[1], 'Line 2', 'Line 2 should be preserved');
            assert.strictEqual(lines[2], 'Line 3', 'Line 3 should be preserved');
            assert.strictEqual(lines[3], 'Line 4', 'Line 4 should be preserved');
            assert.strictEqual(lines[4], 'New content line A', 'Line 5 should be new content');
            assert.strictEqual(lines[5], 'New content line B', 'Line 6 should be new content');
            assert.strictEqual(lines.length, 6, 'File should have 6 lines total');
        });

        it('handles large file with startLine near the end', async () => {
            // Setup: Create file with 100 numbered lines
            const initialContent = createNumberedFile(100);
            fs.writeFileSync(testFile, initialContent);

            // Execute: Replace from line 95 to end
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 95,
                content: 'Replaced tail content',
            });

            // Verify: Success with correct counts
            assert.strictEqual(result.success, true, 'Should succeed');
            assert.strictEqual(result.linesReplaced, 6, 'Should report 6 lines replaced (lines 95-100)');
            assert.strictEqual(result.newLineCount, 1, 'Should report 1 new line inserted');

            // Verify: Lines 1-94 preserved
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            const lines = finalContent.split('\n');
            assert.strictEqual(lines[93], 'Line 94', 'Line 94 should be preserved');
            assert.strictEqual(lines[94], 'Replaced tail content', 'Line 95 should be new content');
            assert.strictEqual(lines.length, 95, 'File should have 95 lines total');
        });
    });

    // =========================================================================
    // Test Case 2: Replace specific range (startLine + endLine)
    // =========================================================================
    describe('should replace specific line range when both startLine and endLine provided', () => {
        it('keeps lines 1-2 and 6+, replaces lines 3-5 with new content', async () => {
            // Setup: Create file with 10 numbered lines
            const initialContent = createNumberedFile(10);
            fs.writeFileSync(testFile, initialContent);

            // Execute: Replace lines 3-5
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 3,
                endLine: 5,
                content: 'Replacement A\nReplacement B',
            });

            // Verify: Success reported
            assert.strictEqual(result.success, true, 'Should succeed');
            assert.strictEqual(result.linesReplaced, 3, 'Should report 3 lines replaced (lines 3-5)');
            assert.strictEqual(result.newLineCount, 2, 'Should report 2 new lines inserted');

            // Verify: File content is correct
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            const lines = finalContent.split('\n');
            
            assert.strictEqual(lines[0], 'Line 1', 'Line 1 should be preserved');
            assert.strictEqual(lines[1], 'Line 2', 'Line 2 should be preserved');
            assert.strictEqual(lines[2], 'Replacement A', 'Line 3 should be new content');
            assert.strictEqual(lines[3], 'Replacement B', 'Line 4 should be new content');
            assert.strictEqual(lines[4], 'Line 6', 'Original line 6 should follow new content');
            assert.strictEqual(lines[5], 'Line 7', 'Original line 7 should be preserved');
            assert.strictEqual(lines.length, 9, 'File should have 9 lines total (10 - 3 + 2)');
        });

        it('handles mid-file range replacement without affecting surrounding content', async () => {
            // Setup: Create file with real code-like content
            const initialContent = `function main() {
    const x = 1;
    const y = 2;
    const z = 3;
    const result = x + y + z;
    return result;
}`;
            fs.writeFileSync(testFile, initialContent);

            // Execute: Replace lines 3-4 (const y and const z)
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 3,
                endLine: 4,
                content: '    const y = 20;\n    const z = 30;',
            });

            // Verify: Success
            assert.strictEqual(result.success, true, 'Should succeed');
            assert.strictEqual(result.linesReplaced, 2, 'Should report 2 lines replaced');

            // Verify: File structure preserved
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            assert.ok(finalContent.includes('function main()'), 'Function header preserved');
            assert.ok(finalContent.includes('const x = 1'), 'Line before replacement preserved');
            assert.ok(finalContent.includes('const y = 20'), 'New line 3 inserted');
            assert.ok(finalContent.includes('const z = 30'), 'New line 4 inserted');
            assert.ok(finalContent.includes('const result = x + y + z'), 'Line after replacement preserved');
        });
    });

    // =========================================================================
    // Test Case 3: dryRun: true - Returns preview without modifying file
    // =========================================================================
    describe('should return preview without modifying file when dryRun is true', () => {
        it('shows what would change without actually changing the file', async () => {
            // Setup: Create file with content
            const initialContent = createNumberedFile(5);
            fs.writeFileSync(testFile, initialContent);

            // Execute: Dry run replacement
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 3,
                endLine: 4,
                content: 'DRY RUN CONTENT',
                dryRun: true,
            });

            // Verify: Reports success but file unchanged
            assert.strictEqual(result.success, true, 'Dry run should report success');
            assert.strictEqual(result.linesReplaced, 2, 'Should report 2 lines would be replaced');
            assert.strictEqual(result.newLineCount, 1, 'Should report 1 new line would be inserted');

            // Verify: File is UNCHANGED
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            assert.strictEqual(finalContent, initialContent, 'File should NOT be modified in dryRun mode');

            // Verify: Diff preview is provided
            assert.ok(result.diff, 'Should include diff preview');
            assert.ok(
                result.diff!.includes('DRY RUN CONTENT') || 
                result.diff!.includes('+') || 
                result.diff!.includes('-'),
                'Diff should show proposed changes'
            );
        });

        it('provides unified diff format preview', async () => {
            // Setup: Create simple file
            const initialContent = 'Line 1\nLine 2\nLine 3';
            fs.writeFileSync(testFile, initialContent);

            // Execute: Dry run
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 2,
                content: 'MODIFIED LINE 2\nMODIFIED LINE 3',
                dryRun: true,
            });

            // Verify: Diff format
            assert.ok(result.diff, 'Should include diff preview');
            // Typical unified diff markers
            assert.ok(
                result.diff!.includes('@@') || 
                result.diff!.includes('---') || 
                result.diff!.includes('+++'),
                'Diff should be in unified diff format'
            );
        });
    });

    // =========================================================================
    // Test Case 4: Replace from first line (startLine: 1)
    // =========================================================================
    describe('should replace entire file when startLine is 1 and no endLine', () => {
        it('replaces all content when starting from line 1', async () => {
            // Setup: Create file with content
            const initialContent = createNumberedFile(5);
            fs.writeFileSync(testFile, initialContent);

            // Execute: Replace from line 1 (entire file)
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 1,
                content: 'Completely new content\nLine 2 of new content',
            });

            // Verify: Success
            assert.strictEqual(result.success, true, 'Should succeed');
            assert.strictEqual(result.linesReplaced, 5, 'Should report 5 lines replaced (all lines)');
            assert.strictEqual(result.newLineCount, 2, 'Should report 2 new lines');

            // Verify: File content completely replaced
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            assert.strictEqual(
                finalContent, 
                'Completely new content\nLine 2 of new content',
                'File should contain only new content'
            );
            assert.ok(!finalContent.includes('Line 1'), 'Original content should not exist');
        });

        it('replaces specific range starting from line 1', async () => {
            // Setup: Create file with 10 lines
            const initialContent = createNumberedFile(10);
            fs.writeFileSync(testFile, initialContent);

            // Execute: Replace lines 1-3 only
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 1,
                endLine: 3,
                content: 'New header',
            });

            // Verify: Success with correct counts
            assert.strictEqual(result.success, true, 'Should succeed');
            assert.strictEqual(result.linesReplaced, 3, 'Should report 3 lines replaced');
            assert.strictEqual(result.newLineCount, 1, 'Should report 1 new line');

            // Verify: Rest of file preserved
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            const lines = finalContent.split('\n');
            assert.strictEqual(lines[0], 'New header', 'First line should be new content');
            assert.strictEqual(lines[1], 'Line 4', 'Original line 4 should follow');
            assert.strictEqual(lines.length, 8, 'File should have 8 lines (10 - 3 + 1)');
        });
    });

    // =========================================================================
    // Test Case 5: Replace last line only
    // =========================================================================
    describe('should replace only the last line when startLine equals total lines', () => {
        it('replaces just the final line', async () => {
            // Setup: Create file with 5 lines
            const initialContent = createNumberedFile(5);
            fs.writeFileSync(testFile, initialContent);

            // Execute: Replace only line 5 (last line)
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 5,
                endLine: 5,
                content: 'New last line',
            });

            // Verify: Success
            assert.strictEqual(result.success, true, 'Should succeed');
            assert.strictEqual(result.linesReplaced, 1, 'Should report 1 line replaced');
            assert.strictEqual(result.newLineCount, 1, 'Should report 1 new line');

            // Verify: Only last line changed
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            const lines = finalContent.split('\n');
            assert.strictEqual(lines[0], 'Line 1', 'Line 1 should be preserved');
            assert.strictEqual(lines[1], 'Line 2', 'Line 2 should be preserved');
            assert.strictEqual(lines[2], 'Line 3', 'Line 3 should be preserved');
            assert.strictEqual(lines[3], 'Line 4', 'Line 4 should be preserved');
            assert.strictEqual(lines[4], 'New last line', 'Line 5 should be replaced');
            assert.strictEqual(lines.length, 5, 'File should still have 5 lines');
        });

        it('can expand last line into multiple lines', async () => {
            // Setup: Create file with 3 lines
            const initialContent = createNumberedFile(3);
            fs.writeFileSync(testFile, initialContent);

            // Execute: Replace line 3 with multiple lines
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 3,
                content: 'Expanded line 3a\nExpanded line 3b\nExpanded line 3c',
            });

            // Verify: Success
            assert.strictEqual(result.success, true, 'Should succeed');
            assert.strictEqual(result.linesReplaced, 1, 'Should report 1 line replaced');
            assert.strictEqual(result.newLineCount, 3, 'Should report 3 new lines');

            // Verify: File expanded
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            const lines = finalContent.split('\n');
            assert.strictEqual(lines.length, 5, 'File should now have 5 lines');
            assert.strictEqual(lines[2], 'Expanded line 3a', 'New line 3 correct');
            assert.strictEqual(lines[4], 'Expanded line 3c', 'New line 5 correct');
        });
    });

    // =========================================================================
    // Test Case 6: Edge case - startLine beyond file length
    // =========================================================================
    describe('should handle edge cases with line numbers', () => {
        it('appends content when startLine is one past the last line', async () => {
            // Setup: Create file with 3 lines
            const initialContent = createNumberedFile(3);
            fs.writeFileSync(testFile, initialContent);

            // Execute: Start at line 4 (one past end) - should append
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 4,
                content: 'Appended content',
            });

            // Verify: Success (append behavior)
            assert.strictEqual(result.success, true, 'Should succeed');
            assert.strictEqual(result.linesReplaced, 0, 'Should report 0 lines replaced (append)');
            assert.strictEqual(result.newLineCount, 1, 'Should report 1 new line');

            // Verify: Content appended
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            const lines = finalContent.split('\n');
            assert.strictEqual(lines.length, 4, 'File should have 4 lines');
            assert.strictEqual(lines[3], 'Appended content', 'New content appended');
        });

        it('returns error when startLine is far beyond file length', async () => {
            // Setup: Create file with 3 lines
            const initialContent = createNumberedFile(3);
            fs.writeFileSync(testFile, initialContent);

            // Execute: Start at line 100 (way past end)
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 100,
                content: 'Invalid position content',
            });

            // Verify: Should fail or handle gracefully
            // Depending on design, this could either:
            // - Fail with error message
            // - Succeed by appending
            // Either behavior should be clearly communicated
            assert.ok(
                result.success === false || 
                (result.success === true && result.message.includes('append')),
                'Should either fail or clearly indicate append behavior'
            );
        });

        it('handles endLine beyond file length by treating it as EOF', async () => {
            // Setup: Create file with 5 lines
            const initialContent = createNumberedFile(5);
            fs.writeFileSync(testFile, initialContent);

            // Execute: endLine 100 but file only has 5 lines
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 3,
                endLine: 100,
                content: 'Replaced 3 to EOF',
            });

            // Verify: Should treat endLine=100 as EOF
            assert.strictEqual(result.success, true, 'Should succeed');
            assert.strictEqual(result.linesReplaced, 3, 'Should replace lines 3-5 (3 lines)');

            // Verify: Content correct
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            const lines = finalContent.split('\n');
            assert.strictEqual(lines.length, 3, 'File should have 3 lines');
            assert.strictEqual(lines[2], 'Replaced 3 to EOF', 'Content replaced from line 3');
        });

        it('handles endLine less than startLine gracefully', async () => {
            // Setup: Create file with 5 lines
            const initialContent = createNumberedFile(5);
            fs.writeFileSync(testFile, initialContent);

            // Execute: Invalid range where endLine < startLine
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 5,
                endLine: 3, // Invalid: end before start
                content: 'Invalid range content',
            });

            // Verify: Should fail with clear error
            assert.strictEqual(result.success, false, 'Should fail for invalid range');
            assert.ok(
                result.message.toLowerCase().includes('invalid') ||
                result.message.toLowerCase().includes('range') ||
                result.message.toLowerCase().includes('endline') ||
                result.message.toLowerCase().includes('startline'),
                'Error message should explain the invalid range'
            );
        });
    });

    // =========================================================================
    // Test Case 7: File not found - Error handling
    // =========================================================================
    describe('should handle file not found error gracefully', () => {
        it('returns failure with descriptive error when file does not exist', async () => {
            const nonExistentFile = path.join(tempDir, 'does-not-exist.txt');

            // Execute: Try to edit non-existent file
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: nonExistentFile,
                startLine: 1,
                content: 'Some content',
            });

            // Verify: Graceful failure with clear message
            assert.strictEqual(result.success, false, 'Should fail when file not found');
            assert.ok(
                result.message.toLowerCase().includes('not found') ||
                result.message.toLowerCase().includes('enoent') ||
                result.message.toLowerCase().includes('does not exist') ||
                result.message.toLowerCase().includes('no such file'),
                'Error message should indicate file not found'
            );

            // Verify: Counts reflect failure
            assert.strictEqual(result.linesReplaced, 0, 'No lines should be replaced');
            assert.strictEqual(result.newLineCount, 0, 'No new lines should be counted');
        });

        it('handles permission denied errors', async () => {
            // This test may be platform-specific
            // On Unix-like systems, we could remove read permissions
            // For now, we test the error handling structure
            
            const nonExistentDir = path.join(tempDir, 'nonexistent', 'subdir', 'file.txt');

            const result: WriteFromLineResult = await handleWriteFromLine({
                path: nonExistentDir,
                startLine: 1,
                content: 'Content',
            });

            // Verify: Fails gracefully
            assert.strictEqual(result.success, false, 'Should fail for inaccessible path');
            assert.ok(result.message.length > 0, 'Should provide error message');
        });
    });

    // =========================================================================
    // Test Case 8: Empty content - Replace lines with nothing (deletion)
    // =========================================================================
    describe('should handle empty content for line deletion', () => {
        it('deletes lines when content is empty string', async () => {
            // Setup: Create file with 5 lines
            const initialContent = createNumberedFile(5);
            fs.writeFileSync(testFile, initialContent);

            // Execute: Replace lines 2-4 with nothing (delete them)
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 2,
                endLine: 4,
                content: '',
            });

            // Verify: Success
            assert.strictEqual(result.success, true, 'Should succeed');
            assert.strictEqual(result.linesReplaced, 3, 'Should report 3 lines replaced');
            assert.strictEqual(result.newLineCount, 0, 'Should report 0 new lines (deletion)');

            // Verify: Lines deleted
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            const lines = finalContent.split('\n');
            assert.strictEqual(lines.length, 2, 'File should have 2 lines');
            assert.strictEqual(lines[0], 'Line 1', 'Line 1 preserved');
            assert.strictEqual(lines[1], 'Line 5', 'Line 5 follows directly');
        });

        it('deletes from startLine to EOF when content is empty', async () => {
            // Setup: Create file with 5 lines
            const initialContent = createNumberedFile(5);
            fs.writeFileSync(testFile, initialContent);

            // Execute: Delete from line 3 to end
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 3,
                content: '',
            });

            // Verify: Success
            assert.strictEqual(result.success, true, 'Should succeed');
            assert.strictEqual(result.linesReplaced, 3, 'Should report 3 lines deleted');

            // Verify: File truncated
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            const lines = finalContent.split('\n');
            assert.strictEqual(lines.length, 2, 'File should have 2 lines');
            assert.strictEqual(lines[1], 'Line 2', 'Only lines 1-2 remain');
        });

        it('deletes entire file when startLine is 1 and content is empty', async () => {
            // Setup: Create file with content
            const initialContent = createNumberedFile(3);
            fs.writeFileSync(testFile, initialContent);

            // Execute: Delete entire file
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 1,
                content: '',
            });

            // Verify: Success
            assert.strictEqual(result.success, true, 'Should succeed');
            assert.strictEqual(result.linesReplaced, 3, 'Should report all 3 lines deleted');

            // Verify: File is empty
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            assert.strictEqual(finalContent, '', 'File should be empty');
        });
    });

    // =========================================================================
    // Test Case 9: Result structure validation
    // =========================================================================
    describe('should return properly structured result object', () => {
        it('includes all required fields in WriteFromLineResult', async () => {
            // Setup: Create file
            const initialContent = createNumberedFile(5);
            fs.writeFileSync(testFile, initialContent);

            // Execute: Simple replacement
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 3,
                content: 'New line 3',
            });

            // Verify: All required fields exist
            assert.ok('success' in result, 'Result should have success field');
            assert.ok('message' in result, 'Result should have message field');
            assert.ok('linesReplaced' in result, 'Result should have linesReplaced field');
            assert.ok('newLineCount' in result, 'Result should have newLineCount field');

            // Verify field types
            assert.strictEqual(typeof result.success, 'boolean', 'success should be boolean');
            assert.strictEqual(typeof result.message, 'string', 'message should be string');
            assert.strictEqual(typeof result.linesReplaced, 'number', 'linesReplaced should be number');
            assert.strictEqual(typeof result.newLineCount, 'number', 'newLineCount should be number');
        });

        it('includes optional diff field when dryRun is true', async () => {
            // Setup: Create file
            const initialContent = createNumberedFile(3);
            fs.writeFileSync(testFile, initialContent);

            // Execute: Dry run
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 2,
                content: 'Modified',
                dryRun: true,
            });

            // Verify: diff field present and is string
            assert.ok('diff' in result, 'Result should have diff field for dryRun');
            assert.strictEqual(typeof result.diff, 'string', 'diff should be string');
            assert.ok(result.diff!.length > 0, 'diff should not be empty');
        });

        it('provides meaningful message on success', async () => {
            // Setup: Create file
            const initialContent = createNumberedFile(5);
            fs.writeFileSync(testFile, initialContent);

            // Execute: Replacement
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 2,
                endLine: 4,
                content: 'Replacement',
            });

            // Verify: Message is descriptive
            assert.ok(result.message.length > 0, 'Message should not be empty');
            assert.ok(
                result.message.includes('replaced') ||
                result.message.includes('success') ||
                result.message.includes('lines') ||
                result.message.includes('modified'),
                'Message should describe the operation'
            );
        });

        it('provides meaningful message on failure', async () => {
            const nonExistentFile = path.join(tempDir, 'missing.txt');

            const result: WriteFromLineResult = await handleWriteFromLine({
                path: nonExistentFile,
                startLine: 1,
                content: 'Content',
            });

            // Verify: Error message is descriptive
            assert.strictEqual(result.success, false, 'Should fail');
            assert.ok(result.message.length > 0, 'Error message should not be empty');
            // Should contain useful information
            assert.ok(
                result.message.toLowerCase().includes('error') ||
                result.message.toLowerCase().includes('fail') ||
                result.message.toLowerCase().includes('not found') ||
                result.message.toLowerCase().includes('could not'),
                'Error message should explain the failure'
            );
        });
    });

    // =========================================================================
    // Additional Tests: Line ending handling
    // =========================================================================
    describe('should handle various line ending styles', () => {
        it('preserves Unix line endings (LF)', async () => {
            // Setup: Create file with LF line endings
            const initialContent = 'Line 1\nLine 2\nLine 3';
            fs.writeFileSync(testFile, initialContent);

            // Execute: Replace line 2
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 2,
                endLine: 2,
                content: 'Modified Line 2',
            });

            // Verify: LF preserved
            assert.strictEqual(result.success, true, 'Should succeed');
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            assert.ok(!finalContent.includes('\r'), 'Should not introduce CRLF');
        });

        it('preserves Windows line endings (CRLF)', async () => {
            // Setup: Create file with CRLF line endings
            const initialContent = 'Line 1\r\nLine 2\r\nLine 3';
            fs.writeFileSync(testFile, initialContent);

            // Execute: Replace line 2
            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 2,
                endLine: 2,
                content: 'Modified Line 2',
            });

            // Verify: CRLF preserved (or handled consistently)
            assert.strictEqual(result.success, true, 'Should succeed');
            const finalContent = fs.readFileSync(testFile, 'utf-8');
            // Either preserves CRLF or normalizes - should be consistent
            const lines = finalContent.split(/\r?\n/);
            assert.strictEqual(lines[1], 'Modified Line 2', 'Line 2 should be modified');
        });
    });

    // =========================================================================
    // Additional Tests: Multi-line content handling
    // =========================================================================
    describe('should correctly count new lines in content', () => {
        it('counts single line content correctly', async () => {
            const initialContent = createNumberedFile(3);
            fs.writeFileSync(testFile, initialContent);

            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 2,
                endLine: 2,
                content: 'Single line',
            });

            assert.strictEqual(result.newLineCount, 1, 'Single line should count as 1');
        });

        it('counts multi-line content correctly', async () => {
            const initialContent = createNumberedFile(3);
            fs.writeFileSync(testFile, initialContent);

            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 2,
                endLine: 2,
                content: 'Line A\nLine B\nLine C\nLine D',
            });

            assert.strictEqual(result.newLineCount, 4, 'Four lines should count as 4');
        });

        it('counts empty content as 0 lines', async () => {
            const initialContent = createNumberedFile(3);
            fs.writeFileSync(testFile, initialContent);

            const result: WriteFromLineResult = await handleWriteFromLine({
                path: testFile,
                startLine: 2,
                endLine: 2,
                content: '',
            });

            assert.strictEqual(result.newLineCount, 0, 'Empty content should count as 0');
        });
    });
});
