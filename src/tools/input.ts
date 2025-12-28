import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { logAudit } from '../audit.js';
import { PowerShellSession } from '../utils/powerShellSession.js';

const execAsync = promisify(exec);

// Schema definitions
export const KeyboardTypeSchema = {
    text: z.string().describe('Text to type'),
    delay: z.number().optional().describe('Delay between keystrokes in ms (default: 0)'),
};

export const KeyboardPressSchema = {
    key: z.string().describe('Key to press (e.g., "enter", "tab", "escape", "f1")'),
    modifiers: z.array(z.enum(['ctrl', 'alt', 'shift', 'meta', 'win', 'command'])).optional()
        .describe('Modifier keys to hold while pressing'),
};

export const KeyboardShortcutSchema = {
    shortcut: z.string().describe('Shortcut string (e.g., "ctrl+c", "alt+tab", "ctrl+shift+s")'),
};

export const MouseMoveSchema = {
    x: z.number().describe('X coordinate'),
    y: z.number().describe('Y coordinate'),
    smooth: z.boolean().optional().describe('Use smooth movement (default: false)'),
    duration: z.number().optional().describe('Duration of smooth movement in ms'),
};

export const MouseClickSchema = {
    x: z.number().optional().describe('X coordinate (uses current position if not specified)'),
    y: z.number().optional().describe('Y coordinate (uses current position if not specified)'),
    button: z.enum(['left', 'right', 'middle']).optional().describe('Mouse button (default: left)'),
    clicks: z.number().optional().describe('Number of clicks (default: 1, use 2 for double-click)'),
};

export const MouseDragSchema = {
    startX: z.number().describe('Start X coordinate'),
    startY: z.number().describe('Start Y coordinate'),
    endX: z.number().describe('End X coordinate'),
    endY: z.number().describe('End Y coordinate'),
    button: z.enum(['left', 'right', 'middle']).optional().describe('Mouse button (default: left)'),
    duration: z.number().optional().describe('Duration of drag in ms'),
};

export const MouseScrollSchema = {
    x: z.number().optional().describe('X coordinate (uses current position if not specified)'),
    y: z.number().optional().describe('Y coordinate (uses current position if not specified)'),
    deltaX: z.number().optional().describe('Horizontal scroll amount'),
    deltaY: z.number().describe('Vertical scroll amount (positive = down, negative = up)'),
};

export const GetMousePositionSchema = {};

// Batch schemas
export const BatchKeyboardActionsSchema = {
    actions: z.array(z.union([
        z.object({ type: z.literal('type'), text: z.string(), delay: z.number().optional() }),
        z.object({ type: z.literal('press'), key: z.string(), modifiers: z.array(z.string()).optional() }),
        z.object({ type: z.literal('shortcut'), shortcut: z.string() }),
        z.object({ type: z.literal('wait'), ms: z.number() }),
    ])).describe('Array of keyboard actions to execute sequentially'),
};

export const BatchMouseActionsSchema = {
    actions: z.array(z.union([
        z.object({ type: z.literal('move'), x: z.number(), y: z.number(), smooth: z.boolean().optional() }),
        z.object({ type: z.literal('click'), x: z.number().optional(), y: z.number().optional(), button: z.string().optional(), clicks: z.number().optional() }),
        z.object({ type: z.literal('drag'), startX: z.number(), startY: z.number(), endX: z.number(), endY: z.number() }),
        z.object({ type: z.literal('scroll'), deltaY: z.number(), deltaX: z.number().optional() }),
        z.object({ type: z.literal('wait'), ms: z.number() }),
    ])).describe('Array of mouse actions to execute sequentially'),
};

// Platform-specific implementations
const platform = os.platform();

async function sendKeys(text: string): Promise<void> {
    if (platform === 'win32') {
        // Escape special characters for PowerShell
        const escaped = text.replace(/'/g, "''").replace(/`/g, '``');
        const script = `
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait('${escaped}')
        `;
        await PowerShellSession.getInstance().execute(script);
    } else if (platform === 'darwin') {
        // macOS: use osascript
        const escaped = text.replace(/"/g, '\\"').replace(/'/g, "'\\''");
        await execAsync(`osascript -e 'tell application "System Events" to keystroke "${escaped}"'`, { timeout: 5000 });
    } else {
        // Linux: use xdotool
        await execAsync(`xdotool type "${text.replace(/"/g, '\\"')}"`, { timeout: 5000 });
    }
}

async function pressKey(key: string, modifiers: string[] = []): Promise<void> {
    if (platform === 'win32') {
        const keyMap: Record<string, string> = {
            'enter': '{ENTER}', 'tab': '{TAB}', 'escape': '{ESC}', 'esc': '{ESC}',
            'backspace': '{BACKSPACE}', 'delete': '{DELETE}', 'del': '{DELETE}',
            'up': '{UP}', 'down': '{DOWN}', 'left': '{LEFT}', 'right': '{RIGHT}',
            'home': '{HOME}', 'end': '{END}', 'pageup': '{PGUP}', 'pagedown': '{PGDN}',
            'f1': '{F1}', 'f2': '{F2}', 'f3': '{F3}', 'f4': '{F4}', 'f5': '{F5}',
            'f6': '{F6}', 'f7': '{F7}', 'f8': '{F8}', 'f9': '{F9}', 'f10': '{F10}',
            'f11': '{F11}', 'f12': '{F12}', 'space': ' ',
        };

        let sendKey = keyMap[key.toLowerCase()] || key;

        // Add modifiers
        let prefix = '';
        if (modifiers.includes('ctrl')) prefix += '^';
        if (modifiers.includes('alt')) prefix += '%';
        if (modifiers.includes('shift')) prefix += '+';

        const script = `
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait('${prefix}${sendKey}')
        `;
        await PowerShellSession.getInstance().execute(script);
    } else if (platform === 'darwin') {
        let modStr = '';
        if (modifiers.includes('ctrl') || modifiers.includes('command') || modifiers.includes('meta')) modStr += 'command down, ';
        if (modifiers.includes('alt')) modStr += 'option down, ';
        if (modifiers.includes('shift')) modStr += 'shift down, ';

        const keyCode = key.length === 1 ? `"${key}"` : `key code ${getMacKeyCode(key)}`;
        await execAsync(`osascript -e 'tell application "System Events" to key code ${keyCode} using {${modStr.slice(0, -2)}}'`, { timeout: 5000 });
    } else {
        const modStr = modifiers.map(m => m === 'ctrl' ? 'ctrl' : m === 'alt' ? 'alt' : m === 'shift' ? 'shift' : 'super').join('+');
        const keyStr = modStr ? `${modStr}+${key}` : key;
        await execAsync(`xdotool key ${keyStr}`, { timeout: 5000 });
    }
}

function getMacKeyCode(key: string): number {
    const codes: Record<string, number> = {
        'enter': 36, 'return': 36, 'tab': 48, 'space': 49, 'delete': 51,
        'escape': 53, 'esc': 53, 'up': 126, 'down': 125, 'left': 123, 'right': 124,
        'f1': 122, 'f2': 120, 'f3': 99, 'f4': 118, 'f5': 96, 'f6': 97,
    };
    return codes[key.toLowerCase()] || 0;
}

// Unified Mouse class for persistent session
const EnsureMCPMouseScript = `
    if (-not ("MCP_Mouse" -as [type])) {
        Add-Type -TypeDefinition @"
        using System;
        using System.Runtime.InteropServices;
        public class MCP_Mouse {
            [DllImport("user32.dll")]
            public static extern bool SetCursorPos(int X, int Y);
            
            [DllImport("user32.dll")]
            public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
            
            [StructLayout(LayoutKind.Sequential)]
            public struct POINT { public int X; public int Y; }
            
            [DllImport("user32.dll")]
            public static extern bool GetCursorPos(out POINT lpPoint);
        }
"@
    }
`;

async function moveMouse(x: number, y: number): Promise<void> {
    if (platform === 'win32') {
        const script = `
            ${EnsureMCPMouseScript}
            [MCP_Mouse]::SetCursorPos(${x}, ${y})
        `;
        await PowerShellSession.getInstance().execute(script);
    } else if (platform === 'darwin') {
        await execAsync(`osascript -e 'tell application "System Events" to click at {${x}, ${y}}'`, { timeout: 5000 });
    } else {
        await execAsync(`xdotool mousemove ${x} ${y}`, { timeout: 5000 });
    }
}

async function clickMouse(x?: number, y?: number, button: string = 'left', clicks: number = 1): Promise<void> {
    if (platform === 'win32') {
        const buttonCode = button === 'right' ? 2 : button === 'middle' ? 4 : 1;
        let script = EnsureMCPMouseScript;

        if (x !== undefined && y !== undefined) {
             script += `[MCP_Mouse]::SetCursorPos(${x}, ${y}); `;
        }
        
        const downFlag = button === 'right' ? 8 : button === 'middle' ? 32 : 2;
        const upFlag = button === 'right' ? 16 : button === 'middle' ? 64 : 4;

        for (let i = 0; i < clicks; i++) {
            script += `[MCP_Mouse]::mouse_event(${downFlag}, 0, 0, 0, 0); [MCP_Mouse]::mouse_event(${upFlag}, 0, 0, 0, 0); `;
        }

        await PowerShellSession.getInstance().execute(script);
    } else if (platform === 'darwin') {
        if (x !== undefined && y !== undefined) {
            await execAsync(`osascript -e 'tell application "System Events" to click at {${x}, ${y}}'`, { timeout: 5000 });
        } else {
            await execAsync(`osascript -e 'tell application "System Events" to click'`, { timeout: 5000 });
        }
    } else {
        const btnNum = button === 'right' ? 3 : button === 'middle' ? 2 : 1;
        let cmd = x !== undefined && y !== undefined ? `xdotool mousemove ${x} ${y} && ` : '';
        cmd += `xdotool click --repeat ${clicks} ${btnNum}`;
        await execAsync(cmd, { timeout: 5000 });
    }
}

async function getMousePosition(): Promise<{ x: number; y: number }> {
    if (platform === 'win32') {
        const script = `
            ${EnsureMCPMouseScript}
            $point = New-Object MCP_Mouse+POINT
            [MCP_Mouse]::GetCursorPos([ref]$point) | Out-Null
            Write-Output "$($point.X),$($point.Y)"
        `;
        const stdout = await PowerShellSession.getInstance().execute(script);
        const [x, y] = stdout.trim().split(',').map(Number);
        return { x, y };
    } else if (platform === 'darwin') {
        // macOS doesn't have a simple way to get mouse position without additional tools
        return { x: 0, y: 0 };
    } else {
        const { stdout } = await execAsync('xdotool getmouselocation --shell', { timeout: 5000 });
        const x = parseInt(stdout.match(/X=(\d+)/)?.[1] || '0');
        const y = parseInt(stdout.match(/Y=(\d+)/)?.[1] || '0');
        return { x, y };
    }
}

// Tool handlers
export async function handleKeyboardType(args: { text: string; delay?: number }) {
    try {
        if (args.delay && args.delay > 0) {
            for (const char of args.text) {
                await sendKeys(char);
                await new Promise(resolve => setTimeout(resolve, args.delay));
            }
        } else {
            await sendKeys(args.text);
        }

        await logAudit('keyboard_type', { textLength: args.text.length }, 'success');

        return {
            content: [{ type: 'text', text: JSON.stringify({ typed: true, length: args.text.length }, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('keyboard_type', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleKeyboardPress(args: { key: string; modifiers?: string[] }) {
    try {
        await pressKey(args.key, args.modifiers || []);

        await logAudit('keyboard_press', args, 'success');

        return {
            content: [{ type: 'text', text: JSON.stringify({ pressed: true, key: args.key, modifiers: args.modifiers }, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('keyboard_press', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleKeyboardShortcut(args: { shortcut: string }) {
    try {
        const parts = args.shortcut.toLowerCase().split('+');
        const key = parts.pop() || '';
        const modifiers = parts;

        await pressKey(key, modifiers);

        await logAudit('keyboard_shortcut', args, 'success');

        return {
            content: [{ type: 'text', text: JSON.stringify({ executed: true, shortcut: args.shortcut }, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('keyboard_shortcut', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleMouseMove(args: { x: number; y: number; smooth?: boolean; duration?: number }) {
    try {
        if (args.smooth && args.duration) {
            // Smooth movement (simplified - just move directly for now)
            await moveMouse(args.x, args.y);
        } else {
            await moveMouse(args.x, args.y);
        }

        await logAudit('mouse_move', args, 'success');

        return {
            content: [{ type: 'text', text: JSON.stringify({ moved: true, x: args.x, y: args.y }, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('mouse_move', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleMouseClick(args: { x?: number; y?: number; button?: 'left' | 'right' | 'middle'; clicks?: number }) {
    try {
        await clickMouse(args.x, args.y, args.button || 'left', args.clicks || 1);

        await logAudit('mouse_click', args, 'success');

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    clicked: true,
                    x: args.x,
                    y: args.y,
                    button: args.button || 'left',
                    clicks: args.clicks || 1
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('mouse_click', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleMouseDrag(args: { startX: number; startY: number; endX: number; endY: number; button?: 'left' | 'right' | 'middle'; duration?: number }) {
    try {
        // Move to start, press, move to end, release
        await moveMouse(args.startX, args.startY);
        // For drag we need to hold the button - this is simplified
        await clickMouse(args.startX, args.startY, args.button || 'left', 1);
        await moveMouse(args.endX, args.endY);

        await logAudit('mouse_drag', args, 'success');

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    dragged: true,
                    from: { x: args.startX, y: args.startY },
                    to: { x: args.endX, y: args.endY }
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('mouse_drag', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleMouseScroll(args: { x?: number; y?: number; deltaX?: number; deltaY: number }) {
    try {
        if (args.x !== undefined && args.y !== undefined) {
            await moveMouse(args.x, args.y);
        }

        if (platform === 'win32') {
            const scrollAmt = (args.deltaY || 0) * -120;
            const script = `
                ${EnsureMCPMouseScript}
                [MCP_Mouse]::mouse_event(0x0800, 0, 0, ${scrollAmt}, 0)
            `;
            await PowerShellSession.getInstance().execute(script);
        } else if (platform === 'darwin') {
            await execAsync(`osascript -e 'tell application "System Events" to scroll vertical by ${args.deltaY}'`, { timeout: 5000 });
        } else {
            const direction = args.deltaY > 0 ? 5 : 4;
            const times = Math.abs(args.deltaY);
            await execAsync(`xdotool click --repeat ${times} ${direction}`, { timeout: 5000 });
        }

        await logAudit('mouse_scroll', args, 'success');

        return {
            content: [{ type: 'text', text: JSON.stringify({ scrolled: true, deltaY: args.deltaY }, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('mouse_scroll', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleGetMousePosition() {
    try {
        const pos = await getMousePosition();

        await logAudit('get_mouse_position', {}, 'success');

        return {
            content: [{ type: 'text', text: JSON.stringify(pos, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('get_mouse_position', {}, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

// Batch handlers
export async function handleBatchKeyboardActions(args: { actions: any[] }) {
    const startTime = Date.now();
    const results: any[] = [];

    for (let i = 0; i < args.actions.length; i++) {
        const action = args.actions[i];
        try {
            switch (action.type) {
                case 'type':
                    await sendKeys(action.text);
                    results.push({ index: i, success: true, action: 'type' });
                    break;
                case 'press':
                    await pressKey(action.key, action.modifiers || []);
                    results.push({ index: i, success: true, action: 'press' });
                    break;
                case 'shortcut':
                    const parts = action.shortcut.toLowerCase().split('+');
                    const key = parts.pop() || '';
                    await pressKey(key, parts);
                    results.push({ index: i, success: true, action: 'shortcut' });
                    break;
                case 'wait':
                    await new Promise(resolve => setTimeout(resolve, action.ms));
                    results.push({ index: i, success: true, action: 'wait' });
                    break;
            }
        } catch (error: any) {
            results.push({ index: i, success: false, action: action.type, error: error.message });
        }
    }

    const elapsed = Date.now() - startTime;
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    await logAudit('batch_keyboard_actions', { count: args.actions.length }, { successful, failed, elapsed });

    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                summary: { total: args.actions.length, successful, failed, elapsed_ms: elapsed },
                results
            }, null, 2)
        }],
        isError: failed > 0 && successful === 0,
    };
}

export async function handleBatchMouseActions(args: { actions: any[] }) {
    const startTime = Date.now();
    const results: any[] = [];

    for (let i = 0; i < args.actions.length; i++) {
        const action = args.actions[i];
        try {
            switch (action.type) {
                case 'move':
                    await moveMouse(action.x, action.y);
                    results.push({ index: i, success: true, action: 'move' });
                    break;
                case 'click':
                    await clickMouse(action.x, action.y, action.button || 'left', action.clicks || 1);
                    results.push({ index: i, success: true, action: 'click' });
                    break;
                case 'drag':
                    await moveMouse(action.startX, action.startY);
                    await clickMouse(action.startX, action.startY);
                    await moveMouse(action.endX, action.endY);
                    results.push({ index: i, success: true, action: 'drag' });
                    break;
                case 'scroll':
                    if (platform === 'win32') {
                         const scrollAmt = (action.deltaY || 0) * -120;
                         const scrollScript = `
                             ${EnsureMCPMouseScript}
                             [MCP_Mouse]::mouse_event(0x0800, 0, 0, ${scrollAmt}, 0)
                         `;
                         await PowerShellSession.getInstance().execute(scrollScript);
                    } else if (platform !== 'darwin') {
                        const direction = (action.deltaY || 0) > 0 ? 5 : 4;
                        const times = Math.abs(action.deltaY || 1);
                        await execAsync(`xdotool click --repeat ${times} ${direction}`, { timeout: 5000 });
                    }
                    results.push({ index: i, success: true, action: 'scroll' });
                    break;
                case 'wait':
                    await new Promise(resolve => setTimeout(resolve, action.ms));
                    results.push({ index: i, success: true, action: 'wait' });
                    break;
            }
        } catch (error: any) {
            results.push({ index: i, success: false, action: action.type, error: error.message });
        }
    }

    const elapsed = Date.now() - startTime;
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    await logAudit('batch_mouse_actions', { count: args.actions.length }, { successful, failed, elapsed });

    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                summary: { total: args.actions.length, successful, failed, elapsed_ms: elapsed },
                results
            }, null, 2)
        }],
        isError: failed > 0 && successful === 0,
    };
}
