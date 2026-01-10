/**
 * write_from_line tool implementation
 *
 * Replaces content from startLine to endLine (or EOF if endLine omitted)
 * with new content. Supports dry-run mode for preview.
 *
 * Based on ADR-002 specification.
 */

import fs from 'fs';
import { logAudit } from '../../audit.js';
import { generateDiff } from './diffVisualizer.js';

/**
 * Result structure for write_from_line operations
 * @property success - True if the operation completed successfully
 * @property message - Human-readable description of what happened
 * @property linesReplaced - Number of original lines that were replaced
 * @property newLineCount - Number of new lines written
 * @property diff - Unified diff showing the changes (optional)
 */
export interface WriteFromLineResult {
    success: boolean;
    message: string;
    linesReplaced: number;
    newLineCount: number;
    diff?: string;
}

/**
 * Arguments for write_from_line tool
 * @property path - Absolute path to the file to edit
 * @property startLine - First line to replace (1-indexed, inclusive)
 * @property endLine - Last line to replace (1-indexed, inclusive). If omitted, replaces to EOF
 * @property content - New content to write (replaces lines startLine through endLine)
 * @property dryRun - If true, preview changes without applying (default: false)
 */
export interface WriteFromLineArgs {
    path: string;
    startLine: number;
    endLine?: number;
    content: string;
    dryRun?: boolean;
}

/**
 * MCP response format
 */
interface McpResponse {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
}

/**
 * Format write_from_line result for display
 */
function formatWriteFromLineResponse(result: WriteFromLineResult): string {
    let output = `## Write From Line Result\n\n`;
    output += `**Status:** ${result.success ? '✅ Success' : '❌ Failed'}\n`;
    output += `**Message:** ${result.message}\n`;
    output += `**Lines Replaced:** ${result.linesReplaced}\n`;
    output += `**New Lines Written:** ${result.newLineCount}\n`;
    
    if (result.diff) {
        output += `\n### Diff Preview\n\`\`\`diff\n${result.diff}\n\`\`\``;
    }
    
    return output;
}

/**
 * Handle write_from_line operation
 *
 * Replaces a range of lines in a file with new content. Useful for targeted
 * edits when you know the exact line numbers to modify. Preserves original
 * line ending style (CRLF or LF).
 *
 * @param args - The write_from_line arguments
 * @returns Promise resolving to WriteFromLineResult
 *
 * @example
 * ```typescript
 * // Replace lines 10-15 with new content
 * const result = await handleWriteFromLine({
 *   path: '/path/to/file.ts',
 *   startLine: 10,
 *   endLine: 15,
 *   content: 'function newImplementation() {\n  return true;\n}',
 *   dryRun: true
 * });
 * ```
 */
export async function handleWriteFromLine(args: WriteFromLineArgs): Promise<WriteFromLineResult> {
    const { path: filePath, startLine, endLine, content: newContent, dryRun = false } = args;

    // 1. Check file exists
    if (!fs.existsSync(filePath)) {
        return {
            success: false,
            message: `File not found: ${filePath}`,
            linesReplaced: 0,
            newLineCount: 0
        };
    }

    // 2. Read and split into lines
    const originalContent = fs.readFileSync(filePath, 'utf-8');
    
    // Detect line ending style
    const hasCRLF = originalContent.includes('\r\n');
    const lineEnding = hasCRLF ? '\r\n' : '\n';
    
    // Normalize to LF for processing, then restore original line endings
    const normalizedOriginal = originalContent.replace(/\r\n/g, '\n');
    const lines = normalizedOriginal.split('\n');
    const totalLines = lines.length;

    // 3. Validate startLine
    if (startLine < 1) {
        return {
            success: false,
            message: `Invalid startLine: ${startLine}. Must be >= 1`,
            linesReplaced: 0,
            newLineCount: 0
        };
    }

    // 4. Validate endLine if provided
    if (endLine !== undefined && endLine < startLine) {
        return {
            success: false,
            message: `Invalid range: endLine (${endLine}) cannot be less than startLine (${startLine})`,
            linesReplaced: 0,
            newLineCount: 0
        };
    }

    // 5. Handle startLine far beyond file length
    if (startLine > totalLines + 1) {
        return {
            success: false,
            message: `startLine ${startLine} is beyond file length (${totalLines} lines). Use startLine ${totalLines + 1} to append.`,
            linesReplaced: 0,
            newLineCount: 0
        };
    }

    // 6. Calculate boundaries (1-indexed to 0-indexed)
    const keepBefore = lines.slice(0, startLine - 1);
    
    // Effective endLine: clamp to file length if beyond, or use EOF if not provided
    const effectiveEndLine = endLine !== undefined 
        ? Math.min(endLine, totalLines) 
        : totalLines;
    
    const keepAfter = endLine !== undefined ? lines.slice(effectiveEndLine) : [];
    
    // Calculate how many lines are being replaced
    let replacedCount: number;
    if (startLine > totalLines) {
        // Appending - no lines replaced
        replacedCount = 0;
    } else {
        replacedCount = effectiveEndLine - startLine + 1;
    }

    // 7. Build new content
    const newLines = newContent === '' ? [] : newContent.split('\n');
    const finalLines = [...keepBefore, ...newLines, ...keepAfter];
    const finalContent = finalLines.join(lineEnding);

    // 8. Generate diff preview
    const diffResult = generateDiff(originalContent, finalContent, filePath);

    // 9. Write if not dry run
    if (!dryRun) {
        fs.writeFileSync(filePath, finalContent, 'utf-8');
    }

    // 10. Build result
    const rangeStr = endLine !== undefined
        ? `${startLine}-${effectiveEndLine}`
        : `${startLine}-${totalLines}`;
    
    const message = dryRun
        ? `DRY RUN: Would replace lines ${rangeStr}`
        : `Replaced lines ${rangeStr}`;

    const result: WriteFromLineResult = {
        success: true,
        message,
        linesReplaced: Math.max(0, replacedCount),
        newLineCount: newLines.length,
        diff: diffResult.unified
    };

    // 📝 Audit trail for write_from_line operations
    await logAudit('write_from_line', { path: filePath, startLine, endLine, dryRun }, result);

    return result;
}

/**
 * MCP handler wrapper for write_from_line
 * Formats the result for MCP response
 */
export async function handleWriteFromLineMcp(args: WriteFromLineArgs): Promise<McpResponse> {
    const result = await handleWriteFromLine(args);
    return {
        content: [{ type: 'text', text: formatWriteFromLineResponse(result) }],
        isError: !result.success
    };
}
