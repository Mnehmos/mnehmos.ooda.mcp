// apply_diff tool implementation
// Multi-block editing with support for multiple search/replace operations

import fs from 'fs';
import path from 'path';
import { logAudit } from '../../audit.js';
import { detectLineEnding, normalizeLineEndings } from './lineEndings.js';
import { 
    recursiveFuzzyIndexOf, 
    fuzzySearchNearLine,
    countOccurrences,
    DEFAULT_FUZZY_THRESHOLD 
} from './fuzzySearch.js';
import { generateDiff, summarizeDiff } from './diffVisualizer.js';

export interface DiffBlock {
    search: string;
    replace: string;
    startLine?: number;
}

export interface ApplyDiffArgs {
    path: string;
    diffs: DiffBlock[];
    dryRun?: boolean;
    allowFuzzy?: boolean;
    fuzzyThreshold?: number;
}

interface MatchedBlock {
    index: number;
    start: number;
    end: number;
    search: string;
    replace: string;
    exact: boolean;
    similarity?: number;
}

export interface ApplyDiffResult {
    success: boolean;
    applied: boolean;
    message: string;
    diff?: string;
    blocksMatched: number;
    blocksFailed: number;
    errors: string[];
}

/**
 * Handle apply_diff tool call
 * Applies multiple search/replace operations to a single file
 */
export async function handleApplyDiff(args: ApplyDiffArgs): Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
}> {
    const {
        path: filePath,
        diffs,
        dryRun = false,
        allowFuzzy = true,
        fuzzyThreshold = DEFAULT_FUZZY_THRESHOLD
    } = args;

    try {
        const result = await performApplyDiff(
            filePath,
            diffs,
            dryRun,
            allowFuzzy,
            fuzzyThreshold
        );

        await logAudit('apply_diff', {
            path: filePath,
            blockCount: diffs.length,
            dryRun,
            allowFuzzy
        }, result);

        return {
            content: [{
                type: 'text',
                text: formatApplyDiffResponse(result)
            }],
            isError: !result.success
        };

    } catch (error: any) {
        await logAudit('apply_diff', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
        };
    }
}

/**
 * Core apply_diff logic
 */
async function performApplyDiff(
    filePath: string,
    diffs: DiffBlock[],
    dryRun: boolean,
    allowFuzzy: boolean,
    fuzzyThreshold: number
): Promise<ApplyDiffResult> {
    // Validate inputs
    if (diffs.length === 0) {
        return {
            success: false,
            applied: false,
            message: 'No diff blocks provided.',
            blocksMatched: 0,
            blocksFailed: 0,
            errors: []
        };
    }

    // Check file exists
    if (!fs.existsSync(filePath)) {
        return {
            success: false,
            applied: false,
            message: `File not found: ${filePath}`,
            blocksMatched: 0,
            blocksFailed: diffs.length,
            errors: ['File not found']
        };
    }

    // Read file content
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileLineEnding = detectLineEnding(content);

    // Match all blocks first before applying any changes
    const matches: MatchedBlock[] = [];
    const errors: string[] = [];

    for (let i = 0; i < diffs.length; i++) {
        const block = diffs[i];
        const normalizedSearch = normalizeLineEndings(block.search, fileLineEnding);
        
        // Try exact match first
        const exactCount = countOccurrences(content, normalizedSearch);
        
        if (exactCount === 1) {
            // Perfect - exactly one match
            const start = content.indexOf(normalizedSearch);
            matches.push({
                index: i,
                start,
                end: start + normalizedSearch.length,
                search: normalizedSearch,
                replace: normalizeLineEndings(block.replace, fileLineEnding),
                exact: true
            });
        } else if (exactCount > 1) {
            // Multiple matches - ambiguous
            errors.push(`Block ${i + 1}: Found ${exactCount} occurrences (expected 1). Add more context to make the search unique.`);
        } else if (allowFuzzy) {
            // No exact match - try fuzzy
            let fuzzyMatch;
            if (block.startLine) {
                fuzzyMatch = fuzzySearchNearLine(content, normalizedSearch, block.startLine);
            } else {
                fuzzyMatch = recursiveFuzzyIndexOf(content, normalizedSearch);
            }

            if (fuzzyMatch.similarity >= fuzzyThreshold) {
                errors.push(
                    `Block ${i + 1}: Exact match not found. Found similar text with ${Math.round(fuzzyMatch.similarity * 100)}% similarity.\n` +
                    `  Use the exact text from file: "${fuzzyMatch.value.substring(0, 50)}${fuzzyMatch.value.length > 50 ? '...' : ''}"`
                );
            } else {
                errors.push(
                    `Block ${i + 1}: No match found. Best match was ${Math.round(fuzzyMatch.similarity * 100)}% similar (threshold: ${Math.round(fuzzyThreshold * 100)}%).`
                );
            }
        } else {
            errors.push(`Block ${i + 1}: Exact match not found and fuzzy matching is disabled.`);
        }
    }

    // Check for overlapping matches
    matches.sort((a, b) => a.start - b.start);
    for (let i = 1; i < matches.length; i++) {
        if (matches[i].start < matches[i - 1].end) {
            errors.push(
                `Block ${matches[i].index + 1} overlaps with block ${matches[i - 1].index + 1}. ` +
                `Overlapping replacements are not allowed.`
            );
        }
    }

    // If any errors, return without applying
    if (errors.length > 0) {
        return {
            success: false,
            applied: false,
            message: `Failed to match all blocks. ${matches.length}/${diffs.length} matched.`,
            blocksMatched: matches.length,
            blocksFailed: errors.length,
            errors
        };
    }

    // Apply all replacements (from end to start to preserve positions)
    matches.sort((a, b) => b.start - a.start);
    let newContent = content;
    for (const match of matches) {
        newContent = newContent.substring(0, match.start) +
                     match.replace +
                     newContent.substring(match.end);
    }

    // Generate diff
    const diffResult = generateDiff(content, newContent, path.basename(filePath));

    if (dryRun) {
        return {
            success: true,
            applied: false,
            message: `DRY RUN: Would apply ${matches.length} block(s) to ${filePath}`,
            diff: diffResult.unified,
            blocksMatched: matches.length,
            blocksFailed: 0,
            errors: []
        };
    }

    // Write the file
    fs.writeFileSync(filePath, newContent, 'utf-8');

    return {
        success: true,
        applied: true,
        message: `Successfully applied ${matches.length} block(s) to ${filePath}`,
        diff: diffResult.unified,
        blocksMatched: matches.length,
        blocksFailed: 0,
        errors: []
    };
}

/**
 * Format the result for display
 */
function formatApplyDiffResponse(result: ApplyDiffResult): string {
    let output = result.message;

    if (result.errors.length > 0) {
        output += '\n\n**Errors:**\n';
        for (const error of result.errors) {
            output += `- ${error}\n`;
        }
    }

    if (result.diff) {
        output += `\n**Changes:**\n\`\`\`diff\n${result.diff}\n\`\`\``;
    }

    return output;
}
