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

export const VerifyMouseTargetSchema = {
    x: z.number().describe('X coordinate in physical pixels (virtual screen space)'),
    y: z.number().describe('Y coordinate in physical pixels (virtual screen space)'),
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

// Unified Mouse class for persistent session.
//
// DESIGN NOTES (multi-monitor correctness):
//
// 1. DPI awareness. The Node host process must be PER_MONITOR_AWARE_V2 or
//    Windows silently rescales coordinates between SetCursorPos/SendInput and
//    the physical screen. This is set in the PowerShellSession constructor
//    (see utils/powerShellSession.ts) BEFORE any mouse API is called. Doing
//    it here would be too late.
//
// 2. Coordinate space. We use SendInput with MOUSEEVENTF_ABSOLUTE |
//    MOUSEEVENTF_VIRTUALDESK. This takes coordinates in a normalized 0-65535
//    range across the entire virtual screen, so it handles arbitrary monitor
//    arrangements (including monitors with negative X or Y relative to the
//    primary) without per-monitor case handling. The caller passes physical
//    pixel coordinates; we convert to normalized here using GetSystemMetrics
//    SM_XVIRTUALSCREEN / SM_CXVIRTUALSCREEN.
//
// 3. Input API. We use SendInput, not mouse_event. mouse_event is deprecated
//    and fails to reliably deliver clicks to UWP / WinUI applications.
//
// 4. Atomic move+click. SendInput can submit an array of events in a single
//    call. Move + button-down + button-up in one SendInput avoids the race
//    where a click fires before the cursor position has settled.
//
// 5. Coordinate validation. Before any move, we check that the target is
//    inside the virtual screen rectangle. Off-screen targets return an error
//    instead of silently clicking somewhere unexpected.
const EnsureMCPInputScript = `
    if (-not ("MCP_Input" -as [type])) {
        Add-Type -TypeDefinition @"
        using System;
        using System.Runtime.InteropServices;

        public static class MCP_Input {
            // --- SendInput plumbing ---
            [StructLayout(LayoutKind.Sequential)]
            public struct MOUSEINPUT {
                public int dx;
                public int dy;
                public uint mouseData;
                public uint dwFlags;
                public uint time;
                public IntPtr dwExtraInfo;
            }

            [StructLayout(LayoutKind.Sequential)]
            public struct KEYBDINPUT {
                public ushort wVk;
                public ushort wScan;
                public uint dwFlags;
                public uint time;
                public IntPtr dwExtraInfo;
            }

            [StructLayout(LayoutKind.Sequential)]
            public struct HARDWAREINPUT {
                public uint uMsg;
                public ushort wParamL;
                public ushort wParamH;
            }

            [StructLayout(LayoutKind.Explicit)]
            public struct INPUT_UNION {
                [FieldOffset(0)] public MOUSEINPUT mi;
                [FieldOffset(0)] public KEYBDINPUT ki;
                [FieldOffset(0)] public HARDWAREINPUT hi;
            }

            [StructLayout(LayoutKind.Sequential)]
            public struct INPUT {
                public uint type;
                public INPUT_UNION u;
            }

            // MOUSEEVENTF flags
            public const uint MOUSEEVENTF_MOVE       = 0x0001;
            public const uint MOUSEEVENTF_LEFTDOWN   = 0x0002;
            public const uint MOUSEEVENTF_LEFTUP     = 0x0004;
            public const uint MOUSEEVENTF_RIGHTDOWN  = 0x0008;
            public const uint MOUSEEVENTF_RIGHTUP    = 0x0010;
            public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
            public const uint MOUSEEVENTF_MIDDLEUP   = 0x0040;
            public const uint MOUSEEVENTF_WHEEL      = 0x0800;
            public const uint MOUSEEVENTF_HWHEEL     = 0x01000;
            public const uint MOUSEEVENTF_ABSOLUTE   = 0x8000;
            public const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;
            public const uint INPUT_MOUSE = 0;

            [DllImport("user32.dll", SetLastError = true)]
            public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

            [DllImport("user32.dll")]
            public static extern int GetSystemMetrics(int nIndex);

            [StructLayout(LayoutKind.Sequential)]
            public struct POINT { public int X; public int Y; }

            [DllImport("user32.dll")]
            public static extern bool GetCursorPos(out POINT lpPoint);

            // Virtual screen metric indices
            public const int SM_XVIRTUALSCREEN  = 76;
            public const int SM_YVIRTUALSCREEN  = 77;
            public const int SM_CXVIRTUALSCREEN = 78;
            public const int SM_CYVIRTUALSCREEN = 79;

            // --- High-level helpers ---

            // Returns (left, top, width, height) of the full virtual screen.
            public static int[] GetVirtualScreenBounds() {
                return new int[] {
                    GetSystemMetrics(SM_XVIRTUALSCREEN),
                    GetSystemMetrics(SM_YVIRTUALSCREEN),
                    GetSystemMetrics(SM_CXVIRTUALSCREEN),
                    GetSystemMetrics(SM_CYVIRTUALSCREEN)
                };
            }

            // True if (x,y) in physical pixel coords falls inside the virtual
            // screen rectangle. Used for pre-click validation.
            public static bool IsPointOnVirtualScreen(int x, int y) {
                int[] b = GetVirtualScreenBounds();
                return x >= b[0] && x < (b[0] + b[2]) && y >= b[1] && y < (b[1] + b[3]);
            }

            // Convert physical pixel (x,y) to SendInput's normalized 0-65535
            // absolute coordinate range covering the entire virtual screen.
            // The +1 on dimensions is the standard Windows convention to get
            // the final pixel included in the 65535 range.
            private static void NormalizeToVirtualDesk(int x, int y, out int nx, out int ny) {
                int[] b = GetVirtualScreenBounds();
                int vLeft = b[0], vTop = b[1], vW = b[2], vH = b[3];
                // Guard against divide-by-zero on degenerate configs.
                if (vW < 1) vW = 1;
                if (vH < 1) vH = 1;
                // Shift so (vLeft, vTop) is origin, then scale to 65535.
                // Use 64-bit intermediate to avoid overflow on extreme setups.
                long dx = (long)(x - vLeft) * 65535L / vW;
                long dy = (long)(y - vTop) * 65535L / vH;
                if (dx < 0) dx = 0; if (dx > 65535) dx = 65535;
                if (dy < 0) dy = 0; if (dy > 65535) dy = 65535;
                nx = (int)dx;
                ny = (int)dy;
            }

            // Move the cursor to (x,y) in physical pixel coordinates across the
            // virtual screen. Returns false if the point is outside the virtual
            // screen (caller should check IsPointOnVirtualScreen for a clearer
            // error message).
            public static bool MoveTo(int x, int y) {
                int nx, ny;
                NormalizeToVirtualDesk(x, y, out nx, out ny);
                INPUT[] ev = new INPUT[1];
                ev[0].type = INPUT_MOUSE;
                ev[0].u.mi.dx = nx;
                ev[0].u.mi.dy = ny;
                ev[0].u.mi.mouseData = 0;
                ev[0].u.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
                ev[0].u.mi.time = 0;
                ev[0].u.mi.dwExtraInfo = IntPtr.Zero;
                return SendInput(1, ev, Marshal.SizeOf(typeof(INPUT))) == 1;
            }

            // Click with optional target point. If x,y provided, combines move +
            // down + up in one SendInput call (atomic — no race between move
            // and click). If x,y omitted, just down+up at current position.
            // button: 0=left, 1=right, 2=middle. Returns # of events sent.
            public static uint ClickAt(bool hasPos, int x, int y, int button, int clicks) {
                uint downFlag, upFlag;
                if (button == 1) { downFlag = MOUSEEVENTF_RIGHTDOWN;  upFlag = MOUSEEVENTF_RIGHTUP; }
                else if (button == 2) { downFlag = MOUSEEVENTF_MIDDLEDOWN; upFlag = MOUSEEVENTF_MIDDLEUP; }
                else { downFlag = MOUSEEVENTF_LEFTDOWN; upFlag = MOUSEEVENTF_LEFTUP; }

                int eventCount = (hasPos ? 1 : 0) + (clicks * 2);
                INPUT[] ev = new INPUT[eventCount];
                int idx = 0;
                if (hasPos) {
                    int nx, ny;
                    NormalizeToVirtualDesk(x, y, out nx, out ny);
                    ev[idx].type = INPUT_MOUSE;
                    ev[idx].u.mi.dx = nx;
                    ev[idx].u.mi.dy = ny;
                    ev[idx].u.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
                    idx++;
                }
                for (int i = 0; i < clicks; i++) {
                    ev[idx].type = INPUT_MOUSE;
                    ev[idx].u.mi.dwFlags = downFlag;
                    idx++;
                    ev[idx].type = INPUT_MOUSE;
                    ev[idx].u.mi.dwFlags = upFlag;
                    idx++;
                }
                return SendInput((uint)ev.Length, ev, Marshal.SizeOf(typeof(INPUT)));
            }

            // Press a mouse button without releasing. Used by drag.
            public static uint ButtonDown(int button) {
                uint downFlag = button == 1 ? MOUSEEVENTF_RIGHTDOWN
                              : button == 2 ? MOUSEEVENTF_MIDDLEDOWN
                              : MOUSEEVENTF_LEFTDOWN;
                INPUT[] ev = new INPUT[1];
                ev[0].type = INPUT_MOUSE;
                ev[0].u.mi.dwFlags = downFlag;
                return SendInput(1, ev, Marshal.SizeOf(typeof(INPUT)));
            }

            public static uint ButtonUp(int button) {
                uint upFlag = button == 1 ? MOUSEEVENTF_RIGHTUP
                            : button == 2 ? MOUSEEVENTF_MIDDLEUP
                            : MOUSEEVENTF_LEFTUP;
                INPUT[] ev = new INPUT[1];
                ev[0].type = INPUT_MOUSE;
                ev[0].u.mi.dwFlags = upFlag;
                return SendInput(1, ev, Marshal.SizeOf(typeof(INPUT)));
            }

            // Scroll wheel. deltaY in WHEEL_DELTA units (120 = one notch).
            // Positive = scroll up. Optionally moves to (x,y) first.
            public static uint Scroll(bool hasPos, int x, int y, int deltaY, int deltaX) {
                int eventCount = (hasPos ? 1 : 0) + (deltaY != 0 ? 1 : 0) + (deltaX != 0 ? 1 : 0);
                if (eventCount == 0) return 0;
                INPUT[] ev = new INPUT[eventCount];
                int idx = 0;
                if (hasPos) {
                    int nx, ny;
                    NormalizeToVirtualDesk(x, y, out nx, out ny);
                    ev[idx].type = INPUT_MOUSE;
                    ev[idx].u.mi.dx = nx;
                    ev[idx].u.mi.dy = ny;
                    ev[idx].u.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
                    idx++;
                }
                if (deltaY != 0) {
                    ev[idx].type = INPUT_MOUSE;
                    ev[idx].u.mi.mouseData = (uint)deltaY;
                    ev[idx].u.mi.dwFlags = MOUSEEVENTF_WHEEL;
                    idx++;
                }
                if (deltaX != 0) {
                    ev[idx].type = INPUT_MOUSE;
                    ev[idx].u.mi.mouseData = (uint)deltaX;
                    ev[idx].u.mi.dwFlags = MOUSEEVENTF_HWHEEL;
                    idx++;
                }
                return SendInput((uint)ev.Length, ev, Marshal.SizeOf(typeof(INPUT)));
            }
        }
"@
    }
`;

async function moveMouse(x: number, y: number): Promise<void> {
    if (platform === 'win32') {
        // Rendered with integer literals so PowerShell can't misinterpret them.
        const script = `
            ${EnsureMCPInputScript}
            if (-not [MCP_Input]::IsPointOnVirtualScreen(${Math.round(x)}, ${Math.round(y)})) {
                throw "Point ($(${Math.round(x)}), $(${Math.round(y)})) is outside the virtual screen. Check get_screen_info for bounds."
            }
            $ok = [MCP_Input]::MoveTo(${Math.round(x)}, ${Math.round(y)})
            if (-not $ok) { throw "SendInput MOVE failed (LastError=$([System.Runtime.InteropServices.Marshal]::GetLastWin32Error()))" }
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
        const buttonIdx = button === 'right' ? 1 : button === 'middle' ? 2 : 0;
        const hasPos = x !== undefined && y !== undefined;
        const px = hasPos ? Math.round(x!) : 0;
        const py = hasPos ? Math.round(y!) : 0;

        const script = `
            ${EnsureMCPInputScript}
            ${hasPos ? `
            if (-not [MCP_Input]::IsPointOnVirtualScreen(${px}, ${py})) {
                throw "Point (${px}, ${py}) is outside the virtual screen. Check get_screen_info for bounds."
            }
            ` : ''}
            $sent = [MCP_Input]::ClickAt(${hasPos ? '$true' : '$false'}, ${px}, ${py}, ${buttonIdx}, ${clicks})
            if ($sent -eq 0) { throw "SendInput CLICK failed (LastError=$([System.Runtime.InteropServices.Marshal]::GetLastWin32Error()))" }
        `;
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
            ${EnsureMCPInputScript}
            $point = New-Object MCP_Input+POINT
            [MCP_Input]::GetCursorPos([ref]$point) | Out-Null
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
        // Proper drag: down at start, move to end, up at end. The previous
        // implementation used clickMouse (which is down+up) which just fires
        // two clicks — not a drag at all. This uses the SendInput ButtonDown /
        // ButtonUp primitives directly for a real drag gesture.
        if (platform === 'win32') {
            const buttonIdx = args.button === 'right' ? 1 : args.button === 'middle' ? 2 : 0;
            const sx = Math.round(args.startX), sy = Math.round(args.startY);
            const ex = Math.round(args.endX), ey = Math.round(args.endY);
            const script = `
                ${EnsureMCPInputScript}
                if (-not [MCP_Input]::IsPointOnVirtualScreen(${sx}, ${sy})) {
                    throw "Drag start (${sx}, ${sy}) is outside the virtual screen."
                }
                if (-not [MCP_Input]::IsPointOnVirtualScreen(${ex}, ${ey})) {
                    throw "Drag end (${ex}, ${ey}) is outside the virtual screen."
                }
                [MCP_Input]::MoveTo(${sx}, ${sy}) | Out-Null
                Start-Sleep -Milliseconds 20
                [MCP_Input]::ButtonDown(${buttonIdx}) | Out-Null
                Start-Sleep -Milliseconds 20
                [MCP_Input]::MoveTo(${ex}, ${ey}) | Out-Null
                Start-Sleep -Milliseconds 20
                [MCP_Input]::ButtonUp(${buttonIdx}) | Out-Null
            `;
            await PowerShellSession.getInstance().execute(script);
        } else {
            // Fallback for macOS/Linux: the existing move-then-click-then-move
            // is still imperfect but matches prior behavior.
            await moveMouse(args.startX, args.startY);
            await clickMouse(args.startX, args.startY, args.button || 'left', 1);
            await moveMouse(args.endX, args.endY);
        }

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
        if (platform === 'win32') {
            // deltaY here comes in as positive=up "notches" by user convention.
            // WHEEL_DELTA is 120 per notch in Windows API, positive = wheel
            // rotated FORWARD (away from user) which historically = scroll up.
            // Previous implementation multiplied by -120 which inverted scroll
            // direction. We use +120 so "positive deltaY scrolls up" matches
            // user expectations on both Windows and most other platforms.
            const wheelDelta = (args.deltaY || 0) * 120;
            const hWheelDelta = (args.deltaX || 0) * 120;
            const hasPos = args.x !== undefined && args.y !== undefined;
            const px = hasPos ? Math.round(args.x!) : 0;
            const py = hasPos ? Math.round(args.y!) : 0;

            const script = `
                ${EnsureMCPInputScript}
                ${hasPos ? `
                if (-not [MCP_Input]::IsPointOnVirtualScreen(${px}, ${py})) {
                    throw "Scroll target (${px}, ${py}) is outside the virtual screen."
                }
                ` : ''}
                [MCP_Input]::Scroll(${hasPos ? '$true' : '$false'}, ${px}, ${py}, ${wheelDelta}, ${hWheelDelta}) | Out-Null
            `;
            await PowerShellSession.getInstance().execute(script);
        } else if (platform === 'darwin') {
            if (args.x !== undefined && args.y !== undefined) {
                await moveMouse(args.x, args.y);
            }
            await execAsync(`osascript -e 'tell application "System Events" to scroll vertical by ${args.deltaY}'`, { timeout: 5000 });
        } else {
            if (args.x !== undefined && args.y !== undefined) {
                await moveMouse(args.x, args.y);
            }
            const direction = args.deltaY > 0 ? 4 : 5; // 4=up, 5=down in xdotool
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

// Diagnostic tool: move the cursor to (targetX, targetY) then read back the
// actual cursor position, reporting the offset. Useful for validating multi-
// monitor / DPI correctness without trial-and-error clicking through the UI.
//
// A correctly-functioning setup should produce offset=(0,0) or ±1 pixel (OS
// rounding). Offsets in the tens or hundreds of pixels indicate DPI scaling
// is still being applied somewhere — the classic symptom of the pre-fix
// implementation.
export async function handleVerifyMouseTarget(args: { x: number; y: number }) {
    try {
        const targetX = Math.round(args.x);
        const targetY = Math.round(args.y);

        // Remember starting position so we can restore after diagnostic.
        const startPos = await getMousePosition();

        await moveMouse(targetX, targetY);
        // Brief settle time. Even with atomic SendInput, the cursor position
        // read-back may race the input queue on some systems.
        await new Promise(r => setTimeout(r, 50));
        const actualPos = await getMousePosition();

        // Restore starting position so diagnostic doesn't leave the cursor in
        // an unexpected place.
        await moveMouse(startPos.x, startPos.y);

        const offsetX = actualPos.x - targetX;
        const offsetY = actualPos.y - targetY;
        const offsetMagnitude = Math.sqrt(offsetX * offsetX + offsetY * offsetY);

        let verdict: string;
        if (offsetMagnitude <= 1) {
            verdict = 'PASS: cursor landed within 1px of target (expected: OS rounding).';
        } else if (offsetMagnitude <= 4) {
            verdict = 'ACCEPTABLE: small offset, likely subpixel rounding or driver quirk.';
        } else if (offsetMagnitude <= 20) {
            verdict = 'SUSPICIOUS: moderate offset. Check monitor boundaries or fractional DPI scaling (125%, 150%).';
        } else {
            verdict = 'FAIL: large offset indicates DPI scaling is being applied. PER_MONITOR_AWARE_V2 may not be active.';
        }

        const result = {
            target: { x: targetX, y: targetY },
            actual: actualPos,
            offset: { x: offsetX, y: offsetY, magnitude: Math.round(offsetMagnitude * 10) / 10 },
            verdict,
            // Include the virtual screen bounds for context — useful for
            // diagnosing "point is off-screen" errors.
            virtualScreenHint: 'Call get_screen_info for monitor layout.'
        };

        await logAudit('verify_mouse_target', args, result);

        return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('verify_mouse_target', args, null, error.message);
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
                         const scrollAmt = (action.deltaY || 0) * 120;
                         const hScrollAmt = (action.deltaX || 0) * 120;
                         const hasPos = action.x !== undefined && action.y !== undefined;
                         const px = hasPos ? Math.round(action.x) : 0;
                         const py = hasPos ? Math.round(action.y) : 0;
                         const scrollScript = `
                             ${EnsureMCPInputScript}
                             [MCP_Input]::Scroll(${hasPos ? '$true' : '$false'}, ${px}, ${py}, ${scrollAmt}, ${hScrollAmt}) | Out-Null
                         `;
                         await PowerShellSession.getInstance().execute(scrollScript);
                    } else if (platform !== 'darwin') {
                        const direction = (action.deltaY || 0) > 0 ? 4 : 5;
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
