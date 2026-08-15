import { z } from 'zod';
import fs from 'fs';
import { logAudit } from '../audit.js';

/**
 * tail_file — poll a growing file and return new lines since a previous call,
 * OR block waiting for new content up to a timeout.
 *
 * Fills a specific workflow gap: watching a log file while telling the user to
 * interact with an app. Previously this required crafting PowerShell
 * `Get-Content -Wait` commands through exec_cli, which is fragile and
 * doesn't integrate well with tool orchestration.
 *
 * Usage patterns:
 *   - One-shot poll: { path, fromByte: 0 } returns current-end lines + new end byte
 *   - Streaming follow: { path, fromByte: <prev end>, timeoutSeconds: 30 }
 *     blocks up to timeout waiting for the file to grow, returns new content
 *     once it appears (or empty if timeout reached).
 *
 * The byte-offset cursor lets the caller resume cleanly across multiple calls
 * without missing or duplicating lines. Line-based cursors would be ambiguous
 * when files are rotated or truncated.
 */

export const TailFileSchema = {
    path: z.string().describe('Absolute path to the file to tail'),
    fromByte: z.number().finite().int().min(0).optional().describe('Byte offset to start reading from. Pass the endByte from the previous call to resume. Default: current end of file (tail only new content).'),
    timeoutSeconds: z.number().finite().min(0).max(3600).optional().describe('If >0, block up to this many seconds waiting for new content. Maximum: 1 hour. Default: 0 (one-shot poll).'),
    pollMs: z.number().finite().int().min(10).max(60000).optional().describe('Polling interval in ms when blocking. Must be between 10ms and 60s. Default: 250ms.'),
    maxBytes: z.number().finite().int().min(1).max(64 * 1024).optional().describe('Maximum bytes to return in one call. Maximum: 64KB. Prevents runaway output on files that grew enormously between calls.'),
};

export interface TailFileArgs {
    path: string;
    fromByte?: number;
    timeoutSeconds?: number;
    pollMs?: number;
    maxBytes?: number;
}

interface TailResult {
    path: string;
    content: string;
    startByte: number;
    endByte: number;
    bytesRead: number;
    truncated: boolean;
    // True if we returned because the file grew, false if we timed out empty
    // or the file was already at endByte.
    hadNewContent: boolean;
    // If the file shrank between calls (rotation, truncation), we start from
    // byte 0 and set this flag so the caller knows to resync.
    fileRotated: boolean;
}

function readRange(filePath: string, startByte: number, maxBytes: number): { content: string; bytesRead: number; endByte: number; truncated: boolean } {
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    const availableBytes = Math.max(0, fileSize - startByte);
    const bytesToRead = Math.min(availableBytes, maxBytes);

    if (bytesToRead === 0) {
        return { content: '', bytesRead: 0, endByte: fileSize, truncated: false };
    }

    const fd = fs.openSync(filePath, 'r');
    try {
        const buffer = Buffer.alloc(bytesToRead);
        const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, startByte);
        const content = buffer.slice(0, bytesRead).toString('utf-8');
        return {
            content,
            bytesRead,
            endByte: startByte + bytesRead,
            truncated: availableBytes > maxBytes,
        };
    } finally {
        fs.closeSync(fd);
    }
}

export async function handleTailFile(args: TailFileArgs) {
    try {
        const timeoutSeconds = args.timeoutSeconds ?? 0;
        const pollMs = args.pollMs ?? 250;
        const maxBytes = args.maxBytes ?? 64 * 1024;

        if (!fs.existsSync(args.path)) {
            await logAudit('tail_file', args, null, `file not found: ${args.path}`);
            return {
                content: [{ type: 'text', text: `Error: file not found: ${args.path}` }],
                isError: true,
            };
        }

        // Determine starting byte. If fromByte is omitted, start at current end
        // of file — the caller only wants new content from now on.
        const initialStats = fs.statSync(args.path);
        let startByte = args.fromByte ?? initialStats.size;

        // File-rotation guard: if the caller passed fromByte larger than current
        // size, the file was truncated or rotated. Reset to 0 and report.
        let fileRotated = false;
        if (startByte > initialStats.size) {
            fileRotated = true;
            startByte = 0;
        }

        // Re-stat immediately before every read so truncation/rotation between
        // calls resets the cursor instead of silently skipping new content.
        const readAtCursor = () => {
            const currentSize = fs.statSync(args.path).size;
            if (currentSize < startByte) {
                fileRotated = true;
                startByte = 0;
            }
            return readRange(args.path, startByte, maxBytes);
        };

        // One-shot read. If content available, return immediately.
        let result = readAtCursor();

        if (result.bytesRead > 0 || timeoutSeconds <= 0) {
            const payload: TailResult = {
                path: args.path,
                content: result.content,
                startByte,
                endByte: result.endByte,
                bytesRead: result.bytesRead,
                truncated: result.truncated,
                hadNewContent: result.bytesRead > 0,
                fileRotated,
            };
            await logAudit('tail_file', args, { bytesRead: result.bytesRead, hadNewContent: payload.hadNewContent });
            return {
                content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
            };
        }

        // Blocking follow: poll until either content appears or timeout elapses.
        const deadline = Date.now() + timeoutSeconds * 1000;
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, pollMs));
            result = readAtCursor();
            if (result.bytesRead > 0) {
                const payload: TailResult = {
                    path: args.path,
                    content: result.content,
                    startByte,
                    endByte: result.endByte,
                    bytesRead: result.bytesRead,
                    truncated: result.truncated,
                    hadNewContent: true,
                    fileRotated,
                };
                await logAudit('tail_file', args, { bytesRead: result.bytesRead, waited: true });
                return {
                    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
                };
            }
        }

        // Timeout with no new content.
        const payload: TailResult = {
            path: args.path,
            content: '',
            startByte,
            endByte: result.endByte,
            bytesRead: 0,
            truncated: false,
            hadNewContent: false,
            fileRotated,
        };
        await logAudit('tail_file', args, { timeout: true });
        return {
            content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('tail_file', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}
