// get_diff_preview tool implementation
// Preview changes without applying them

import fs from 'fs';
import path from 'path';
import { logAudit } from '../../audit.js';
import { detectLineEnding, normalizeLineEndings } from './lineEndings.js';
import { countOccurrences, recursiveFuzzyIndexOf } from './fuzzySearch.js';
import { generateDiff, formatInlineDiff, formatSideBySide, summarizeDiff } from './diffVisualizer.js';

export interface GetDiffPreviewArgs {
    path: string;
    search: string;
    replace: string;
    format?: 'unified' | 'inline' | 'sidebyside';
    contextLines?: number;
}

export interface GetDiffPreviewResult {
    success: boolean;
    format: string;
    preview: string;
    stats: {
        additions: number;
        deletions: number;
        chunksChanged: number;
    };
    occurrencesFound: number;
}

/**
 * Handle get_diff_preview tool call
 * Generates a preview of changes without applying them
 */
export async function handleGetDiffPreview(args: GetDiffPreviewArgs): Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
}> {
    const {
        path: filePath,
        search,
        replace,
        format = 'unified',
        contextLines = 3
    } = args;

    try {
        const result = await performGetDiffPreview(
            filePath,
            search,
            replace,
            format,
            contextLines
        );

        await logAudit('get_diff_preview', {
            path: filePath,
            searchLength: search.length,
            replaceLength: replace.length,
            format
        }, { success: result.success });

        return {
            content: [{
                type: 'text',
                text: formatPreviewResponse(result)
            }],
            isError: !result.success
        };

    } catch (error: any) {
        await logAudit('get_diff_preview', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true
        };
    }
}

/**
 * Core get_diff_preview logic
 */
async function performGetDiffPreview(
    filePath: string,
    search: string,
    replace: string,
    format: 'unified' | 'inline' | 'sidebyside',
    contextLines: number
): Promise<GetDiffPreviewResult> {
    // Check file exists
    if (!fs.existsSync(filePath)) {
        return {
            success: false,
            format,
            preview: `File not found: ${filePath}`,
            stats: { additions: 0, deletions: 0, chunksChanged: 0 },
            occurrencesFound: 0
        };
    }

    // Read file content
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileLineEnding = detectLineEnding(content);
    
    // Normalize search string to match file's line endings
    const normalizedSearch = normalizeLineEndings(search, fileLineEnding);
    const normalizedReplace = normalizeLineEndings(replace, fileLineEnding);

    // Count occurrences
    const occurrences = countOccurrences(content, normalizedSearch);

    if (occurrences === 0) {
        // Try fuzzy match for feedback
        const fuzzyMatch = recursiveFuzzyIndexOf(content, normalizedSearch);
        return {
            success: false,
            format,
            preview: `Search text not found. Closest match (${Math.round(fuzzyMatch.similarity * 100)}% similar):\n"${fuzzyMatch.value.substring(0, 100)}${fuzzyMatch.value.length > 100 ? '...' : ''}"`,
            stats: { additions: 0, deletions: 0, chunksChanged: 0 },
            occurrencesFound: 0
        };
    }

    // Generate the preview content (replace first occurrence)
    const index = content.indexOf(normalizedSearch);
    const previewContent = content.substring(0, index) + 
                           normalizedReplace + 
                           content.substring(index + normalizedSearch.length);

    let preview: string;
    const diffResult = generateDiff(content, previewContent, path.basename(filePath), contextLines);

    switch (format) {
        case 'inline':
            preview = formatInlineDiff(normalizedSearch, normalizedReplace);
            break;
        case 'sidebyside':
            preview = formatSideBySide(normalizedSearch, normalizedReplace, 50);
            break;
        case 'unified':
        default:
            preview = diffResult.unified;
            break;
    }

    return {
        success: true,
        format,
        preview,
        stats: {
            additions: diffResult.stats.additions,
            deletions: diffResult.stats.deletions,
            chunksChanged: diffResult.stats.changes
        },
        occurrencesFound: occurrences
    };
}

/**
 * Format the result for display
 */
function formatPreviewResponse(result: GetDiffPreviewResult): string {
    if (!result.success) {
        return result.preview;
    }

    let output = `**Diff Preview (${result.format} format)**\n`;
    output += `Found ${result.occurrencesFound} occurrence(s)\n\n`;
    
    if (result.format === 'unified') {
        output += `\`\`\`diff\n${result.preview}\n\`\`\``;
    } else {
        output += `\`\`\`\n${result.preview}\n\`\`\``;
    }

    output += `\n\n**Stats:** ${summarizeDiff({ 
        hunks: [], 
        unified: '', 
        inline: '', 
        stats: {
            additions: result.stats.additions,
            deletions: result.stats.deletions,
            changes: result.stats.chunksChanged
        }
    })}`;

    return output;
}
