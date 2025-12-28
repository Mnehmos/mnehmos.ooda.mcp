// Analytics and usage statistics tools
// Get usage stats, recent tool calls, and log management

import { z } from 'zod';
import { getDb } from '../storage/db.js';
import { logAudit } from '../audit.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Schemas
export const GetUsageStatsSchema = {
    since: z.string().optional().describe('ISO date string to filter stats from (e.g., "2024-01-01"). Default: last 30 days.'),
    limit: z.number().optional().describe('Number of top tools to return (default: 20)'),
};

export const GetRecentToolCallsSchema = {
    tool: z.string().optional().describe('Filter by tool name'),
    limit: z.number().optional().describe('Number of recent calls to return (default: 50)'),
    includeArgs: z.boolean().optional().describe('Include full arguments in response (default: false for privacy)'),
};

export const GetAuditLogStatsSchema = {};

export const ClearOldLogsSchema = {
    olderThanDays: z.number().describe('Delete logs older than this many days'),
    dryRun: z.boolean().optional().describe('If true, show what would be deleted without deleting (default: false)'),
};

/**
 * Get usage statistics for tools
 */
export async function handleGetUsageStats(args: {
    since?: string;
    limit?: number;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
        const db = await getDb();
        const limit = args.limit || 20;
        
        // Default to last 30 days
        const sinceDate = args.since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

        // Get tool usage counts
        const toolStats = await db.all(`
            SELECT 
                tool,
                COUNT(*) as call_count,
                SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as error_count,
                MIN(timestamp) as first_call,
                MAX(timestamp) as last_call
            FROM audit_log
            WHERE timestamp >= ?
            GROUP BY tool
            ORDER BY call_count DESC
            LIMIT ?
        `, sinceDate, limit);

        // Get total stats
        const totalStats = await db.get(`
            SELECT 
                COUNT(*) as total_calls,
                COUNT(DISTINCT tool) as unique_tools,
                SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as total_errors,
                MIN(timestamp) as earliest,
                MAX(timestamp) as latest
            FROM audit_log
            WHERE timestamp >= ?
        `, sinceDate);

        // Get hourly distribution
        const hourlyDist = await db.all(`
            SELECT 
                strftime('%H', timestamp) as hour,
                COUNT(*) as count
            FROM audit_log
            WHERE timestamp >= ?
            GROUP BY hour
            ORDER BY hour
        `, sinceDate);

        await logAudit('get_usage_stats', args, 'success');

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    period: {
                        since: sinceDate,
                        until: new Date().toISOString(),
                    },
                    summary: totalStats,
                    topTools: toolStats,
                    hourlyDistribution: hourlyDist,
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('get_usage_stats', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
        };
    }
}

/**
 * Get recent tool calls
 */
export async function handleGetRecentToolCalls(args: {
    tool?: string;
    limit?: number;
    includeArgs?: boolean;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
        const db = await getDb();
        const limit = args.limit || 50;
        const includeArgs = args.includeArgs || false;

        let query: string;
        let params: any[];

        if (args.tool) {
            query = `
                SELECT id, timestamp, tool, ${includeArgs ? 'args,' : ''} result, error
                FROM audit_log
                WHERE tool = ?
                ORDER BY timestamp DESC
                LIMIT ?
            `;
            params = [args.tool, limit];
        } else {
            query = `
                SELECT id, timestamp, tool, ${includeArgs ? 'args,' : ''} result, error
                FROM audit_log
                ORDER BY timestamp DESC
                LIMIT ?
            `;
            params = [limit];
        }

        const calls = await db.all(query, ...params);

        // Parse JSON fields
        const parsedCalls = calls.map((call: any) => ({
            ...call,
            args: includeArgs && call.args ? JSON.parse(call.args) : undefined,
            result: call.result ? JSON.parse(call.result) : null,
            error: call.error ? JSON.parse(call.error) : null,
        }));

        await logAudit('get_recent_tool_calls', args, `returned ${calls.length} calls`);

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    filter: args.tool || 'all',
                    count: parsedCalls.length,
                    calls: parsedCalls,
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('get_recent_tool_calls', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
        };
    }
}

/**
 * Get audit log statistics (size, entries, etc.)
 */
export async function handleGetAuditLogStats(): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
        const db = await getDb();

        // Get counts
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total_entries,
                COUNT(DISTINCT tool) as unique_tools,
                MIN(timestamp) as oldest_entry,
                MAX(timestamp) as newest_entry
            FROM audit_log
        `);

        // Get database file size
        const homeDir = os.homedir();
        const dbPath = path.join(homeDir, '.mcp', 'workspace.db');
        let dbSize = 0;
        try {
            const stat = fs.statSync(dbPath);
            dbSize = stat.size;
        } catch {
            // File might not exist
        }

        await logAudit('get_audit_log_stats', {}, 'success');

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    databasePath: dbPath,
                    databaseSizeBytes: dbSize,
                    databaseSizeMB: (dbSize / 1024 / 1024).toFixed(2),
                    ...stats,
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('get_audit_log_stats', {}, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
        };
    }
}

/**
 * Clear old log entries
 */
export async function handleClearOldLogs(args: {
    olderThanDays: number;
    dryRun?: boolean;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
        const db = await getDb();
        const cutoffDate = new Date(Date.now() - args.olderThanDays * 24 * 60 * 60 * 1000).toISOString();
        const dryRun = args.dryRun !== false;

        // Count entries to delete
        const countResult = await db.get(`
            SELECT COUNT(*) as count FROM audit_log WHERE timestamp < ?
        `, cutoffDate);

        if (dryRun) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        dryRun: true,
                        wouldDelete: countResult.count,
                        cutoffDate,
                        olderThanDays: args.olderThanDays,
                    }, null, 2)
                }],
            };
        }

        // Actually delete
        await db.run(`DELETE FROM audit_log WHERE timestamp < ?`, cutoffDate);

        await logAudit('clear_old_logs', args, `deleted ${countResult.count} entries`);

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    deleted: countResult.count,
                    cutoffDate,
                    olderThanDays: args.olderThanDays,
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('clear_old_logs', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
        };
    }
}
