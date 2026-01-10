/**
 * batch_edit_blocks tool implementation
 * Applies multiple search/replace operations to a single file atomically
 */

import fs from 'fs';
import path from 'path';
import { logAudit } from '../../audit.js';
import { detectLineEnding, normalizeLineEndings } from './lineEndings.js';
import { countOccurrences, DEFAULT_FUZZY_THRESHOLD } from './fuzzySearch.js';
import { generateDiff } from './diffVisualizer.js';

/**
 * Arguments for the batch_edit_blocks tool
 * @property path - Absolute path to the file to edit
 * @property edits - Array of search/replace operations to apply sequentially
 * @property stopOnError - If true, stop processing edits on first failure (default: false)
 * @property dryRun - If true, preview changes without applying (default: false)
 * @property fuzzyThreshold - Similarity threshold for fuzzy matching (default: 0.7)
 */
export interface BatchEditBlocksArgs {
    path: string;
    edits: Array<{
        search: string;
        replace: string;
        label?: string;
        expectedReplacements?: number;
    }>;
    stopOnError?: boolean;
    dryRun?: boolean;
    fuzzyThreshold?: number;
}

/**
 * Result from batch_edit_blocks operation
 * @property success - True if all edits succeeded
 * @property totalEdits - Total number of edits attempted
 * @property successfulEdits - Number of edits that succeeded
 * @property failedEdits - Number of edits that failed
 * @property results - Per-edit results with index, status, message, and diff
 * @property finalDiff - Cumulative diff showing all changes applied
 */
export interface BatchEditBlocksResult {
    success: boolean;
    totalEdits: number;
    successfulEdits: number;
    failedEdits: number;
    results: Array<{
        index: number;
        label?: string;
        success: boolean;
        message: string;
        diff?: string;
    }>;
    finalDiff?: string;
}

/**
 * Internal result from a single edit operation
 */
interface SingleEditResult {
    success: boolean;
    message: string;
    newContent: string;
    diff?: string;
}

/**
 * Perform a single edit operation on the content
 */
function performSingleEdit(
    content: string,
    edit: { search: string; replace: string; expectedReplacements?: number },
    fuzzyThreshold: number,
    filePath: string
): SingleEditResult {
    const expectedCount = edit.expectedReplacements ?? 1;
    const fileLineEnding = detectLineEnding(content);
    const normalizedSearch = normalizeLineEndings(edit.search, fileLineEnding);
    const normalizedReplace = normalizeLineEndings(edit.replace, fileLineEnding);
    
    // Count occurrences
    const actualCount = countOccurrences(content, normalizedSearch);
    
    // Check if pattern exists
    if (actualCount === 0) {
        return {
            success: false,
            message: `Search text not found in file`,
            newContent: content
        };
    }
    
    // Validate expectedReplacements if specified
    if (actualCount !== expectedCount) {
        return {
            success: false,
            message: `Expected ${expectedCount} occurrence(s) but found ${actualCount}`,
            newContent: content
        };
    }
    
    // Perform the replacement
    let newContent: string;
    if (expectedCount === 1) {
        // Replace only the first occurrence
        const index = content.indexOf(normalizedSearch);
        newContent = content.substring(0, index) + 
                     normalizedReplace + 
                     content.substring(index + normalizedSearch.length);
    } else {
        // Replace all occurrences
        newContent = content.split(normalizedSearch).join(normalizedReplace);
    }
    
    // Generate diff for this edit
    const diffResult = generateDiff(content, newContent, path.basename(filePath));
    
    return {
        success: true,
        message: `Successfully applied edit`,
        newContent,
        diff: diffResult.unified
    };
}

/**
 * MCP response format
 */
interface McpResponse {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
}

/**
 * Format batch result for display
 */
function formatBatchEditResponse(result: BatchEditBlocksResult): string {
    let output = `## Batch Edit Results\n\n`;
    output += `**Status:** ${result.success ? '✅ All edits succeeded' : '⚠️ Some edits failed'}\n`;
    output += `**Total:** ${result.totalEdits} | **Succeeded:** ${result.successfulEdits} | **Failed:** ${result.failedEdits}\n\n`;
    
    if (result.results.length > 0) {
        output += `### Per-Edit Results\n\n`;
        for (const r of result.results) {
            const status = r.success ? '✅' : '❌';
            const label = r.label ? ` (${r.label})` : '';
            output += `${status} **Edit ${r.index + 1}**${label}: ${r.message}\n`;
        }
    }
    
    if (result.finalDiff) {
        output += `\n### Cumulative Diff\n\`\`\`diff\n${result.finalDiff}\n\`\`\``;
    }
    
    return output;
}

/**
 * Handle batch_edit_blocks tool call
 *
 * Applies multiple search/replace edits to a single file sequentially.
 * Each edit operates on the result of the previous edit, allowing for
 * dependent transformations. Supports atomic rollback via stopOnError.
 *
 * @param args - The batch edit arguments
 * @returns Promise resolving to BatchEditBlocksResult
 *
 * @example
 * ```typescript
 * const result = await handleBatchEditBlocks({
 *   path: '/path/to/file.ts',
 *   edits: [
 *     { search: 'oldFunc', replace: 'newFunc', label: 'Rename function' },
 *     { search: 'oldVar', replace: 'newVar', label: 'Rename variable' }
 *   ],
 *   dryRun: true
 * });
 * ```
 */
export async function handleBatchEditBlocks(args: BatchEditBlocksArgs): Promise<BatchEditBlocksResult> {
    const {
        path: filePath,
        edits,
        stopOnError = false,
        dryRun = false,
        fuzzyThreshold = DEFAULT_FUZZY_THRESHOLD
    } = args;
    
    // Handle empty edits edge case
    if (edits.length === 0) {
        const result: BatchEditBlocksResult = {
            success: true,
            totalEdits: 0,
            successfulEdits: 0,
            failedEdits: 0,
            results: []
        };
        await logAudit('batch_edit_blocks', { path: filePath, editCount: 0, dryRun }, result);
        return result;
    }
    
    // Check file exists
    if (!fs.existsSync(filePath)) {
        const result: BatchEditBlocksResult = {
            success: false,
            totalEdits: edits.length,
            successfulEdits: 0,
            failedEdits: 1,
            results: [{
                index: 0,
                label: edits[0].label,
                success: false,
                message: `File not found: ${filePath}`
            }]
        };
        await logAudit('batch_edit_blocks', { path: filePath, editCount: edits.length, dryRun }, result);
        return result;
    }
    
    // Read file once
    let content = fs.readFileSync(filePath, 'utf-8');
    const originalContent = content;
    const results: Array<{
        index: number;
        label?: string;
        success: boolean;
        message: string;
        diff?: string;
    }> = [];
    
    // Apply edits sequentially
    for (let i = 0; i < edits.length; i++) {
        const edit = edits[i];
        const editResult = performSingleEdit(content, edit, fuzzyThreshold, filePath);
        
        results.push({
            index: i,
            label: edit.label,
            success: editResult.success,
            message: editResult.message,
            diff: editResult.diff
        });
        
        if (editResult.success) {
            content = editResult.newContent;
        } else if (stopOnError) {
            break; // Stop but don't add more results
        }
    }
    
    // Write if any succeeded and not dry run
    const successCount = results.filter(r => r.success).length;
    if (successCount > 0 && !dryRun) {
        fs.writeFileSync(filePath, content, 'utf-8');
    }
    
    // Generate cumulative diff
    const finalDiffResult = generateDiff(originalContent, content, path.basename(filePath));
    
    const result: BatchEditBlocksResult = {
        success: results.every(r => r.success),
        totalEdits: edits.length,
        successfulEdits: successCount,
        failedEdits: results.filter(r => !r.success).length,
        results,
        finalDiff: finalDiffResult.unified
    };
    
    // 📝 Audit trail for batch operations
    await logAudit('batch_edit_blocks', { path: filePath, editCount: edits.length, dryRun }, result);

    return result;
}

/**
 * MCP handler wrapper for batch_edit_blocks
 * Formats the result for MCP response
 */
export async function handleBatchEditBlocksMcp(args: BatchEditBlocksArgs): Promise<McpResponse> {
    const result = await handleBatchEditBlocks(args);
    return {
        content: [{ type: 'text', text: formatBatchEditResponse(result) }],
        isError: !result.success
    };
}
