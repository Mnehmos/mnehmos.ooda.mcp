import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { logAudit } from '../audit.js';

type BatchResult = {
    index: number;
    success: boolean;
    result?: any;
    error?: string;
};

export const ReadFileSchema = {
    path: z.string(),
};

export const WriteFileSchema = {
    path: z.string(),
    content: z.string(),
};

export const ListDirectorySchema = {
    path: z.string(),
};

export const BatchReadFilesSchema = {
    paths: z.array(z.string()).describe('Array of file paths to read in parallel'),
};

export const BatchWriteFilesSchema = {
    files: z.array(z.object({
        path: z.string(),
        content: z.string(),
    })).describe('Array of files to write in parallel'),
};

export const BatchListDirectoriesSchema = {
    paths: z.array(z.string()).describe('Array of directory paths to list in parallel'),
};

// Read specific lines from a file (token-efficient alternative to reading entire file).
export const ReadFileLinesSchema = {
    path: z.string().describe('Path to the file to read'),
    startLine: z.number().optional().describe('Starting line number (1-indexed, default: 1). Ignored if offset is specified.'),
    endLine: z.number().optional().describe('Ending line number (inclusive, default: end of file). Ignored if offset is specified.'),
    offset: z.number().optional().describe('Negative value reads last N lines from end of file (like Unix tail). Positive value reads first N lines. Takes precedence over startLine/endLine.'),
    includeLineNumbers: z.boolean().optional().describe('Include line numbers in output (default: true)'),
};

export async function handleReadFile(args: { path: string }) {
    try {
        const config = loadConfig();
        const maxLines = config.fileReading?.maxLines ?? 500;
        const warnAtLines = config.fileReading?.warnAtLines ?? 100;

        const content = fs.readFileSync(args.path, 'utf-8');
        const lines = content.split('\n');
        const totalLines = lines.length;

        let output = content;
        let warning = '';

        if (totalLines > maxLines) {
            output = lines.slice(0, maxLines).join('\n');
            warning = `\n\n⚠️ FILE TRUNCATED: Showing ${maxLines} of ${totalLines} lines.\n` +
                `📝 BETTER TOOLS AVAILABLE:\n` +
                `  • read_file_lines - Read specific line ranges (e.g., offset: -50 for last 50 lines)\n` +
                `  • search_in_file - Find specific patterns with context\n` +
                `  • edit_block - Search/replace without reading entire file\n` +
                `Use surgical approaches to preserve context window.`;
        } else if (totalLines > warnAtLines) {
            warning = `\n\n💡 TIP: This file has ${totalLines} lines. Consider using:\n` +
                `  • read_file_lines - For specific sections\n` +
                `  • search_in_file - To find specific content\n` +
                `Surgical tools preserve your context window.`;
        }

        await logAudit('read_file', { path: args.path, totalLines, truncated: totalLines > maxLines }, 'success');
        return {
            content: [{ type: 'text', text: output + warning }],
        };
    } catch (error: any) {
        await logAudit('read_file', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error reading file: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleReadFileLines(args: {
    path: string;
    startLine?: number;
    endLine?: number;
    offset?: number;
    includeLineNumbers?: boolean;
}) {
    try {
        const content = fs.readFileSync(args.path, 'utf-8');
        const allLines = content.split('\n');
        const totalLines = allLines.length;
        const includeLineNumbers = args.includeLineNumbers !== false;

        let startLine: number;
        let endLine: number;

        if (args.offset !== undefined) {
            if (args.offset < 0) {
                const linesToRead = Math.abs(args.offset);
                startLine = Math.max(1, totalLines - linesToRead + 1);
                endLine = totalLines;
            } else if (args.offset > 0) {
                startLine = 1;
                endLine = Math.min(totalLines, args.offset);
            } else {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            path: args.path,
                            totalLines,
                            startLine: 0,
                            endLine: 0,
                            linesReturned: 0,
                            content: ''
                        }, null, 2)
                    }],
                };
            }
        } else {
            startLine = Math.max(1, args.startLine ?? 1);
            endLine = Math.min(totalLines, args.endLine ?? totalLines);
        }

        if (startLine > totalLines) {
            return {
                content: [{ type: 'text', text: `Error: startLine ${startLine} exceeds total lines ${totalLines}` }],
                isError: true,
            };
        }

        const selectedLines = allLines.slice(startLine - 1, endLine);
        let output: string;
        if (includeLineNumbers) {
            const lineNumWidth = String(endLine).length;
            output = selectedLines.map((line, idx) => {
                const lineNum = String(startLine + idx).padStart(lineNumWidth, ' ');
                return `${lineNum}: ${line}`;
            }).join('\n');
        } else {
            output = selectedLines.join('\n');
        }

        await logAudit('read_file_lines', { path: args.path, startLine, endLine, offset: args.offset }, `read ${selectedLines.length} lines`);
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    path: args.path,
                    totalLines,
                    startLine,
                    endLine,
                    linesReturned: selectedLines.length,
                    content: output
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('read_file_lines', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error reading file: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleWriteFile(args: { path: string; content: string }) {
    try {
        const dir = path.dirname(args.path);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(args.path, args.content, 'utf-8');
        await logAudit('write_file', args, 'success');
        return {
            content: [{ type: 'text', text: `Successfully wrote to ${args.path}` }],
        };
    } catch (error: any) {
        await logAudit('write_file', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error writing file: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleListDirectory(args: { path: string }) {
    try {
        const entries = fs.readdirSync(args.path, { withFileTypes: true });
        const formatted = entries.map(entry => `${entry.isDirectory() ? '[DIR]' : '[FILE]'} ${entry.name}`).join('\n');

        await logAudit('list_directory', args, 'success');
        return {
            content: [{ type: 'text', text: formatted }],
        };
    } catch (error: any) {
        await logAudit('list_directory', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error listing directory: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleBatchReadFiles(args: { paths: string[] }) {
    const startTime = Date.now();
    const config = loadConfig();
    const maxLinesPerFile = config.batchOperations?.maxLinesPerFile ??
                            config.fileReading?.maxLines ?? 500;
    const maxAggregateChars = config.batchOperations?.maxAggregateChars ?? 200000;

    const results = await Promise.all(
        args.paths.map(async (filePath, index): Promise<BatchResult> => {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const lines = content.split('\n');
                const totalLines = lines.length;
                let output = content;
                let truncated = false;

                if (totalLines > maxLinesPerFile) {
                    output = lines.slice(0, maxLinesPerFile).join('\n');
                    truncated = true;
                }

                return {
                    index,
                    success: true,
                    result: {
                        path: filePath,
                        content: output,
                        totalLines,
                        truncated,
                        ...(truncated && {
                            warning: `File truncated at ${maxLinesPerFile} of ${totalLines} lines. Adjust via config.batchOperations.maxLinesPerFile`
                        })
                    }
                };
            } catch (error: any) {
                return { index, success: false, error: `${filePath}: ${error.message}` };
            }
        })
    );

    const totalChars = results
        .filter(result => result.success)
        .reduce((sum, result) => sum + (result.result?.content?.length || 0), 0);
    const warnings = totalChars > maxAggregateChars
        ? [`⚠️  Aggregate size ${totalChars} chars exceeds recommended limit ${maxAggregateChars}. Consider reading fewer files or using read_file_lines for specific line ranges.`]
        : [];
    const successful = results.filter(result => result.success).length;
    const failed = results.filter(result => !result.success).length;
    const elapsed = Date.now() - startTime;

    await logAudit('batch_read_files', { count: args.paths.length }, { successful, failed, elapsed });
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                summary: {
                    total: args.paths.length,
                    successful,
                    failed,
                    elapsed_ms: elapsed,
                    totalChars,
                    warnings
                },
                results: results.sort((a, b) => a.index - b.index)
            }, null, 2)
        }],
        isError: failed > 0 && successful === 0,
    };
}

export async function handleBatchWriteFiles(args: { files: Array<{ path: string; content: string }> }) {
    const startTime = Date.now();
    const results = await Promise.all(
        args.files.map(async (file, index): Promise<BatchResult> => {
            try {
                const dir = path.dirname(file.path);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(file.path, file.content, 'utf-8');
                return { index, success: true, result: { path: file.path, written: true } };
            } catch (error: any) {
                return { index, success: false, error: `${file.path}: ${error.message}` };
            }
        })
    );

    const successful = results.filter(result => result.success).length;
    const failed = results.filter(result => !result.success).length;
    const elapsed = Date.now() - startTime;

    await logAudit('batch_write_files', { count: args.files.length }, { successful, failed, elapsed });
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                summary: { total: args.files.length, successful, failed, elapsed_ms: elapsed },
                results: results.sort((a, b) => a.index - b.index)
            }, null, 2)
        }],
        isError: failed > 0,
    };
}

export async function handleBatchListDirectories(args: { paths: string[] }) {
    const startTime = Date.now();
    const results = await Promise.all(
        args.paths.map(async (dirPath, index): Promise<BatchResult> => {
            try {
                const entries = fs.readdirSync(dirPath, { withFileTypes: true });
                const formatted = entries.map(entry => ({
                    name: entry.name,
                    type: entry.isDirectory() ? 'directory' : 'file'
                }));
                return { index, success: true, result: { path: dirPath, entries: formatted } };
            } catch (error: any) {
                return { index, success: false, error: `${dirPath}: ${error.message}` };
            }
        })
    );

    const successful = results.filter(result => result.success).length;
    const failed = results.filter(result => !result.success).length;
    const elapsed = Date.now() - startTime;

    await logAudit('batch_list_directories', { count: args.paths.length }, { successful, failed, elapsed });
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
