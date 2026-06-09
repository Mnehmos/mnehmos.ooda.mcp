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
            } catch (scrotError) {
                // scrot not available, try gnome-screenshot as fallback
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
        // Return per-monitor bounds, working area, primary flag, AND per-monitor
        // DPI. Per-monitor DPI requires GetDpiForMonitor which needs each
        // monitor's handle; we use EnumDisplayMonitors + GetMonitorInfoEx and
        // correlate with Screen::AllScreens by device name.
        //
        // The process must be PER_MONITOR_AWARE_V2 for the returned bounds to
        // be in physical pixels (rather than rescaled logical pixels). That's
        // set at PowerShellSession startup.
        const script = `
            Add-Type -AssemblyName System.Windows.Forms

            if (-not ("MCP_MonitorDpi" -as [type])) {
                Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class MCP_MonitorDpi {
    [DllImport("shcore.dll")]
    public static extern int GetDpiForMonitor(IntPtr hmonitor, int dpiType, out uint dpiX, out uint dpiY);

    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromPoint(POINT pt, uint dwFlags);

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    public static uint GetDpiAtPoint(int x, int y) {
        POINT p; p.X = x; p.Y = y;
        IntPtr hMon = MonitorFromPoint(p, 2); // MONITOR_DEFAULTTONEAREST
        uint dpiX, dpiY;
        int hr = GetDpiForMonitor(hMon, 0, out dpiX, out dpiY); // MDT_EFFECTIVE_DPI
        if (hr != 0) return 96;
        return dpiX;
    }
}
"@
            }

            $screens = [System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
                $s = $_
                # Sample a point inside this monitor to get its DPI.
                $sampleX = $s.Bounds.X + [int]($s.Bounds.Width / 2)
                $sampleY = $s.Bounds.Y + [int]($s.Bounds.Height / 2)
                $dpi = 96
                try { $dpi = [MCP_MonitorDpi]::GetDpiAtPoint($sampleX, $sampleY) } catch {}

                [PSCustomObject]@{
                    DeviceName = $s.DeviceName
                    Primary = $s.Primary
                    Bounds = @{
                        X = $s.Bounds.X
                        Y = $s.Bounds.Y
                        Width = $s.Bounds.Width
                        Height = $s.Bounds.Height
                    }
                    WorkingArea = @{
                        X = $s.WorkingArea.X
                        Y = $s.WorkingArea.Y
                        Width = $s.WorkingArea.Width
                        Height = $s.WorkingArea.Height
                    }
                    Dpi = [int]$dpi
                    ScaleFactor = [math]::Round($dpi / 96.0, 3)
                }
            }

            # Also compute virtual screen bounds so the agent knows the full
            # coordinate space spanning all monitors (including negative origins).
            $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen

            $result = [PSCustomObject]@{
                Displays = @($screens)
                VirtualScreen = @{
                    X = $vs.X
                    Y = $vs.Y
                    Width = $vs.Width
                    Height = $vs.Height
                }
            }

            $result | ConvertTo-Json -Depth 5
        `;
        const stdout = await PowerShellSession.getInstance().execute(script);
        const parsed = JSON.parse(stdout);
        // Return a structured object the handler can wrap — we want to preserve
        // VirtualScreen at the top level, which handleGetScreenInfo will merge in.
        return parsed as any;
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
        const info = await getDisplayInfo() as any;

        await logAudit('get_screen_info', {}, 'success');

        // Windows path returns structured { Displays, VirtualScreen }; other
        // platforms return a plain display array. Normalize to a single shape
        // so callers can rely on it regardless of OS.
        let displays: any[];
        let virtualScreen: any = null;
        if (info && typeof info === 'object' && !Array.isArray(info) && info.Displays) {
            displays = info.Displays;
            virtualScreen = info.VirtualScreen;
        } else {
            displays = Array.isArray(info) ? info : [info];
        }

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    platform: os.platform(),
                    displayCount: displays.length,
                    displays,
                    virtualScreen,
                    // Hint for agents: use these coordinates when calling
                    // mouse_click / mouse_move. Negative X or Y means a monitor
                    // is to the left of / above the primary.
                    note: virtualScreen
                        ? `Virtual screen spans (${virtualScreen.X}, ${virtualScreen.Y}) to (${virtualScreen.X + virtualScreen.Width}, ${virtualScreen.Y + virtualScreen.Height}). Clicks must land inside this rectangle.`
                        : 'Virtual screen bounds not available on this platform.'
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
