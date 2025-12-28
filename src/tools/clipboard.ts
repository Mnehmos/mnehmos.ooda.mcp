import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { logAudit } from '../audit.js';
import { loadConfig } from '../config.js';

const execAsync = promisify(exec);
const platform = os.platform();
const config = loadConfig();

// Schema definitions
export const ClipboardReadSchema = {
    format: z.enum(['text', 'html', 'image']).optional().describe('Format to read (default: text)'),
};

export const ClipboardWriteSchema = {
    content: z.string().describe('Content to write to clipboard'),
    format: z.enum(['text', 'html']).optional().describe('Format to write (default: text)'),
};

export const ClipboardClearSchema = {};

export const ClipboardHasFormatSchema = {
    format: z.enum(['text', 'html', 'image', 'files']).describe('Format to check for'),
};

// Tool handlers
export async function handleClipboardRead(args: { format?: 'text' | 'html' | 'image' }) {
    try {
        const format = args.format || 'text';
        const outputConfig = config.cliOutput ?? { maxOutputChars: 50000, warnAtChars: 10000, truncateMode: 'both' as const };
        let content: string | null = null;

        if (platform === 'win32') {
            if (format === 'text') {
                const { stdout } = await execAsync('powershell -Command "Get-Clipboard"', { timeout: 5000 });
                content = stdout.trim();
            } else if (format === 'html') {
                const script = `
                    Add-Type -AssemblyName System.Windows.Forms
                    $data = [System.Windows.Forms.Clipboard]::GetDataObject()
                    if ($data.GetDataPresent([System.Windows.Forms.DataFormats]::Html)) {
                        $data.GetData([System.Windows.Forms.DataFormats]::Html)
                    }
                `;
                const { stdout } = await execAsync(`powershell -Command "${script.replace(/\n/g, ' ')}"`, { timeout: 5000 });
                content = stdout.trim();
            } else if (format === 'image') {
                const tempPath = path.join(os.tmpdir(), `clipboard_${Date.now()}.png`);
                const script = `
                    Add-Type -AssemblyName System.Windows.Forms
                    $img = [System.Windows.Forms.Clipboard]::GetImage()
                    if ($img) {
                        $img.Save('${tempPath.replace(/\\/g, '\\\\')}')
                        Write-Output '${tempPath.replace(/\\/g, '\\\\')}'
                    }
                `;
                const { stdout } = await execAsync(`powershell -Command "${script.replace(/\n/g, ' ')}"`, { timeout: 5000 });
                if (stdout.trim()) {
                    const imageBuffer = fs.readFileSync(tempPath);
                    content = imageBuffer.toString('base64');
                    fs.unlinkSync(tempPath);
                }
            }
        } else if (platform === 'darwin') {
            if (format === 'text') {
                const { stdout } = await execAsync('pbpaste', { timeout: 5000 });
                content = stdout;
            } else if (format === 'html') {
                const { stdout } = await execAsync('osascript -e "the clipboard as «class HTML»"', { timeout: 5000 });
                content = stdout;
            }
        } else {
            // Linux - use xclip or xsel
            if (format === 'text') {
                try {
                    const { stdout } = await execAsync('xclip -selection clipboard -o', { timeout: 5000 });
                    content = stdout;
                } catch {
                    const { stdout } = await execAsync('xsel --clipboard --output', { timeout: 5000 });
                    content = stdout;
                }
            }
        }

        // Apply truncation to text/html content (not images)
        let truncated = false;
        let originalLength = content?.length || 0;
        if (content && format !== 'image' && content.length > outputConfig.maxOutputChars) {
            originalLength = content.length;
            content = content.slice(0, outputConfig.maxOutputChars);
            content += `\n\n⚠️ CLIPBOARD TRUNCATED: Showing first ${outputConfig.maxOutputChars.toLocaleString()} of ${originalLength.toLocaleString()} characters.`;
            truncated = true;
        }

        await logAudit('clipboard_read', args, content ? `success${truncated ? ' (truncated)' : ''}` : 'empty');

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    format,
                    hasContent: !!content,
                    content: content || null,
                    length: originalLength,
                    truncated: truncated ? { originalLength, returnedLength: content?.length } : undefined
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('clipboard_read', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleClipboardWrite(args: { content: string; format?: 'text' | 'html' }) {
    try {
        const format = args.format || 'text';

        if (platform === 'win32') {
            if (format === 'text') {
                // Use stdin to handle special characters
                const escaped = args.content.replace(/"/g, '`"').replace(/\$/g, '`$');
                await execAsync(`powershell -Command "Set-Clipboard -Value '${escaped.replace(/'/g, "''")}'"`);
            } else if (format === 'html') {
                const script = `
                    Add-Type -AssemblyName System.Windows.Forms
                    [System.Windows.Forms.Clipboard]::SetText('${args.content.replace(/'/g, "''")}', [System.Windows.Forms.TextDataFormat]::Html)
                `;
                await execAsync(`powershell -Command "${script.replace(/\n/g, ' ')}"`, { timeout: 5000 });
            }
        } else if (platform === 'darwin') {
            // Write to temp file to handle special characters
            const tempFile = path.join(os.tmpdir(), `clipboard_${Date.now()}.txt`);
            fs.writeFileSync(tempFile, args.content);
            await execAsync(`cat "${tempFile}" | pbcopy`, { timeout: 5000 });
            fs.unlinkSync(tempFile);
        } else {
            // Linux
            const tempFile = path.join(os.tmpdir(), `clipboard_${Date.now()}.txt`);
            fs.writeFileSync(tempFile, args.content);
            try {
                await execAsync(`cat "${tempFile}" | xclip -selection clipboard`, { timeout: 5000 });
            } catch {
                await execAsync(`cat "${tempFile}" | xsel --clipboard --input`, { timeout: 5000 });
            }
            fs.unlinkSync(tempFile);
        }

        await logAudit('clipboard_write', { format, length: args.content.length }, 'success');

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    written: true,
                    format,
                    length: args.content.length
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('clipboard_write', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleClipboardClear() {
    try {
        if (platform === 'win32') {
            await execAsync('powershell -Command "Set-Clipboard -Value $null"', { timeout: 5000 });
        } else if (platform === 'darwin') {
            await execAsync('pbcopy < /dev/null', { timeout: 5000 });
        } else {
            try {
                await execAsync('xclip -selection clipboard < /dev/null', { timeout: 5000 });
            } catch {
                await execAsync('xsel --clipboard --clear', { timeout: 5000 });
            }
        }

        await logAudit('clipboard_clear', {}, 'success');

        return {
            content: [{ type: 'text', text: JSON.stringify({ cleared: true }, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('clipboard_clear', {}, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleClipboardHasFormat(args: { format: 'text' | 'html' | 'image' | 'files' }) {
    try {
        let hasFormat = false;

        if (platform === 'win32') {
            const formatMap: Record<string, string> = {
                'text': 'Text',
                'html': 'Html',
                'image': 'Bitmap',
                'files': 'FileDrop',
            };

            const script = `
                Add-Type -AssemblyName System.Windows.Forms
                $data = [System.Windows.Forms.Clipboard]::GetDataObject()
                $data.GetDataPresent([System.Windows.Forms.DataFormats]::${formatMap[args.format]})
            `;
            const { stdout } = await execAsync(`powershell -Command "${script.replace(/\n/g, ' ')}"`, { timeout: 5000 });
            hasFormat = stdout.trim().toLowerCase() === 'true';
        } else {
            // Simplified check for other platforms
            if (args.format === 'text') {
                try {
                    const result = await handleClipboardRead({ format: 'text' });
                    hasFormat = !!(result.content[0] as any).text?.includes('"hasContent": true');
                } catch {
                    hasFormat = false;
                }
            }
        }

        await logAudit('clipboard_has_format', args, hasFormat);

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({ format: args.format, available: hasFormat }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('clipboard_has_format', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}
