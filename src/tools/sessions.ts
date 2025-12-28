// Interactive process sessions
// Allows starting, interacting with, and managing long-running processes

import { z } from 'zod';
import { spawn, ChildProcess } from 'child_process';
import { logAudit } from '../audit.js';
import { loadConfig } from '../config.js';
import os from 'os';

const platform = os.platform();
const config = loadConfig();

// Session storage
interface ProcessSession {
    id: string;
    command: string;
    cwd: string;
    process: ChildProcess;
    output: string[];
    startTime: Date;
    isAlive: boolean;
}

const sessions: Map<string, ProcessSession> = new Map();
const MAX_OUTPUT_LINES = 1000;  // Keep last 1000 lines per session

// Generate unique session ID
function generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// Schemas
export const StartProcessSchema = {
    command: z.string().describe('Command to execute'),
    args: z.array(z.string()).optional().describe('Command arguments'),
    cwd: z.string().optional().describe('Working directory'),
    env: z.record(z.string()).optional().describe('Environment variables to set'),
};

export const InteractWithProcessSchema = {
    sessionId: z.string().describe('Session ID returned from start_process'),
    input: z.string().describe('Input to send to the process stdin'),
};

export const ReadProcessOutputSchema = {
    sessionId: z.string().describe('Session ID returned from start_process'),
    lines: z.number().optional().describe('Number of lines to return (default: all available, negative for last N lines)'),
    clear: z.boolean().optional().describe('Clear output buffer after reading (default: false)'),
};

export const ListSessionsSchema = {};

export const TerminateProcessSchema = {
    sessionId: z.string().describe('Session ID to terminate'),
    force: z.boolean().optional().describe('Force kill (SIGKILL) instead of graceful (SIGTERM)'),
};

/**
 * Start a new interactive process session
 */
export async function handleStartProcess(args: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
}): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    try {
        const sessionId = generateSessionId();
        const cmdArgs = args.args || [];
        const cwd = args.cwd || process.cwd();
        
        // Spawn the process
        const child = spawn(args.command, cmdArgs, {
            cwd,
            env: { ...process.env, ...args.env },
            shell: platform === 'win32',  // Use shell on Windows for better compatibility
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        const session: ProcessSession = {
            id: sessionId,
            command: `${args.command} ${cmdArgs.join(' ')}`.trim(),
            cwd,
            process: child,
            output: [],
            startTime: new Date(),
            isAlive: true,
        };

        // Collect stdout
        child.stdout?.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n');
            session.output.push(...lines.filter(l => l.length > 0));
            // Trim to max lines
            if (session.output.length > MAX_OUTPUT_LINES) {
                session.output = session.output.slice(-MAX_OUTPUT_LINES);
            }
        });

        // Collect stderr
        child.stderr?.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n').map(l => `[stderr] ${l}`);
            session.output.push(...lines.filter(l => l.length > 8));  // > "[stderr] ".length
            if (session.output.length > MAX_OUTPUT_LINES) {
                session.output = session.output.slice(-MAX_OUTPUT_LINES);
            }
        });

        // Handle process exit
        child.on('exit', (code, signal) => {
            session.isAlive = false;
            session.output.push(`[process exited with ${signal ? `signal ${signal}` : `code ${code}`}]`);
        });

        child.on('error', (err) => {
            session.isAlive = false;
            session.output.push(`[process error: ${err.message}]`);
        });

        sessions.set(sessionId, session);

        await logAudit('start_process', { command: args.command, args: cmdArgs, cwd }, { sessionId, pid: child.pid });

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    sessionId,
                    pid: child.pid,
                    command: session.command,
                    cwd,
                    started: session.startTime.toISOString(),
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('start_process', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

/**
 * Send input to a running process
 */
export async function handleInteractWithProcess(args: {
    sessionId: string;
    input: string;
}): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    try {
        const session = sessions.get(args.sessionId);
        
        if (!session) {
            return {
                content: [{ type: 'text', text: `Error: Session not found: ${args.sessionId}` }],
                isError: true,
            };
        }

        if (!session.isAlive) {
            return {
                content: [{ type: 'text', text: `Error: Process has exited` }],
                isError: true,
            };
        }

        // Write to stdin
        session.process.stdin?.write(args.input);
        
        // If input doesn't end with newline, add one (common for commands)
        if (!args.input.endsWith('\n')) {
            session.process.stdin?.write('\n');
        }

        await logAudit('interact_with_process', { sessionId: args.sessionId, inputLength: args.input.length }, 'sent');

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    sessionId: args.sessionId,
                    sent: true,
                    inputLength: args.input.length,
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('interact_with_process', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

/**
 * Read output from a process session
 */
export async function handleReadProcessOutput(args: {
    sessionId: string;
    lines?: number;
    clear?: boolean;
}): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    try {
        const session = sessions.get(args.sessionId);
        const outputConfig = config.cliOutput ?? { maxOutputChars: 50000, warnAtChars: 10000, truncateMode: 'both' as const };
        const maxReturnLines = 200; // Default limit on returned lines to prevent context stuffing

        if (!session) {
            return {
                content: [{ type: 'text', text: `Error: Session not found: ${args.sessionId}` }],
                isError: true,
            };
        }

        let output: string[];
        let requestedLines = args.lines;

        // Apply default limit if not specified
        if (requestedLines === undefined) {
            requestedLines = -maxReturnLines; // Default to last N lines
        }

        if (requestedLines < 0) {
            // Negative: last N lines (cap at maxReturnLines)
            const linesToGet = Math.min(Math.abs(requestedLines), maxReturnLines);
            output = session.output.slice(-linesToGet);
        } else {
            // Positive: first N lines (cap at maxReturnLines)
            const linesToGet = Math.min(requestedLines, maxReturnLines);
            output = session.output.slice(0, linesToGet);
        }

        if (args.clear) {
            session.output = [];
        }

        const outputText = output.join('\n');
        const truncatedByLines = output.length < session.output.length;

        // Also check character limit
        let finalOutput = outputText;
        let truncatedByChars = false;
        if (outputText.length > outputConfig.maxOutputChars) {
            finalOutput = outputText.slice(0, outputConfig.maxOutputChars);
            finalOutput += `\n\n⚠️ OUTPUT TRUNCATED: ${outputText.length.toLocaleString()} chars exceeded limit of ${outputConfig.maxOutputChars.toLocaleString()}`;
            truncatedByChars = true;
        }

        await logAudit('read_process_output', { sessionId: args.sessionId, linesRequested: args.lines }, { linesReturned: output.length, truncated: truncatedByLines || truncatedByChars });

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    sessionId: args.sessionId,
                    isAlive: session.isAlive,
                    linesReturned: output.length,
                    totalBuffered: session.output.length,
                    truncated: truncatedByLines || truncatedByChars,
                    output: finalOutput,
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('read_process_output', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

/**
 * List all active sessions
 */
export async function handleListSessions(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const sessionList = Array.from(sessions.values()).map(s => ({
        sessionId: s.id,
        command: s.command,
        cwd: s.cwd,
        pid: s.process.pid,
        isAlive: s.isAlive,
        startTime: s.startTime.toISOString(),
        outputLines: s.output.length,
    }));

    await logAudit('list_sessions', {}, { count: sessionList.length });

    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                count: sessionList.length,
                sessions: sessionList,
            }, null, 2)
        }],
    };
}

/**
 * Terminate a process session
 */
export async function handleTerminateProcess(args: {
    sessionId: string;
    force?: boolean;
}): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    try {
        const session = sessions.get(args.sessionId);
        
        if (!session) {
            return {
                content: [{ type: 'text', text: `Error: Session not found: ${args.sessionId}` }],
                isError: true,
            };
        }

        if (session.isAlive) {
            if (args.force) {
                session.process.kill('SIGKILL');
            } else {
                session.process.kill('SIGTERM');
            }
        }

        // Give it a moment then clean up
        setTimeout(() => {
            sessions.delete(args.sessionId);
        }, 1000);

        await logAudit('terminate_process', args, 'terminated');

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    sessionId: args.sessionId,
                    terminated: true,
                    wasAlive: session.isAlive,
                    force: args.force || false,
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('terminate_process', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}
