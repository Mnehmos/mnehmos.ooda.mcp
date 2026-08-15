import fs from 'fs';
import { z } from 'zod';
import { logAudit } from '../audit.js';

type LineContext = {
    before: Array<{ lineNumber: number; line: string }>;
    after: Array<{ lineNumber: number; line: string }>;
};

type SearchMatch = {
    lineNumber: number;
    line: string;
    similarity?: number;
    matchedText?: string;
    context?: LineContext;
};

export type SearchInFileArgs = {
    path: string;
    pattern: string;
    isRegex?: boolean;
    caseSensitive?: boolean;
    contextLines?: number;
    maxMatches?: number;
};

export type BatchSearchInFilesArgs = {
    searches: Array<{ path: string; pattern: string }>;
    isRegex?: boolean;
    isFuzzy?: boolean;
    fuzzyThreshold?: number;
    caseSensitive?: boolean;
    contextLines?: number;
    maxMatchesPerFile?: number;
};

type FileSearchResult = {
    path: string;
    pattern: string;
    success: boolean;
    error?: string;
    totalLines?: number;
    matchCount?: number;
    matches?: SearchMatch[];
};

// Search for patterns within a file and return matching lines.
export const SearchInFileSchema = {
    path: z.string().describe('Path to the file to search'),
    pattern: z.string().describe('Text or regex pattern to search for'),
    isRegex: z.boolean().optional().describe('Treat pattern as regex (default: false)'),
    caseSensitive: z.boolean().optional().describe('Case sensitive search (default: true)'),
    contextLines: z.number().optional().describe('Number of lines of context before and after matches (default: 0)'),
    maxMatches: z.number().optional().describe('Maximum number of matches to return (default: 100)'),
};

// Batch search in files schema - supports fuzzy/approximate matching.
export const BatchSearchInFilesSchema = {
    searches: z.array(z.object({
        path: z.string().describe('Path to the file to search'),
        pattern: z.string().describe('Text, regex, or fuzzy pattern to search for'),
    })).describe('Array of file paths and patterns to search'),
    isRegex: z.boolean().optional().describe('Treat patterns as regex (default: false)'),
    isFuzzy: z.boolean().optional().describe('Use fuzzy/approximate matching (default: false)'),
    fuzzyThreshold: z.number().optional().describe('Similarity threshold for fuzzy matching 0-1 (default: 0.7)'),
    caseSensitive: z.boolean().optional().describe('Case sensitive search (default: true)'),
    contextLines: z.number().optional().describe('Number of lines of context before and after matches (default: 0)'),
    maxMatchesPerFile: z.number().optional().describe('Maximum matches per file (default: 50)'),
};

function buildSearchRegex(pattern: string, isRegex: boolean, caseSensitive: boolean): RegExp {
    const source = isRegex
        ? pattern
        : pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(source, caseSensitive ? 'g' : 'gi');
}

function getLineContext(lines: string[], lineIndex: number, contextLines: number): LineContext | undefined {
    if (contextLines <= 0) {
        return undefined;
    }

    const before: Array<{ lineNumber: number; line: string }> = [];
    const after: Array<{ lineNumber: number; line: string }> = [];

    for (let i = Math.max(0, lineIndex - contextLines); i < lineIndex; i++) {
        before.push({ lineNumber: i + 1, line: lines[i] });
    }
    for (let i = lineIndex + 1; i <= Math.min(lines.length - 1, lineIndex + contextLines); i++) {
        after.push({ lineNumber: i + 1, line: lines[i] });
    }

    return { before, after };
}

function findRegexMatches(
    lines: string[],
    regex: RegExp,
    maxMatches: number,
    contextLines: number
): SearchMatch[] {
    const matches: SearchMatch[] = [];

    for (let i = 0; i < lines.length && matches.length < maxMatches; i++) {
        if (regex.test(lines[i])) {
            const match: SearchMatch = {
                lineNumber: i + 1,
                line: lines[i],
            };
            const context = getLineContext(lines, i, contextLines);
            if (context) {
                match.context = context;
            }
            matches.push(match);
        }
        regex.lastIndex = 0;
    }

    return matches;
}

export async function handleSearchInFile(args: SearchInFileArgs) {
    try {
        const content = fs.readFileSync(args.path, 'utf-8');
        const lines = content.split('\n');
        const totalLines = lines.length;
        const isRegex = args.isRegex ?? false;
        const caseSensitive = args.caseSensitive !== false;
        const contextLines = args.contextLines ?? 0;
        const maxMatches = args.maxMatches ?? 100;

        let regex: RegExp;
        try {
            regex = buildSearchRegex(args.pattern, isRegex, caseSensitive);
        } catch (regexError: any) {
            return {
                content: [{ type: 'text', text: `Error: Invalid regex pattern: ${regexError.message}` }],
                isError: true,
            };
        }

        const matches = findRegexMatches(lines, regex, maxMatches, contextLines);

        await logAudit('search_in_file', { path: args.path, pattern: args.pattern }, `found ${matches.length} matches`);

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    path: args.path,
                    pattern: args.pattern,
                    totalLines,
                    matchCount: matches.length,
                    truncated: matches.length >= maxMatches,
                    matches
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('search_in_file', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error searching file: ${error.message}` }],
            isError: true,
        };
    }
}

function levenshteinDistance(s1: string, s2: string): number {
    const m = s1.length;
    const n = s2.length;

    if (m === 0) return n;
    if (n === 0) return m;

    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            );
        }
    }

    return dp[m][n];
}

function similarityRatio(s1: string, s2: string): number {
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1;
    return 1 - (levenshteinDistance(s1, s2) / maxLen);
}

function findFuzzyMatches(
    line: string,
    pattern: string,
    threshold: number,
    caseSensitive: boolean
): Array<{ start: number; end: number; matched: string; similarity: number }> {
    const matches: Array<{ start: number; end: number; matched: string; similarity: number }> = [];
    const searchLine = caseSensitive ? line : line.toLowerCase();
    const searchPattern = caseSensitive ? pattern : pattern.toLowerCase();
    const patternLen = pattern.length;

    for (let i = 0; i <= searchLine.length - patternLen; i++) {
        const window = searchLine.substring(i, i + patternLen);
        const similarity = similarityRatio(window, searchPattern);

        if (similarity >= threshold) {
            matches.push({
                start: i,
                end: i + patternLen,
                matched: line.substring(i, i + patternLen),
                similarity
            });
            i += Math.floor(patternLen / 2);
        }
    }

    for (const lenDelta of [-2, -1, 1, 2]) {
        const windowLen = patternLen + lenDelta;
        if (windowLen < 2) continue;

        for (let i = 0; i <= searchLine.length - windowLen; i++) {
            const window = searchLine.substring(i, i + windowLen);
            const similarity = similarityRatio(window, searchPattern);

            if (similarity >= threshold) {
                const hasOverlap = matches.some(m =>
                    (i >= m.start && i < m.end) ||
                    (i + windowLen > m.start && i + windowLen <= m.end)
                );

                if (!hasOverlap) {
                    matches.push({
                        start: i,
                        end: i + windowLen,
                        matched: line.substring(i, i + windowLen),
                        similarity
                    });
                }
            }
        }
    }

    return matches.sort((a, b) => a.start - b.start);
}

function searchOneFile(
    search: { path: string; pattern: string },
    options: {
        isRegex: boolean;
        isFuzzy: boolean;
        fuzzyThreshold: number;
        caseSensitive: boolean;
        contextLines: number;
        maxMatchesPerFile: number;
    }
): FileSearchResult {
    try {
        const content = fs.readFileSync(search.path, 'utf-8');
        const lines = content.split('\n');
        const matches: SearchMatch[] = [];

        if (options.isFuzzy) {
            for (let i = 0; i < lines.length && matches.length < options.maxMatchesPerFile; i++) {
                const fuzzyMatches = findFuzzyMatches(
                    lines[i],
                    search.pattern,
                    options.fuzzyThreshold,
                    options.caseSensitive
                );

                for (const fuzzyMatch of fuzzyMatches) {
                    if (matches.length >= options.maxMatchesPerFile) break;

                    const match: SearchMatch = {
                        lineNumber: i + 1,
                        line: lines[i],
                        similarity: Math.round(fuzzyMatch.similarity * 100) / 100,
                        matchedText: fuzzyMatch.matched
                    };
                    const context = getLineContext(lines, i, options.contextLines);
                    if (context) {
                        match.context = context;
                    }
                    matches.push(match);
                }
            }
        } else {
            let regex: RegExp;
            try {
                regex = buildSearchRegex(search.pattern, options.isRegex, options.caseSensitive);
            } catch (regexError: any) {
                return {
                    path: search.path,
                    pattern: search.pattern,
                    success: false,
                    error: `Invalid regex: ${regexError.message}`
                };
            }
            matches.push(...findRegexMatches(
                lines,
                regex,
                options.maxMatchesPerFile,
                options.contextLines
            ));
        }

        return {
            path: search.path,
            pattern: search.pattern,
            success: true,
            totalLines: lines.length,
            matchCount: matches.length,
            matches
        };
    } catch (error: any) {
        return {
            path: search.path,
            pattern: search.pattern,
            success: false,
            error: error.message
        };
    }
}

export async function handleBatchSearchInFiles(args: BatchSearchInFilesArgs) {
    const startTime = Date.now();
    const options = {
        isRegex: args.isRegex ?? false,
        isFuzzy: args.isFuzzy ?? false,
        fuzzyThreshold: args.fuzzyThreshold ?? 0.7,
        caseSensitive: args.caseSensitive !== false,
        contextLines: args.contextLines ?? 0,
        maxMatchesPerFile: args.maxMatchesPerFile ?? 50,
    };

    const results = await Promise.all(args.searches.map(search => searchOneFile(search, options)));
    const successful = results.filter(result => result.success).length;
    const failed = results.filter(result => !result.success).length;
    const totalMatches = results.reduce((sum, result) => sum + (result.matchCount || 0), 0);
    const elapsed = Date.now() - startTime;

    await logAudit('batch_search_in_files', {
        count: args.searches.length,
        isRegex: options.isRegex,
        isFuzzy: options.isFuzzy,
        fuzzyThreshold: options.isFuzzy ? options.fuzzyThreshold : undefined
    }, { successful, failed, totalMatches, elapsed });

    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                summary: {
                    total: args.searches.length,
                    successful,
                    failed,
                    totalMatches,
                    searchMode: options.isFuzzy ? 'fuzzy' : (options.isRegex ? 'regex' : 'literal'),
                    elapsed_ms: elapsed
                },
                results
            }, null, 2)
        }],
        isError: failed > 0 && successful === 0,
    };
}
