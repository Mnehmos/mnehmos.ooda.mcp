import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { logAudit } from '../audit.js';

// Single operation schemas
export const CopyFileSchema = {
    source: z.string().describe('Source file path'),
    destination: z.string().describe('Destination file path'),
    overwrite: z.boolean().optional().describe('Overwrite if destination exists (default: false)'),
};

export const MoveFileSchema = {
    source: z.string().describe('Source file path'),
    destination: z.string().describe('Destination file path'),
    overwrite: z.boolean().optional().describe('Overwrite if destination exists (default: false)'),
};

export const DeleteFileSchema = {
    path: z.string().describe('File or directory path to delete'),
    recursive: z.boolean().optional().describe('Recursively delete directories (default: false)'),
};

export const FileInfoSchema = {
    path: z.string().describe('Path to get info for'),
};

export const SearchFilesSchema = {
    directory: z.string().describe('Directory to search in'),
    pattern: z.string().describe('Glob pattern or regex to match files'),
    recursive: z.boolean().optional().describe('Search recursively (default: true)'),
    maxResults: z.number().optional().describe('Maximum number of results (default: 100)'),
};

// Batch operation schemas
export const BatchCopyFilesSchema = {
    operations: z.array(z.object({
        source: z.string(),
        destination: z.string(),
        overwrite: z.boolean().optional(),
    })).describe('Array of copy operations to execute in parallel'),
};

export const BatchMoveFilesSchema = {
    operations: z.array(z.object({
        source: z.string(),
        destination: z.string(),
        overwrite: z.boolean().optional(),
    })).describe('Array of move operations to execute in parallel'),
};

export const BatchDeleteFilesSchema = {
    paths: z.array(z.string()).describe('Array of file/directory paths to delete in parallel'),
    recursive: z.boolean().optional().describe('Recursively delete directories (default: false)'),
};

export const BatchFileInfoSchema = {
    paths: z.array(z.string()).describe('Array of paths to get info for in parallel'),
};

// Batch result interface
interface BatchResult {
    index: number;
    success: boolean;
    result?: any;
    error?: string;
}

// Single operation handlers
export async function handleCopyFile(args: { source: string; destination: string; overwrite?: boolean }) {
    try {
        if (!args.overwrite && fs.existsSync(args.destination)) {
            throw new Error(`Destination already exists: ${args.destination}`);
        }

        const destDir = path.dirname(args.destination);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        fs.copyFileSync(args.source, args.destination);
        await logAudit('copy_file', args, 'success');

        return {
            content: [{ type: 'text', text: `Successfully copied ${args.source} to ${args.destination}` }],
        };
    } catch (error: any) {
        await logAudit('copy_file', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleMoveFile(args: { source: string; destination: string; overwrite?: boolean }) {
    try {
        if (!args.overwrite && fs.existsSync(args.destination)) {
            throw new Error(`Destination already exists: ${args.destination}`);
        }

        const destDir = path.dirname(args.destination);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        fs.renameSync(args.source, args.destination);
        await logAudit('move_file', args, 'success');

        return {
            content: [{ type: 'text', text: `Successfully moved ${args.source} to ${args.destination}` }],
        };
    } catch (error: any) {
        await logAudit('move_file', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleDeleteFile(args: { path: string; recursive?: boolean }) {
    try {
        const stats = fs.statSync(args.path);

        if (stats.isDirectory()) {
            if (args.recursive) {
                fs.rmSync(args.path, { recursive: true, force: true });
            } else {
                fs.rmdirSync(args.path);
            }
        } else {
            fs.unlinkSync(args.path);
        }

        await logAudit('delete_file', args, 'success');

        return {
            content: [{ type: 'text', text: `Successfully deleted ${args.path}` }],
        };
    } catch (error: any) {
        await logAudit('delete_file', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleFileInfo(args: { path: string }) {
    try {
        const stats = fs.statSync(args.path);

        const info = {
            path: args.path,
            exists: true,
            isFile: stats.isFile(),
            isDirectory: stats.isDirectory(),
            isSymbolicLink: stats.isSymbolicLink(),
            size: stats.size,
            sizeHuman: formatBytes(stats.size),
            created: stats.birthtime.toISOString(),
            modified: stats.mtime.toISOString(),
            accessed: stats.atime.toISOString(),
            mode: stats.mode.toString(8),
        };

        await logAudit('file_info', args, 'success');

        return {
            content: [{ type: 'text', text: JSON.stringify(info, null, 2) }],
        };
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return {
                content: [{ type: 'text', text: JSON.stringify({ path: args.path, exists: false }, null, 2) }],
            };
        }
        await logAudit('file_info', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleSearchFiles(args: { directory: string; pattern: string; recursive?: boolean; maxResults?: number }) {
    try {
        const recursive = args.recursive !== false;
        const maxResults = args.maxResults || 100;
        const results: string[] = [];

        const regex = patternToRegex(args.pattern);

        function searchDir(dir: string) {
            if (results.length >= maxResults) return;

            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                if (results.length >= maxResults) break;

                const fullPath = path.join(dir, entry.name);

                if (regex.test(entry.name)) {
                    results.push(fullPath);
                }

                if (recursive && entry.isDirectory()) {
                    try {
                        searchDir(fullPath);
                    } catch {
                        // Skip directories we can't access
                    }
                }
            }
        }

        searchDir(args.directory);

        await logAudit('search_files', args, `found ${results.length} files`);

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    pattern: args.pattern,
                    directory: args.directory,
                    matchCount: results.length,
                    truncated: results.length >= maxResults,
                    matches: results
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('search_files', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

// Batch operation handlers
export async function handleBatchCopyFiles(args: { operations: Array<{ source: string; destination: string; overwrite?: boolean }> }) {
    const startTime = Date.now();

    const results = await Promise.all(
        args.operations.map(async (op, index): Promise<BatchResult> => {
            try {
                if (!op.overwrite && fs.existsSync(op.destination)) {
                    return { index, success: false, error: `Destination exists: ${op.destination}` };
                }

                const destDir = path.dirname(op.destination);
                if (!fs.existsSync(destDir)) {
                    fs.mkdirSync(destDir, { recursive: true });
                }

                fs.copyFileSync(op.source, op.destination);
                return { index, success: true, result: { source: op.source, destination: op.destination } };
            } catch (error: any) {
                return { index, success: false, error: error.message };
            }
        })
    );

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const elapsed = Date.now() - startTime;

    await logAudit('batch_copy_files', { count: args.operations.length }, { successful, failed, elapsed });

    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                summary: { total: args.operations.length, successful, failed, elapsed_ms: elapsed },
                results: results.sort((a, b) => a.index - b.index)
            }, null, 2)
        }],
        isError: failed > 0 && successful === 0,
    };
}

export async function handleBatchMoveFiles(args: { operations: Array<{ source: string; destination: string; overwrite?: boolean }> }) {
    const startTime = Date.now();

    const results = await Promise.all(
        args.operations.map(async (op, index): Promise<BatchResult> => {
            try {
                if (!op.overwrite && fs.existsSync(op.destination)) {
                    return { index, success: false, error: `Destination exists: ${op.destination}` };
                }

                const destDir = path.dirname(op.destination);
                if (!fs.existsSync(destDir)) {
                    fs.mkdirSync(destDir, { recursive: true });
                }

                fs.renameSync(op.source, op.destination);
                return { index, success: true, result: { source: op.source, destination: op.destination } };
            } catch (error: any) {
                return { index, success: false, error: error.message };
            }
        })
    );

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const elapsed = Date.now() - startTime;

    await logAudit('batch_move_files', { count: args.operations.length }, { successful, failed, elapsed });

    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                summary: { total: args.operations.length, successful, failed, elapsed_ms: elapsed },
                results: results.sort((a, b) => a.index - b.index)
            }, null, 2)
        }],
        isError: failed > 0 && successful === 0,
    };
}

export async function handleBatchDeleteFiles(args: { paths: string[]; recursive?: boolean }) {
    const startTime = Date.now();

    const results = await Promise.all(
        args.paths.map(async (filePath, index): Promise<BatchResult> => {
            try {
                const stats = fs.statSync(filePath);

                if (stats.isDirectory()) {
                    if (args.recursive) {
                        fs.rmSync(filePath, { recursive: true, force: true });
                    } else {
                        fs.rmdirSync(filePath);
                    }
                } else {
                    fs.unlinkSync(filePath);
                }

                return { index, success: true, result: { path: filePath, deleted: true } };
            } catch (error: any) {
                return { index, success: false, error: `${filePath}: ${error.message}` };
            }
        })
    );

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const elapsed = Date.now() - startTime;

    await logAudit('batch_delete_files', { count: args.paths.length }, { successful, failed, elapsed });

    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                summary: { total: args.paths.length, successful, failed, elapsed_ms: elapsed },
                results: results.sort((a, b) => a.index - b.index)
            }, null, 2)
        }],
        isError: failed > 0 && successful === 0,
    };
}

export async function handleBatchFileInfo(args: { paths: string[] }) {
    const startTime = Date.now();

    const results = await Promise.all(
        args.paths.map(async (filePath, index): Promise<BatchResult> => {
            try {
                const stats = fs.statSync(filePath);

                return {
                    index,
                    success: true,
                    result: {
                        path: filePath,
                        exists: true,
                        isFile: stats.isFile(),
                        isDirectory: stats.isDirectory(),
                        size: stats.size,
                        sizeHuman: formatBytes(stats.size),
                        modified: stats.mtime.toISOString(),
                    }
                };
            } catch (error: any) {
                if (error.code === 'ENOENT') {
                    return { index, success: true, result: { path: filePath, exists: false } };
                }
                return { index, success: false, error: `${filePath}: ${error.message}` };
            }
        })
    );

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const elapsed = Date.now() - startTime;

    await logAudit('batch_file_info', { count: args.paths.length }, { successful, failed, elapsed });

    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                summary: { total: args.paths.length, successful, failed, elapsed_ms: elapsed },
                results: results.sort((a, b) => a.index - b.index)
            }, null, 2)
        }],
        isError: failed > 0 && successful === 0,
    };
}

// Utility functions
function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function patternToRegex(pattern: string): RegExp {
    // Convert glob-like pattern to regex
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
}
