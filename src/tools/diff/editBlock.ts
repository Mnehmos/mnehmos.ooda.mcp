// edit_block tool implementation
// Enhanced str_replace with fuzzy fallback and diff visualization

import fs from 'fs';
import path from 'path';
import { logAudit } from '../../audit.js';
import { detectLineEnding, normalizeLineEndings, describeLineEndingDifference } from './lineEndings.js';
import { 
    recursiveFuzzyIndexOf, 
    getSimilarityRatio, 
    countOccurrences,
    DEFAULT_FUZZY_THRESHOLD 
} from './fuzzySearch.js';
import { generateDiff, formatInlineDiff, summarizeDiff } from './diffVisualizer.js';

export interface EditBlockArgs {
    path: string;
    search: string;
    replace: string;
    expectedReplacements?: number;
    fuzzyThreshold?: number;
    dryRun?: boolean;
}

export interface EditBlockResult {
    success: boolean;
    applied: boolean;
    message: string;
    diff?: string;
    fuzzyMatch?: {
        similarity: number;
        foundText: string;
        inlineDiff: string;
    };
    occurrencesFound?: number;
    occurrencesExpected?: number;
}

/**
 * Handle edit_block tool call
 * Performs a search/replace operation with fuzzy fallback and diff preview
 */
export async function handleEditBlock(args: EditBlockArgs): Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
}> {
    const {
        path: filePath,
        search,
        replace,
        expectedReplacements = 1,
        fuzzyThreshold = DEFAULT_FUZZY_THRESHOLD,
        dryRun = false
    } = args;

    try {
        const result = await performEditBlock(
            filePath,
            search,
            replace,
            expectedReplacements,
            fuzzyThreshold,
            dryRun
        );

        await logAudit('edit_block', {
            path: filePath,
            searchLength: search.length,
            replaceLength: replace.length,
            expectedReplacements,
            dryRun
        }, result);

        return {
            content: [{
                type: 'text',
                text: formatEditBlockResponse(result)
            }],
            isError: !result.success
        };

    } catch (error: any) {
        await logAudit('edit_block', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
        };
    }
}

/**
 * Core edit_block logic
 */
async function performEditBlock(
    filePath: string,
    search: string,
    replace: string,
    expectedReplacements: number,
    fuzzyThreshold: number,
    dryRun: boolean
): Promise<EditBlockResult> {
    // Validate inputs
    if (search === '') {
        return {
            success: false,
            applied: false,
            message: 'Empty search strings are not allowed. Please provide a non-empty string to search for.'
        };
    }

    // Check file exists
    if (!fs.existsSync(filePath)) {
        return {
            success: false,
            applied: false,
            message: `File not found: ${filePath}`
        };
    }

    // Read file content
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileLineEnding = detectLineEnding(content);
    
    // Normalize search string to match file's line endings
    const normalizedSearch = normalizeLineEndings(search, fileLineEnding);
    const normalizedReplace = normalizeLineEndings(replace, fileLineEnding);

    // Count exact occurrences
    const exactCount = countOccurrences(content, normalizedSearch);

    // Case 1: Exact match found with correct count
    if (exactCount > 0 && exactCount === expectedReplacements) {
        // Perform the replacement
        let newContent: string;
        if (expectedReplacements === 1) {
            // Replace only the first occurrence
            const index = content.indexOf(normalizedSearch);
            newContent = content.substring(0, index) + 
                         normalizedReplace + 
                         content.substring(index + normalizedSearch.length);
        } else {
            // Replace all occurrences
            newContent = content.split(normalizedSearch).join(normalizedReplace);
        }

        // Generate diff for preview
        const diffResult = generateDiff(content, newContent, path.basename(filePath));

        if (dryRun) {
            return {
                success: true,
                applied: false,
                message: `DRY RUN: Would apply ${expectedReplacements} replacement(s) to ${filePath}`,
                diff: diffResult.unified,
                occurrencesFound: exactCount,
                occurrencesExpected: expectedReplacements
            };
        }

        // Apply the change
        fs.writeFileSync(filePath, newContent, 'utf-8');

        return {
            success: true,
            applied: true,
            message: `Successfully applied ${expectedReplacements} replacement(s) to ${filePath}`,
            diff: diffResult.unified,
            occurrencesFound: exactCount,
            occurrencesExpected: expectedReplacements
        };
    }

    // Case 2: Exact match found but wrong count
    if (exactCount > 0 && exactCount !== expectedReplacements) {
        return {
            success: false,
            applied: false,
            message: `Expected ${expectedReplacements} occurrence(s) but found ${exactCount} in ${filePath}.\n\n` +
                     `Options:\n` +
                     `1. Set expectedReplacements to ${exactCount} to replace all occurrences\n` +
                     `2. Add more context to your search string to match only the specific occurrence(s) you want`,
            occurrencesFound: exactCount,
            occurrencesExpected: expectedReplacements
        };
    }

    // Case 3: No exact match - try fuzzy search
    const fuzzyMatch = recursiveFuzzyIndexOf(content, normalizedSearch);
    const similarity = fuzzyMatch.similarity;

    // Check for line ending differences
    const lineEndingDiff = describeLineEndingDifference(search, content);

    // Generate inline diff to show what's different
    const inlineDiff = formatInlineDiff(normalizedSearch, fuzzyMatch.value);

    if (similarity >= fuzzyThreshold) {
        // Good fuzzy match found - show preview and request confirmation
        const previewContent = content.substring(0, fuzzyMatch.start) +
                               normalizedReplace +
                               content.substring(fuzzyMatch.end);
        const diffResult = generateDiff(content, previewContent, path.basename(filePath));

        return {
            success: false, // Not applied automatically - requires confirmation
            applied: false,
            message: `Exact match not found, but found similar text with ${Math.round(similarity * 100)}% similarity.\n\n` +
                     `Character differences:\n${inlineDiff}\n\n` +
                     (lineEndingDiff ? `Note: ${lineEndingDiff}\n\n` : '') +
                     `To apply this edit, use the exact text from the file:\n\`\`\`\n${fuzzyMatch.value}\n\`\`\`\n\n` +
                     `Preview of changes:\n${diffResult.unified}`,
            diff: diffResult.unified,
            fuzzyMatch: {
                similarity,
                foundText: fuzzyMatch.value,
                inlineDiff
            },
            occurrencesFound: 0,
            occurrencesExpected: expectedReplacements
        };
    }

    // Case 4: No good match found
    return {
        success: false,
        applied: false,
        message: `Search text not found in ${filePath}.\n\n` +
                 `The closest match was ${Math.round(similarity * 100)}% similar (threshold: ${Math.round(fuzzyThreshold * 100)}%).\n\n` +
                 `Character differences:\n${inlineDiff}\n\n` +
                 (lineEndingDiff ? `Note: ${lineEndingDiff}\n\n` : '') +
                 `Suggestions:\n` +
                 `1. Copy the exact text from the file\n` +
                 `2. Use read_file_lines to view the current content\n` +
                 `3. Check for whitespace or line ending differences`,
        fuzzyMatch: {
            similarity,
            foundText: fuzzyMatch.value,
            inlineDiff
        },
        occurrencesFound: 0,
        occurrencesExpected: expectedReplacements
    };
}

/**
 * Format the result for display
 */
function formatEditBlockResponse(result: EditBlockResult): string {
    let output = result.message;

    // Add diff if available and not already in message
    if (result.diff && !result.message.includes('Preview of changes')) {
        output += `\n\n**Changes:**\n\`\`\`diff\n${result.diff}\n\`\`\``;
    }

    return output;
}
