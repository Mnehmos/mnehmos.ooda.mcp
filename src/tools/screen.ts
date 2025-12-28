import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';
import { logAudit } from '../audit.js';
import { PowerShellSession } from '../utils/powerShellSession.js';

const execAsync = promisify(exec);

// Schema definitions
export const ScreenshotSchema = {
    region: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
    }).optional().describe('Optional region to capture. If not specified, captures entire screen.'),
    monitor: z.number().optional().describe('Monitor index (0-based). Default: primary monitor.'),
    format: z.enum(['png', 'jpg', 'base64']).optional().describe('Output format. Default: base64.'),
    savePath: z.string().optional().describe('If provided, saves screenshot to this path instead of returning base64.'),
};

export const GetScreenInfoSchema = {};

export const WaitForScreenChangeSchema = {
    region: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
    }).optional().describe('Region to monitor for changes'),
    timeout: z.number().optional().describe('Timeout in milliseconds (default: 5000)'),
    threshold: z.number().optional().describe('Change threshold 0-1 (default: 0.1)'),
};

export const FindOnScreenSchema = {
    text: z.string().optional().describe('Text to find on screen (uses OCR)'),
    image: z.string().optional().describe('Path to template image to find'),
    region: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
    }).optional().describe('Region to search within'),
    confidence: z.number().optional().describe('Match confidence 0-1 (default: 0.8)'),
};

// Platform-specific screenshot implementation
async function captureScreen(options: {
    region?: { x: number; y: number; width: number; height: number };
    monitor?: number;
    savePath?: string;
}): Promise<{ path: string; base64?: string }> {
    const platform = os.platform();
    const tempPath = options.savePath || path.join(os.tmpdir(), `screenshot_${Date.now()}.png`);

    try {
        if (platform === 'win32') {
            // Use PowerShell for Windows screenshot
            const script = options.region
                ? `
                    Add-Type -AssemblyName System.Windows.Forms
                    Add-Type -AssemblyName System.Drawing
                    
                    try {
                        $bitmap = New-Object System.Drawing.Bitmap(${options.region.width}, ${options.region.height})
                        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                        $graphics.CopyFromScreen(${options.region.x}, ${options.region.y}, 0, 0, $bitmap.Size)
                        $bitmap.Save('${tempPath.replace(/\\/g, '\\\\')}')
                    } finally {
                        if ($graphics) { $graphics.Dispose() }
                        if ($bitmap) { $bitmap.Dispose() }
                    }
                `
                : `
                    Add-Type -AssemblyName System.Windows.Forms
                    Add-Type -AssemblyName System.Drawing
                    
                    try {
                        $screen = [System.Windows.Forms.Screen]::PrimaryScreen
                        $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
                        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                        $graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
                        $bitmap.Save('${tempPath.replace(/\\/g, '\\\\')}')
                    } finally {
                        if ($graphics) { $graphics.Dispose() }
                        if ($bitmap) { $bitmap.Dispose() }
                    }
                `;
            await PowerShellSession.getInstance().execute(script);
        } else if (platform === 'darwin') {
            // macOS: use screencapture
            const regionArgs = options.region
                ? `-R${options.region.x},${options.region.y},${options.region.width},${options.region.height}`
                : '';
            await execAsync(`screencapture ${regionArgs} -x "${tempPath}"`, { timeout: 10000 });
        } else {
            // Linux: use scrot or gnome-screenshot
            const regionArgs = options.region
                ? `-a ${options.region.x},${options.region.y},${options.region.width},${options.region.height}`
                : '';
            try {
                await execAsync(`scrot ${regionArgs} "${tempPath}"`, { timeout: 10000 });
            } catch {
                await execAsync(`gnome-screenshot -f "${tempPath}"`, { timeout: 10000 });
            }
        }

        return { path: tempPath };
    } catch (error: any) {
        throw new Error(`Screenshot failed: ${error.message}`);
    }
}

// Get screen/display information
async function getDisplayInfo(): Promise<any[]> {
    const platform = os.platform();

    if (platform === 'win32') {
        const script = `
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
                @{
                    DeviceName = $_.DeviceName
                    Primary = $_.Primary
                    Bounds = @{
                        X = $_.Bounds.X
                        Y = $_.Bounds.Y
                        Width = $_.Bounds.Width
                        Height = $_.Bounds.Height
                    }
                    WorkingArea = @{
                        X = $_.WorkingArea.X
                        Y = $_.WorkingArea.Y
                        Width = $_.WorkingArea.Width
                        Height = $_.WorkingArea.Height
                    }
                }
            } | ConvertTo-Json
        `;
        const stdout = await PowerShellSession.getInstance().execute(script);
        const result = JSON.parse(stdout);
        return Array.isArray(result) ? result : [result];
    } else if (platform === 'darwin') {
        const { stdout } = await execAsync(`system_profiler SPDisplaysDataType -json`, { timeout: 5000 });
        const data = JSON.parse(stdout);
        return data.SPDisplaysDataType?.[0]?.spdisplays_ndrvs || [];
    } else {
        const { stdout } = await execAsync(`xrandr --query`, { timeout: 5000 });
        const displays: any[] = [];
        const regex = /(\S+) connected(?: primary)? (\d+)x(\d+)\+(\d+)\+(\d+)/g;
        let match;
        while ((match = regex.exec(stdout)) !== null) {
            displays.push({
                name: match[1],
                width: parseInt(match[2]),
                height: parseInt(match[3]),
                x: parseInt(match[4]),
                y: parseInt(match[5]),
            });
        }
        return displays;
    }
}

// Tool handlers
export async function handleScreenshot(args: {
    region?: { x: number; y: number; width: number; height: number };
    monitor?: number;
    format?: 'png' | 'jpg' | 'base64';
    savePath?: string;
}) {
    try {
        const format = args.format || 'base64';
        const result = await captureScreen({
            region: args.region,
            monitor: args.monitor,
            savePath: args.savePath,
        });

        await logAudit('screenshot', args, 'success');

        if (args.savePath) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ saved: true, path: result.path }, null, 2)
                }],
            };
        }

        if (format === 'base64') {
            const imageBuffer = fs.readFileSync(result.path);
            const base64 = imageBuffer.toString('base64');
            // Clean up temp file
            fs.unlinkSync(result.path);

            return {
                content: [
                    {
                        type: 'image',
                        data: base64,
                        mimeType: 'image/png',
                    },
                    {
                        type: 'text',
                        text: JSON.stringify({
                            width: args.region?.width || 'full',
                            height: args.region?.height || 'full',
                            format: 'base64/png'
                        })
                    }
                ],
            };
        }

        return {
            content: [{ type: 'text', text: JSON.stringify({ path: result.path }, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('screenshot', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleGetScreenInfo() {
    try {
        const displays = await getDisplayInfo();

        await logAudit('get_screen_info', {}, 'success');

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    platform: os.platform(),
                    displayCount: displays.length,
                    displays
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('get_screen_info', {}, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleWaitForScreenChange(args: {
    region?: { x: number; y: number; width: number; height: number };
    timeout?: number;
    threshold?: number;
}) {
    try {
        const timeout = args.timeout || 5000;
        const startTime = Date.now();

        // Take initial screenshot
        const initial = await captureScreen({ region: args.region });
        const initialBuffer = fs.readFileSync(initial.path);
        fs.unlinkSync(initial.path);

        // Poll for changes
        while (Date.now() - startTime < timeout) {
            await new Promise(resolve => setTimeout(resolve, 100));

            const current = await captureScreen({ region: args.region });
            const currentBuffer = fs.readFileSync(current.path);
            fs.unlinkSync(current.path);

            // Simple byte comparison (could be improved with image diff)
            if (!initialBuffer.equals(currentBuffer)) {
                const elapsed = Date.now() - startTime;
                await logAudit('wait_for_screen_change', args, { changed: true, elapsed });

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ changed: true, elapsed_ms: elapsed }, null, 2)
                    }],
                };
            }
        }

        await logAudit('wait_for_screen_change', args, { changed: false, timeout: true });

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({ changed: false, timeout: true, elapsed_ms: timeout }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('wait_for_screen_change', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleFindOnScreen(args: {
    text?: string;
    image?: string;
    region?: { x: number; y: number; width: number; height: number };
    confidence?: number;
}) {
    try {
        // This is a placeholder - real implementation would need OCR (tesseract) or template matching (opencv)
        // For now, we'll indicate the capability exists but needs additional dependencies

        await logAudit('find_on_screen', args, 'not_implemented');

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    status: 'requires_dependencies',
                    message: 'OCR/template matching requires additional dependencies (tesseract for text, opencv for images). Use screenshot + external OCR as alternative.',
                    suggestion: args.text
                        ? 'For text finding, take a screenshot and use an external OCR service or library.'
                        : 'For image finding, take a screenshot and use template matching with an image processing library.'
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('find_on_screen', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}
