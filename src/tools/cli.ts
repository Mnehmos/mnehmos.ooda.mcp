import { z } from 'zod';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig } from '../config.js';
import { logAudit } from '../audit.js';

// Search handlers live in their own module; these re-exports preserve the
// existing cliTools surface used by the central ActionEnum registry.
export {
    SearchInFileSchema,
    BatchSearchInFilesSchema,
    handleSearchInFile,
    handleBatchSearchInFiles,
} from './fileSearch.js';

// Basic file operations remain available through cliTools for compatibility,
// while the implementations live in their dedicated module.
export {
    ReadFileSchema,
    WriteFileSchema,
    ListDirectorySchema,
    BatchReadFilesSchema,
    BatchWriteFilesSchema,
    BatchListDirectoriesSchema,
    ReadFileLinesSchema,
    handleReadFile,
    handleReadFileLines,
    handleWriteFile,
    handleListDirectory,
    handleBatchReadFiles,
    handleBatchWriteFiles,
    handleBatchListDirectories,
} from './fileOperations.js';

const config = loadConfig();

// Basic blocklist for safety even in YOLO mode
const BLOCKLIST = [
    'rm -rf /',
    'mkfs',
    ':(){:|:&};:', // fork bomb
    ...config.cliPolicy.extraBlockedPatterns
];

function isBlocked(command: string): boolean {
    return BLOCKLIST.some(pattern => command.includes(pattern));
}
/**
 * Truncate output to prevent context stuffing.
 * Returns truncated output with metadata about what was cut.
 */
function truncateOutput(output: string, maxChars: number, mode: 'head' | 'tail' | 'both'): { text: string; truncated: boolean; originalLength: number } {
    if (output.length <= maxChars) {
        return { text: output, truncated: false, originalLength: output.length };
    }

    const originalLength = output.length;
    let text: string;

    if (mode === 'head') {
        text = output.slice(0, maxChars);
        text += `\n\n⚠️ OUTPUT TRUNCATED: Showing first ${maxChars.toLocaleString()} of ${originalLength.toLocaleString()} characters.`;
    } else if (mode === 'tail') {
        text = output.slice(-maxChars);
        text = `⚠️ OUTPUT TRUNCATED: Showing last ${maxChars.toLocaleString()} of ${originalLength.toLocaleString()} characters.\n\n` + text;
    } else {
        // 'both' - keep head and tail for maximum context
        const headSize = Math.floor(maxChars * 0.6);  // 60% from start
        const tailSize = maxChars - headSize;          // 40% from end
        const head = output.slice(0, headSize);
        const tail = output.slice(-tailSize);
        const omitted = originalLength - headSize - tailSize;
        text = head +
            `\n\n⚠️ OUTPUT TRUNCATED: Omitted ${omitted.toLocaleString()} characters (${Math.round(omitted/originalLength*100)}% of output).\n` +
            `📊 Total: ${originalLength.toLocaleString()} chars | Showing: first ${headSize.toLocaleString()} + last ${tailSize.toLocaleString()}\n\n` +
            tail;
    }

    return { text, truncated: true, originalLength };
}

export const ExecCliSchema = {
    command: z.string().describe('The command to execute'),
    cwd: z.string().optional().describe('Current working directory for the command'),
    elevated: z.boolean().optional().describe('Windows only. If true, runs the command with administrator privileges via UAC prompt. LIMITATIONS: fire-and-forget — does NOT return stdout/stderr (the elevated child process runs in a hidden window). Useful for registry writes to HKLM, Program Files operations, and service management. For anything requiring output, run unelevated.'),
};

export async function handleExecCli(args: { command: string; cwd?: string; elevated?: boolean }) {
    const { command, cwd, elevated } = args;
    const outputConfig = config.cliOutput ?? { maxOutputChars: 50000, warnAtChars: 10000, truncateMode: 'both' as const };

    if (isBlocked(command)) {
        const error = 'Command blocked by safety policy';
        await logAudit('exec_cli', args, null, error);
        throw new Error(error);
    }

    // Elevated path: fire-and-forget via Start-Process -Verb RunAs (triggers
    // UAC prompt). We intentionally don't plumb stdout/stderr back because
    // the elevated child runs in a separate console and capturing its output
    // would require either a persistent elevated IPC session (not yet
    // implemented in PowerShellSession) or a file-redirect dance that's
    // fragile. If you need output from an elevated command, pipe it to a
    // file and read that file afterward.
    if (elevated) {
        if (os.platform() !== 'win32') {
            const msg = 'elevated=true is only supported on Windows (uses UAC / Start-Process -Verb RunAs)';
            await logAudit('exec_cli', args, null, msg);
            return {
                content: [{ type: 'text', text: `Error: ${msg}` }],
                isError: true
            };
        }
        try {
            // We pass the full command as a single -Command argument to a new
            // powershell.exe instance, so compound commands (| && ;) work.
            // Use PowerShellSession.execElevatedOneShot helper.
            const { PowerShellSession } = await import('../utils/powerShellSession.js');
            await PowerShellSession.execElevatedOneShot('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-Command', command
            ]);
            await logAudit('exec_cli', { command, cwd, elevated: true }, { launched: true });
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        launched: true,
                        elevated: true,
                        note: 'Elevated command launched via UAC. Output is not captured (architectural limitation). Check side-effects (files, registry, logs) to verify completion.'
                    }, null, 2)
                }]
            };
        } catch (err: any) {
            await logAudit('exec_cli', args, null, err.message);
            return {
                content: [{ type: 'text', text: `Error launching elevated command: ${err.message}` }],
                isError: true
            };
        }
    }

    return new Promise((resolve, reject) => {
        exec(command, {
            cwd: cwd || process.cwd(),
            timeout: config.cliPolicy.timeoutMs,
            maxBuffer: 10 * 1024 * 1024,  // 10MB buffer to capture output before truncating
        }, async (error, stdout, stderr) => {
            // Apply output truncation to prevent context stuffing
            const stdoutResult = truncateOutput(stdout || '', outputConfig.maxOutputChars, outputConfig.truncateMode);
            const stderrResult = truncateOutput(stderr || '', Math.floor(outputConfig.maxOutputChars / 2), outputConfig.truncateMode);

            const result = {
                stdout: stdoutResult.text,
                stderr: stderrResult.text,
                exitCode: error ? error.code : 0,
                truncated: {
                    stdout: stdoutResult.truncated,
                    stderr: stderrResult.truncated,
                    originalStdoutLength: stdoutResult.originalLength,
                    originalStderrLength: stderrResult.originalLength,
                }
            };

            await logAudit('exec_cli', args, result, error ? error.message : null);

            if (error && !stdout && !stderr) {
                // If there was an error executing (e.g. command not found) and no output
                resolve({
                    content: [{ type: 'text', text: `Error: ${error.message}` }],
                    isError: true
                });
                return;
            }

            // Add warning for large outputs that were within limits but still substantial
            let warning = '';
            if (!stdoutResult.truncated && stdoutResult.originalLength > outputConfig.warnAtChars) {
                warning = `\n💡 Large output (${stdoutResult.originalLength.toLocaleString()} chars). Consider using --quiet or filtering output to preserve context.`;
            }

            resolve({
                content: [
                    { type: 'text', text: stdoutResult.text + warning },
                    { type: 'text', text: stderrResult.text ? `STDERR:\n${stderrResult.text}` : '' }
                ],
                isError: !!error
            });
        });
    });
}

// String replace schema - renamed parameters to avoid potential filtering
export const StrReplaceSchema = {
    path: z.string().describe('Path to the file to edit'),
    oldText: z.string().describe('Text to replace (must be unique in file)'),
    newText: z.string().optional().describe('Replacement text (empty to delete)'),
};

// Batch operation schemas for parallel execution
export const BatchExecCliSchema = {
    commands: z.array(z.object({
        command: z.string().describe('The command to execute'),
        cwd: z.string().optional().describe('Current working directory for the command'),
    })).describe('Array of commands to execute in parallel'),
};

// Batch str_replace schema - supports multiple replacements across multiple files
export const BatchStrReplaceSchema = {
    replacements: z.array(z.object({
        path: z.string().describe('Path to the file to edit'),
        oldText: z.string().describe('Text to replace'),
        newText: z.string().optional().describe('Replacement text (empty to delete)'),
        replaceAll: z.boolean().optional().describe('Replace all occurrences, not just first (default: false)'),
    })).describe('Array of replacement operations to execute'),
    stopOnError: z.boolean().optional().describe('Stop execution if any replacement fails (default: false)'),
};

// String replace handler - replaces a unique string in a file
// Accepts both old parameter names (old_str/new_str) and new ones (oldText/newText) for compatibility
export async function handleStrReplace(args: { path: string; oldText?: string; newText?: string; old_str?: string; new_str?: string }) {
    try {
        // Support both parameter naming conventions
        const oldStr = args.oldText ?? args.old_str;
        const newStr = args.newText ?? args.new_str ?? '';
        
        if (!oldStr) {
            return {
                content: [{ type: 'text', text: 'Error: oldText parameter is required' }],
                isError: true,
            };
        }

        // Read the file
        if (!fs.existsSync(args.path)) {
            const error = `File not found: ${args.path}`;
            await logAudit('str_replace', args, null, error);
            return {
                content: [{ type: 'text', text: `Error: ${error}` }],
                isError: true,
            };
        }

        const content = fs.readFileSync(args.path, 'utf-8');

        // Normalize line endings: detect file's convention and apply to search/replace.
        // Without this, a search string with LF ("\n") will fail to match a file
        // with CRLF ("\r\n") endings — the #1 cause of "string not found" errors.
        // The detection/normalization utilities live in diff/ and are the same ones
        // used by edit_block and apply_diff, keeping behavior consistent.
        const { detectLineEnding, normalizeLineEndings, describeLineEndingDifference } =
            await import('./diff/lineEndings.js');
        const fileLineEnding = detectLineEnding(content);
        const normalizedOld = normalizeLineEndings(oldStr, fileLineEnding);
        const normalizedNew = normalizeLineEndings(newStr, fileLineEnding);

        // Count occurrences using normalized search string
        const occurrences = content.split(normalizedOld).length - 1;

        if (occurrences === 0) {
            // Surface the most likely cause when the user's string "looks right"
            // but doesn't match: line-ending mismatch between search and file.
            const lineEndingHint = describeLineEndingDifference(oldStr, content);
            const preview = oldStr.substring(0, 50) + (oldStr.length > 50 ? '...' : '');
            let error = `String not found in file: "${preview}"`;
            if (lineEndingHint) {
                error += ` | ${lineEndingHint} (normalization was attempted but content still did not match — the search text may have other differences)`;
            } else {
                error += ' | For fuzzy matching and better diagnostics, try edit_block instead';
            }
            await logAudit('str_replace', args, null, error);
            return {
                content: [{ type: 'text', text: `Error: ${error}` }],
                isError: true,
            };
        }

        if (occurrences > 1) {
            const error = `String appears ${occurrences} times in file. The string to replace must be unique. Add more context to make it unique.`;
            await logAudit('str_replace', args, null, error);
            return {
                content: [{ type: 'text', text: `Error: ${error}` }],
                isError: true,
            };
        }

        // Replace using normalized strings so the output preserves the file's
        // existing line-ending convention.
        const newContent = content.replace(normalizedOld, normalizedNew);
        fs.writeFileSync(args.path, newContent, 'utf-8');

        await logAudit('str_replace', { path: args.path, oldText_length: oldStr.length, newText_length: newStr.length }, 'success');

        return {
            content: [{ type: 'text', text: `Successfully replaced string in ${args.path}` }],
        };
    } catch (error: any) {
        await logAudit('str_replace', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

// Batch handlers for parallel execution
interface BatchResult {
    index: number;
    success: boolean;
    result?: any;
    error?: string;
}

export async function handleBatchExecCli(args: { commands: Array<{ command: string; cwd?: string }> }) {
    const startTime = Date.now();
    const outputConfig = config.cliOutput ?? { maxOutputChars: 50000, warnAtChars: 10000, truncateMode: 'both' as const };
    // For batch operations, use smaller limits per command to prevent aggregate overflow
    const perCommandLimit = Math.floor(outputConfig.maxOutputChars / Math.max(args.commands.length, 1));
    const effectiveLimit = Math.max(perCommandLimit, 5000); // At least 5KB per command

    const results = await Promise.all(
        args.commands.map(async (cmd, index): Promise<BatchResult> => {
            if (isBlocked(cmd.command)) {
                await logAudit('batch_exec_cli_item', cmd, null, 'Command blocked by safety policy');
                return { index, success: false, error: 'Command blocked by safety policy' };
            }

            return new Promise((resolve) => {
                exec(cmd.command, {
                    cwd: cmd.cwd || process.cwd(),
                    timeout: config.cliPolicy.timeoutMs,
                    maxBuffer: 10 * 1024 * 1024,
                }, async (error, stdout, stderr) => {
                    if (error && !stdout && !stderr) {
                        resolve({ index, success: false, error: error.message });
                    } else {
                        // Apply truncation to batch results
                        const stdoutResult = truncateOutput(stdout || '', effectiveLimit, outputConfig.truncateMode);
                        const stderrResult = truncateOutput(stderr || '', Math.floor(effectiveLimit / 2), outputConfig.truncateMode);
                        resolve({
                            index,
                            success: !error,
                            result: {
                                stdout: stdoutResult.text,
                                stderr: stderrResult.text,
                                exitCode: error ? error.code : 0,
                                truncated: stdoutResult.truncated || stderrResult.truncated
                            }
                        });
                    }
                });
            });
        })
    );

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const elapsed = Date.now() - startTime;

    await logAudit('batch_exec_cli', { count: args.commands.length }, { successful, failed, elapsed });

    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                summary: { total: args.commands.length, successful, failed, elapsed_ms: elapsed },
                results: results.sort((a, b) => a.index - b.index)
            }, null, 2)
        }],
        isError: failed > 0 && successful === 0,
    };
}

// Batch str_replace handler - supports multiple replacements with replaceAll option
export async function handleBatchStrReplace(args: {
    replacements: Array<{
        path: string;
        oldText: string;
        newText?: string;
        replaceAll?: boolean;
    }>;
    stopOnError?: boolean;
}) {
    const startTime = Date.now();
    const stopOnError = args.stopOnError ?? false;
    const results: BatchResult[] = [];

    for (let index = 0; index < args.replacements.length; index++) {
        const op = args.replacements[index];
        const newStr = op.newText ?? '';
        const replaceAll = op.replaceAll ?? false;

        try {
            // Check file exists
            if (!fs.existsSync(op.path)) {
                const result: BatchResult = { index, success: false, error: `File not found: ${op.path}` };
                results.push(result);
                if (stopOnError) break;
                continue;
            }

            const content = fs.readFileSync(op.path, 'utf-8');

            // Count occurrences
            const occurrences = content.split(op.oldText).length - 1;

            if (occurrences === 0) {
                const result: BatchResult = {
                    index,
                    success: false,
                    error: `String not found in ${op.path}: "${op.oldText.substring(0, 50)}${op.oldText.length > 50 ? '...' : ''}"`
                };
                results.push(result);
                if (stopOnError) break;
                continue;
            }

            // If not replaceAll and multiple occurrences, that's an error
            if (!replaceAll && occurrences > 1) {
                const result: BatchResult = {
                    index,
                    success: false,
                    error: `String appears ${occurrences} times in ${op.path}. Use replaceAll: true to replace all, or add more context.`
                };
                results.push(result);
                if (stopOnError) break;
                continue;
            }

            // Perform replacement
            let newContent: string;
            if (replaceAll) {
                newContent = content.split(op.oldText).join(newStr);
            } else {
                newContent = content.replace(op.oldText, () => newStr);
            }

            fs.writeFileSync(op.path, newContent, 'utf-8');

            results.push({
                index,
                success: true,
                result: {
                    path: op.path,
                    replacements: replaceAll ? occurrences : 1,
                    oldTextLength: op.oldText.length,
                    newTextLength: newStr.length
                }
            });

        } catch (error: any) {
            const result: BatchResult = { index, success: false, error: `${op.path}: ${error.message}` };
            results.push(result);
            if (stopOnError) break;
        }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalReplacements = results
        .filter(r => r.success && r.result)
        .reduce((sum, r) => sum + (r.result.replacements || 0), 0);
    const elapsed = Date.now() - startTime;

    await logAudit('batch_str_replace', { count: args.replacements.length }, { successful, failed, totalReplacements, elapsed });

    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                summary: {
                    total: args.replacements.length,
                    successful,
                    failed,
                    totalReplacements,
                    elapsed_ms: elapsed
                },
                results: results.sort((a, b) => a.index - b.index)
            }, null, 2)
        }],
        isError: failed > 0 && successful === 0,
    };
}

