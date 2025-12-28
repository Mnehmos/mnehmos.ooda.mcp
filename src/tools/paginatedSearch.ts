// Paginated search functionality
// Allows starting async searches and retrieving paginated results

import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { logAudit } from '../audit.js';

// Search storage
interface SearchSession {
    id: string;
    pattern: string;
    directory: string;
    results: string[];
    completed: boolean;
    cursor: number;
    startTime: Date;
    error?: string;
}

const searchSessions: Map<string, SearchSession> = new Map();

// Generate unique search ID
function generateSearchId(): string {
    return `search_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// Schemas
export const StartSearchSchema = {
    directory: z.string().describe('Directory to search in'),
    pattern: z.string().describe('Glob pattern to match (e.g., "*.ts", "**/*.json")'),
    recursive: z.boolean().optional().describe('Search recursively (default: true)'),
    maxResults: z.number().optional().describe('Maximum results to collect (default: 10000)'),
};

export const GetSearchResultsSchema = {
    searchId: z.string().describe('Search session ID'),
    limit: z.number().optional().describe('Number of results to return (default: 100)'),
    offset: z.number().optional().describe('Offset from cursor position (default: 0)'),
};

export const ListSearchesSchema = {};

export const StopSearchSchema = {
    searchId: z.string().describe('Search session ID to stop and cleanup'),
};

/**
 * Recursively search for files matching pattern
 */
function searchDirectory(
    dir: string,
    pattern: RegExp,
    results: string[],
    maxResults: number,
    recursive: boolean
): void {
    if (results.length >= maxResults) return;

    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            if (results.length >= maxResults) break;

            const fullPath = path.join(dir, entry.name);

            if (pattern.test(entry.name)) {
                results.push(fullPath);
            }

            if (recursive && entry.isDirectory()) {
                try {
                    searchDirectory(fullPath, pattern, results, maxResults, recursive);
                } catch {
                    // Skip directories we can't access
                }
            }
        }
    } catch {
        // Skip directories we can't access
    }
}

/**
 * Convert glob pattern to regex
 */
function globToRegex(pattern: string): RegExp {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Start a new paginated search
 */
export async function handleStartSearch(args: {
    directory: string;
    pattern: string;
    recursive?: boolean;
    maxResults?: number;
}): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    try {
        const searchId = generateSearchId();
        const maxResults = args.maxResults || 10000;
        const recursive = args.recursive !== false;

        // Validate directory
        if (!fs.existsSync(args.directory)) {
            return {
                content: [{ type: 'text', text: `Error: Directory not found: ${args.directory}` }],
                isError: true,
            };
        }

        const session: SearchSession = {
            id: searchId,
            pattern: args.pattern,
            directory: args.directory,
            results: [],
            completed: false,
            cursor: 0,
            startTime: new Date(),
        };

        searchSessions.set(searchId, session);

        // Run search (synchronous for now, could be made async with worker threads)
        try {
            const regex = globToRegex(args.pattern);
            searchDirectory(args.directory, regex, session.results, maxResults, recursive);
            session.completed = true;
        } catch (err: any) {
            session.completed = true;
            session.error = err.message;
        }

        await logAudit('start_search', args, { searchId, totalFound: session.results.length });

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    searchId,
                    directory: args.directory,
                    pattern: args.pattern,
                    completed: session.completed,
                    totalFound: session.results.length,
                    error: session.error,
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('start_search', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

/**
 * Get search results with pagination
 */
export async function handleGetSearchResults(args: {
    searchId: string;
    limit?: number;
    offset?: number;
}): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    try {
        const session = searchSessions.get(args.searchId);

        if (!session) {
            return {
                content: [{ type: 'text', text: `Error: Search not found: ${args.searchId}` }],
                isError: true,
            };
        }

        const limit = args.limit || 100;
        const offset = args.offset || 0;
        const startIdx = session.cursor + offset;
        const endIdx = Math.min(startIdx + limit, session.results.length);

        const results = session.results.slice(startIdx, endIdx);

        // Update cursor for next call
        session.cursor = endIdx;

        await logAudit('get_search_results', args, { returned: results.length });

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    searchId: args.searchId,
                    completed: session.completed,
                    totalResults: session.results.length,
                    cursor: session.cursor,
                    hasMore: session.cursor < session.results.length,
                    returned: results.length,
                    results,
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('get_search_results', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

/**
 * List all active searches
 */
export async function handleListSearches(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const searches = Array.from(searchSessions.values()).map(s => ({
        searchId: s.id,
        pattern: s.pattern,
        directory: s.directory,
        completed: s.completed,
        totalResults: s.results.length,
        cursor: s.cursor,
        startTime: s.startTime.toISOString(),
        error: s.error,
    }));

    await logAudit('list_searches', {}, { count: searches.length });

    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                count: searches.length,
                searches,
            }, null, 2)
        }],
    };
}

/**
 * Stop a search and cleanup
 */
export async function handleStopSearch(args: {
    searchId: string;
}): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    try {
        const session = searchSessions.get(args.searchId);

        if (!session) {
            return {
                content: [{ type: 'text', text: `Error: Search not found: ${args.searchId}` }],
                isError: true,
            };
        }

        const stats = {
            searchId: args.searchId,
            pattern: session.pattern,
            totalResults: session.results.length,
            retrieved: session.cursor,
        };

        searchSessions.delete(args.searchId);

        await logAudit('stop_search', args, stats);

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    stopped: true,
                    ...stats,
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('stop_search', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}
