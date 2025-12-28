// Zod schemas for diff editing tools
import { z } from 'zod';

/**
 * Schema for edit_block tool - single search/replace with fuzzy fallback
 */
export const EditBlockSchema = {
    path: z.string().describe('Absolute path to the file to edit'),
    search: z.string().describe('The exact text to search for in the file'),
    replace: z.string().describe('The text to replace the search text with'),
    expectedReplacements: z.number().optional().default(1)
        .describe('Expected number of occurrences to replace (default: 1). If the actual count differs, an error is returned.'),
    fuzzyThreshold: z.number().optional().default(0.7)
        .describe('Similarity threshold (0-1) for fuzzy fallback when exact match fails (default: 0.7)'),
    dryRun: z.boolean().optional().default(false)
        .describe('If true, returns a diff preview without applying changes'),
};

/**
 * Schema for apply_diff tool - multi-block editing
 */
export const ApplyDiffSchema = {
    path: z.string().describe('Absolute path to the file to edit'),
    diffs: z.array(z.object({
        search: z.string().describe('Text to search for'),
        replace: z.string().describe('Text to replace with'),
        startLine: z.number().optional().describe('Optional hint: approximate line number where search text starts (1-indexed)'),
    })).describe('Array of search/replace blocks to apply in order'),
    dryRun: z.boolean().optional().default(false)
        .describe('If true, returns a diff preview without applying changes'),
    allowFuzzy: z.boolean().optional().default(true)
        .describe('Allow fuzzy matching when exact match fails (default: true)'),
    fuzzyThreshold: z.number().optional().default(0.7)
        .describe('Similarity threshold for fuzzy matching (default: 0.7)'),
};

/**
 * Schema for get_diff_preview tool - visualization only
 */
export const GetDiffPreviewSchema = {
    path: z.string().describe('Absolute path to the file'),
    search: z.string().describe('Text to search for'),
    replace: z.string().describe('Text to replace with'),
    format: z.enum(['unified', 'inline', 'sidebyside']).optional().default('unified')
        .describe('Output format: unified (git-style), inline (character-level), or sidebyside'),
    contextLines: z.number().optional().default(3)
        .describe('Number of context lines around changes (default: 3)'),
};

/**
 * Schema for batch_edit_blocks tool - multiple files or multiple edits
 */
export const BatchEditBlocksSchema = {
    edits: z.array(z.object({
        path: z.string().describe('Absolute path to the file to edit'),
        search: z.string().describe('Text to search for'),
        replace: z.string().describe('Text to replace with'),
        expectedReplacements: z.number().optional().default(1)
            .describe('Expected number of occurrences'),
    })).describe('Array of edit operations to perform'),
    dryRun: z.boolean().optional().default(false)
        .describe('If true, returns diff previews without applying changes'),
    stopOnError: z.boolean().optional().default(false)
        .describe('If true, stops execution when an edit fails'),
    fuzzyThreshold: z.number().optional().default(0.7)
        .describe('Similarity threshold for fuzzy matching'),
};

// Type exports for handler functions
export type EditBlockArgs = z.infer<z.ZodObject<typeof EditBlockSchema>>;
export type ApplyDiffArgs = z.infer<z.ZodObject<typeof ApplyDiffSchema>>;
export type GetDiffPreviewArgs = z.infer<z.ZodObject<typeof GetDiffPreviewSchema>>;
export type BatchEditBlocksArgs = z.infer<z.ZodObject<typeof BatchEditBlocksSchema>>;
