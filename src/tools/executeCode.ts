// Execute code in memory without saving to file
// Supports Python, Node.js, and R

import { z } from 'zod';
import { spawn } from 'child_process';
import { logAudit } from '../audit.js';
import { loadConfig } from '../config.js';
import os from 'os';

const platform = os.platform();
const config = loadConfig();

/**
 * Truncate output to prevent context stuffing.
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
        const headSize = Math.floor(maxChars * 0.6);
        const tailSize = maxChars - headSize;
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

// Schema
export const ExecuteCodeSchema = {
    language: z.enum(['python', 'node', 'r', 'powershell', 'bash']).describe('Programming language to execute'),
    code: z.string().describe('Code to execute'),
    timeout: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
};

interface ExecuteResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    duration: number;
}

/**
 * Get the interpreter command for each language
 */
function getInterpreter(language: string): { command: string; args: string[] } {
    switch (language) {
        case 'python':
            return { 
                command: platform === 'win32' ? 'python' : 'python3', 
                args: ['-c'] 
            };
        case 'node':
            return { 
                command: 'node', 
                args: ['-e'] 
            };
        case 'r':
            return { 
                command: 'Rscript', 
                args: ['-e'] 
            };
        case 'powershell':
            return { 
                command: 'powershell', 
                args: ['-Command'] 
            };
        case 'bash':
            return { 
                command: platform === 'win32' ? 'bash' : '/bin/bash', 
                args: ['-c'] 
            };
        default:
            throw new Error(`Unsupported language: ${language}`);
    }
}

/**
 * Execute code in memory
 */
async function executeCode(
    language: string,
    code: string,
    timeout: number
): Promise<ExecuteResult> {
    const startTime = Date.now();
    const { command, args } = getInterpreter(language);

    return new Promise((resolve) => {
        const proc = spawn(command, [...args, code], {
            timeout,
            shell: false,
        });

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (data: Buffer) => {
            stdout += data.toString();
        });

        proc.stderr?.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        proc.on('close', (exitCode) => {
            const duration = Date.now() - startTime;
            resolve({
                success: exitCode === 0,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                exitCode,
                duration,
            });
        });

        proc.on('error', (err) => {
            const duration = Date.now() - startTime;
            resolve({
                success: false,
                stdout: '',
                stderr: err.message,
                exitCode: null,
                duration,
            });
        });
    });
}

/**
 * Handle execute_code tool call
 */
export async function handleExecuteCode(args: {
    language: 'python' | 'node' | 'r' | 'powershell' | 'bash';
    code: string;
    timeout?: number;
}): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    const timeout = args.timeout || 30000;
    const outputConfig = config.cliOutput ?? { maxOutputChars: 50000, warnAtChars: 10000, truncateMode: 'both' as const };

    try {
        const result = await executeCode(args.language, args.code, timeout);

        // Apply truncation to prevent context stuffing
        const stdoutResult = truncateOutput(result.stdout, outputConfig.maxOutputChars, outputConfig.truncateMode);
        const stderrResult = truncateOutput(result.stderr, Math.floor(outputConfig.maxOutputChars / 2), outputConfig.truncateMode);

        await logAudit('execute_code', {
            language: args.language,
            codeLength: args.code.length,
            timeout,
        }, {
            success: result.success,
            exitCode: result.exitCode,
            duration: result.duration,
            truncated: stdoutResult.truncated || stderrResult.truncated,
        });

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    language: args.language,
                    success: result.success,
                    exitCode: result.exitCode,
                    duration_ms: result.duration,
                    stdout: stdoutResult.text,
                    stderr: stderrResult.text || undefined,
                    truncated: stdoutResult.truncated || stderrResult.truncated ? {
                        stdout: stdoutResult.truncated,
                        stderr: stderrResult.truncated,
                        originalStdoutLength: stdoutResult.originalLength,
                        originalStderrLength: stderrResult.originalLength,
                    } : undefined,
                }, null, 2)
            }],
            isError: !result.success,
        };
    } catch (error: any) {
        await logAudit('execute_code', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}
