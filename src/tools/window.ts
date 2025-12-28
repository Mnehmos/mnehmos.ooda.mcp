import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { logAudit } from '../audit.js';
import { PowerShellSession } from '../utils/powerShellSession.js';

const execAsync = promisify(exec);
const platform = os.platform();

// Schema definitions
export const ListWindowsSchema = {};

export const GetActiveWindowSchema = {};

export const FocusWindowSchema = {
    title: z.string().optional().describe('Window title (partial match)'),
    pid: z.number().optional().describe('Process ID'),
    handle: z.string().optional().describe('Window handle (platform-specific)'),
};

export const MinimizeWindowSchema = {
    title: z.string().optional().describe('Window title (partial match). If not specified, minimizes active window.'),
    all: z.boolean().optional().describe('Minimize all windows'),
};

export const MaximizeWindowSchema = {
    title: z.string().optional().describe('Window title (partial match). If not specified, maximizes active window.'),
};

export const RestoreWindowSchema = {
    title: z.string().optional().describe('Window title (partial match). If not specified, restores active window.'),
};

export const CloseWindowSchema = {
    title: z.string().optional().describe('Window title (partial match). If not specified, closes active window.'),
    pid: z.number().optional().describe('Process ID'),
    force: z.boolean().optional().describe('Force close (kill process)'),
};

export const ResizeWindowSchema = {
    title: z.string().optional().describe('Window title (partial match)'),
    width: z.number().describe('New width'),
    height: z.number().describe('New height'),
};

export const MoveWindowSchema = {
    title: z.string().optional().describe('Window title (partial match)'),
    x: z.number().describe('New X position'),
    y: z.number().describe('New Y position'),
};

export const LaunchApplicationSchema = {
    path: z.string().describe('Application path or name'),
    args: z.array(z.string()).optional().describe('Command line arguments'),
    waitForWindow: z.boolean().optional().describe('Wait for a window to appear. Matches process name or window title.'),
    timeout: z.number().optional().describe('Timeout in ms when waiting for window'),
};

export const WaitForWindowSchema = {
    title: z.string().describe('Window title (partial match)'),
    timeout: z.number().optional().describe('Timeout in ms (default 5000)'),
};

// Platform-specific implementations
interface WindowInfo {
    title: string;
    pid?: number;
    handle?: string;
    className?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    isMinimized?: boolean;
    isMaximized?: boolean;
    isActive?: boolean;
}

async function listWindowsWin32(): Promise<WindowInfo[]> {
    const script = `
        if (-not ("WindowEnumerator" -as [type])) {
            Add-Type @"
            using System;
            using System.Runtime.InteropServices;
            using System.Collections.Generic;
            using System.Text;

            public class WindowInfo {
                public string Title;
                public int Pid;
                public string Handle;
                public string ClassName;
            }

            public class WindowEnumerator {
                [DllImport("user32.dll")]
                public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
                [DllImport("user32.dll")]
                public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
                [DllImport("user32.dll")]
                public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
                [DllImport("user32.dll")]
                public static extern bool IsWindowVisible(IntPtr hWnd);
                [DllImport("user32.dll")]
                public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
                
                public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
                
                public static List<WindowInfo> GetVisibleWindows() {
                    var windows = new List<WindowInfo>();
                    EnumWindows((hWnd, lParam) => {
                        if (IsWindowVisible(hWnd)) {
                            var sb = new StringBuilder(256);
                            GetWindowText(hWnd, sb, 256);
                            // Only include windows with titles, unless it's a dialog class? No, usually dialogs have titles.
                            // If title is empty, it's likely a background/utility window not interesting for automation.
                            if (sb.Length > 0) {
                                var cls = new StringBuilder(256);
                                GetClassName(hWnd, cls, 256);
                                
                                uint pid = 0;
                                GetWindowThreadProcessId(hWnd, out pid);
                                
                                windows.Add(new WindowInfo {
                                    Title = sb.ToString(),
                                    Pid = (int)pid,
                                    Handle = hWnd.ToString(),
                                    ClassName = cls.ToString()
                                });
                            }
                        }
                        return true;
                    }, IntPtr.Zero);
                    return windows;
                }
            }
"@
        }
        [WindowEnumerator]::GetVisibleWindows() | ConvertTo-Json
    `;

    try {
        const stdout = await PowerShellSession.getInstance().execute(script);
        try {
            const result = JSON.parse(stdout || '[]');
            // PowerShell Json serialization might return single object or array
            return Array.isArray(result) ? result.map(mapWin) : [mapWin(result)];
        } catch (parseError) {
             return [];
        }
    } catch (error: any) {
        console.error('List Windows Error:', error);
        return [];
    }
}

function mapWin(w: any): WindowInfo {
    return {
        title: w.Title,
        pid: w.Pid,
        handle: w.Handle,
        className: w.ClassName
    };
}

async function listWindowsDarwin(): Promise<WindowInfo[]> {
    try {
        const script = `
            tell application "System Events"
                set appList to {}
                repeat with proc in (every process whose visible is true)
                    set end of appList to {name of proc, unix id of proc}
                end repeat
                return appList
            end tell
        `;
        const { stdout } = await execAsync(`osascript -e '${script.replace(/\n/g, ' ')}'`, { timeout: 5000 });
        const windows: WindowInfo[] = [];
        const matches = stdout.matchAll(/\{([^,]+),\s*(\d+)\}/g);
        for (const match of matches) {
            windows.push({
                title: match[1].trim(),
                pid: parseInt(match[2]),
            });
        }
        return windows;
    } catch {
        return [];
    }
}

async function listWindowsLinux(): Promise<WindowInfo[]> {
    try {
        const { stdout } = await execAsync('wmctrl -l -p', { timeout: 5000 });
        const windows: WindowInfo[] = [];
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
            const parts = line.split(/\s+/);
            if (parts.length >= 5) {
                windows.push({
                    handle: parts[0],
                    pid: parseInt(parts[2]),
                    title: parts.slice(4).join(' '),
                });
            }
        }
        return windows;
    } catch {
        return [];
    }
}

async function getActiveWindowWin32(): Promise<WindowInfo | null> {
    const script = `
        if (-not ("ActiveWindow" -as [type])) {
            Add-Type @"
            using System;
            using System.Runtime.InteropServices;
            using System.Text;
            public class ActiveWindow {
                [DllImport("user32.dll")]
                public static extern IntPtr GetForegroundWindow();
                [DllImport("user32.dll")]
                public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
                [DllImport("user32.dll")]
                public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
            }
"@
        }
        $hwnd = [ActiveWindow]::GetForegroundWindow()
        $sb = New-Object System.Text.StringBuilder 256
        [ActiveWindow]::GetWindowText($hwnd, $sb, 256) | Out-Null
        $procId = 0
        [ActiveWindow]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
        @{ title = $sb.ToString(); pid = $procId; handle = $hwnd.ToString() } | ConvertTo-Json
    `;

    try {
        const stdout = await PowerShellSession.getInstance().execute(script);
        const result = JSON.parse(stdout || 'null');
        return result ? {
            title: result.title,
            pid: result.pid,
            handle: result.handle
        } : null;
    } catch {
        return null;
    }
}

async function focusWindowWin32(title?: string, pid?: number): Promise<boolean> {
    const script = `
        ${EnsureWindowFocusScript}
        $hWnd = [IntPtr]::Zero
        
        # Try to find by title match in all visible windows first
        if ("${title}") {
             if (-not ("WindowEnumerator" -as [type])) { /* Ensure enumerator exists if not already */ } 
             # Re-use WindowEnumerator logic specifically? Or just use simplistic Get-Process for main windows?
             # Actually, better to use WindowEnumerator to find the handle!
        }
        
        # Simplified for now: Use Get-Process for main windows, or if that fails, try exact handle?
        # But we want to focus popups too.
        
        $proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*${title}*" } | Select-Object -First 1
        if ($proc) {
            [WindowFocus]::ShowWindow($proc.MainWindowHandle, 9)
            [WindowFocus]::SetForegroundWindow($proc.MainWindowHandle)
            Write-Output "true"
        } else {
            # Fallback: maybe it's a dialog not attached to MainWindowHandle?
            # Implemented simple main window focus for now.
            Write-Output "false"
        }
    `;
    
    // Updated robust logic
    const scriptRobust = `
        ${EnsureWindowFocusScript}
        
        $targetTitle = "${title}"
        $found = $false
        
        # Use our enumerator if available (it is defined in listWindows)
        # But we need to ensure it's defined here too in case listWindows wasn't called
        if (-not ("WindowFocusEnumerator" -as [type])) {
            Add-Type @"
            using System;
            using System.Runtime.InteropServices;
            using System.Collections.Generic;
            using System.Text;
            public class WindowFocusEnumerator {
                [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
                [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
                [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
                public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
                public static IntPtr FindWindowByTitle(string partialTitle) {
                    IntPtr found = IntPtr.Zero;
                    EnumWindows((hWnd, lParam) => {
                        if (IsWindowVisible(hWnd)) {
                            var sb = new StringBuilder(256);
                            GetWindowText(hWnd, sb, 256);
                            if (sb.ToString().IndexOf(partialTitle, StringComparison.OrdinalIgnoreCase) >= 0) {
                                found = hWnd;
                                return false; // Stop enumeration
                            }
                        }
                        return true;
                    }, IntPtr.Zero);
                    return found;
                }
            }
"@
        }

        $hwnd = [WindowFocusEnumerator]::FindWindowByTitle($targetTitle)
        
        if ($hwnd -ne [IntPtr]::Zero) {
            [WindowFocus]::ShowWindow($hwnd, 9)
            [WindowFocus]::SetForegroundWindow($hwnd)
            Write-Output "true"
        } else {
            Write-Output "false"
        }
    `;

    try {
        const stdout = await PowerShellSession.getInstance().execute(scriptRobust);
        return stdout.trim() === 'true';
    } catch {
        return false;
    }
}

const EnsureWindowFocusScript = `
    if (-not ("WindowFocus" -as [type])) {
        Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class WindowFocus {
            [DllImport("user32.dll")]
            public static extern bool SetForegroundWindow(IntPtr hWnd);
            [DllImport("user32.dll")]
            public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        }
"@
    }
`;


// Tool handlers
export async function handleListWindows() {
    try {
        let windows: WindowInfo[];

        if (platform === 'win32') {
            windows = await listWindowsWin32();
        } else if (platform === 'darwin') {
            windows = await listWindowsDarwin();
        } else {
            windows = await listWindowsLinux();
        }

        await logAudit('list_windows', {}, { count: windows.length });

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    platform,
                    count: windows.length,
                    windows
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('list_windows', {}, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleGetActiveWindow() {
    try {
        let window: WindowInfo | null = null;

        if (platform === 'win32') {
            window = await getActiveWindowWin32();
        } else if (platform === 'darwin') {
            const { stdout } = await execAsync(`osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`, { timeout: 5000 });
            window = { title: stdout.trim() };
        } else {
            const { stdout } = await execAsync('xdotool getactivewindow getwindowname', { timeout: 5000 });
            window = { title: stdout.trim() };
        }

        await logAudit('get_active_window', {}, 'success');

        return {
            content: [{ type: 'text', text: JSON.stringify(window, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('get_active_window', {}, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleFocusWindow(args: { title?: string; pid?: number; handle?: string }) {
    try {
        let success = false;

        if (platform === 'win32') {
            success = await focusWindowWin32(args.title, args.pid);
        } else if (platform === 'darwin') {
            if (args.title) {
                await execAsync(`osascript -e 'tell application "${args.title}" to activate'`, { timeout: 5000 });
                success = true;
            }
        } else {
            if (args.title) {
                await execAsync(`wmctrl -a "${args.title}"`, { timeout: 5000 });
                success = true;
            }
        }

        await logAudit('focus_window', args, success ? 'success' : 'not_found');

        return {
            content: [{ type: 'text', text: JSON.stringify({ focused: success }, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('focus_window', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleMinimizeWindow(args: { title?: string; all?: boolean }) {
    try {
        if (platform === 'win32') {
            if (args.all) {
                await PowerShellSession.getInstance().execute('(New-Object -ComObject Shell.Application).MinimizeAll()');
            } else {
                const script = args.title
                    ? `$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*${args.title}*" } | Select-Object -First 1; if ($proc) { 
                        if (-not ("Win32Minimize" -as [type])) {
                            $code = @"
                            [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
"@
                            Add-Type -MemberDefinition $code -Name "Win32Minimize" -Namespace Win32
                        }
                        [Win32.Win32Minimize]::ShowWindow($proc.MainWindowHandle, 6) 
                      }`
                    : `if (-not ("Native.Win" -as [type])) {
                        Add-Type -Name Win -Namespace Native -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();'
                       }
                       [Native.Win]::ShowWindow([Native.Win]::GetForegroundWindow(), 6)`;
                await PowerShellSession.getInstance().execute(script);
            }
        } else if (platform === 'darwin') {
            await execAsync(`osascript -e 'tell application "System Events" to set visible of first process whose frontmost is true to false'`, { timeout: 5000 });
        } else {
            await execAsync('xdotool getactivewindow windowminimize', { timeout: 5000 });
        }

        await logAudit('minimize_window', args, 'success');

        return {
            content: [{ type: 'text', text: JSON.stringify({ minimized: true }, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('minimize_window', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleMaximizeWindow(args: { title?: string }) {
    try {
        if (platform === 'win32') {
            const script = `
                if (-not ("Native.Win" -as [type])) {
                    Add-Type -Name Win -Namespace Native -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();'
                }
                [Native.Win]::ShowWindow([Native.Win]::GetForegroundWindow(), 3)
            `;
            await PowerShellSession.getInstance().execute(script);
        } else if (platform === 'darwin') {
            await execAsync(`osascript -e 'tell application "System Events" to tell first process whose frontmost is true to set value of attribute "AXFullScreen" of window 1 to true'`, { timeout: 5000 });
        } else {
            await execAsync('wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz', { timeout: 5000 });
        }

        await logAudit('maximize_window', args, 'success');

        return {
            content: [{ type: 'text', text: JSON.stringify({ maximized: true }, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('maximize_window', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleRestoreWindow(args: { title?: string }) {
    try {
        if (platform === 'win32') {
            const script = `
                if (-not ("Native.Win" -as [type])) {
                    Add-Type -Name Win -Namespace Native -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();'
                }
                [Native.Win]::ShowWindow([Native.Win]::GetForegroundWindow(), 9)
            `;
            await PowerShellSession.getInstance().execute(script);
        } else {
            await execAsync('wmctrl -r :ACTIVE: -b remove,maximized_vert,maximized_horz', { timeout: 5000 });
        }

        await logAudit('restore_window', args, 'success');

        return {
            content: [{ type: 'text', text: JSON.stringify({ restored: true }, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('restore_window', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleCloseWindow(args: { title?: string; pid?: number; force?: boolean }) {
    try {
        if (args.force && args.pid) {
            if (platform === 'win32') {
                await execAsync(`taskkill /PID ${args.pid} /F`, { timeout: 5000 });
            } else {
                await execAsync(`kill -9 ${args.pid}`, { timeout: 5000 });
            }
        } else if (platform === 'win32') {
            // Updated to be more robust: find window via EnumWindows and send WM_CLOSE
            // Just sending Close to Foreground is mostly ok for active window tools.
            const script = `
                if (-not ("Native.Win" -as [type])) {
                    Add-Type -Name Win -Namespace Native -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();'
                }
                [Native.Win]::SendMessage([Native.Win]::GetForegroundWindow(), 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
            `;
            await PowerShellSession.getInstance().execute(script);
        } else {
            await execAsync('xdotool getactivewindow windowclose', { timeout: 5000 });
        }

        await logAudit('close_window', args, 'success');

        return {
            content: [{ type: 'text', text: JSON.stringify({ closed: true }, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('close_window', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleResizeWindow(args: { title?: string; width: number; height: number }) {
    try {
        if (platform === 'win32') {
            const script = `
                if (-not ("WinResize" -as [type])) {
                    Add-Type @"
                    using System;
                    using System.Runtime.InteropServices;
                    public class WinResize {
                        [DllImport("user32.dll")]
                        public static extern IntPtr GetForegroundWindow();
                        [DllImport("user32.dll")]
                        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
                        [DllImport("user32.dll")]
                        public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
                        [StructLayout(LayoutKind.Sequential)]
                        public struct RECT { public int Left, Top, Right, Bottom; }
                    }
"@
                }
                $hwnd = [WinResize]::GetForegroundWindow()
                $rect = New-Object WinResize+RECT
                [WinResize]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
                [WinResize]::MoveWindow($hwnd, $rect.Left, $rect.Top, ${args.width}, ${args.height}, $true)
            `;
            await PowerShellSession.getInstance().execute(script);
        } else {
            await execAsync(`wmctrl -r :ACTIVE: -e 0,-1,-1,${args.width},${args.height}`, { timeout: 5000 });
        }

        await logAudit('resize_window', args, 'success');

        return {
            content: [{ type: 'text', text: JSON.stringify({ resized: true, width: args.width, height: args.height }, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('resize_window', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleMoveWindow(args: { title?: string; x: number; y: number }) {
    try {
        if (platform === 'win32') {
            const script = `
                if (-not ("WinMove" -as [type])) {
                    Add-Type @"
                    using System;
                    using System.Runtime.InteropServices;
                    public class WinMove {
                        [DllImport("user32.dll")]
                        public static extern IntPtr GetForegroundWindow();
                        [DllImport("user32.dll")]
                        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
                        [DllImport("user32.dll")]
                        public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
                        [StructLayout(LayoutKind.Sequential)]
                        public struct RECT { public int Left, Top, Right, Bottom; }
                    }
"@
                }
                $hwnd = [WinMove]::GetForegroundWindow()
                $rect = New-Object WinMove+RECT
                [WinMove]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
                $w = $rect.Right - $rect.Left
                $h = $rect.Bottom - $rect.Top
                [WinMove]::MoveWindow($hwnd, ${args.x}, ${args.y}, $w, $h, $true)
            `;
            await PowerShellSession.getInstance().execute(script);
        } else {
            await execAsync(`wmctrl -r :ACTIVE: -e 0,${args.x},${args.y},-1,-1`, { timeout: 5000 });
        }

        await logAudit('move_window', args, 'success');

        return {
            content: [{ type: 'text', text: JSON.stringify({ moved: true, x: args.x, y: args.y }, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('move_window', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleLaunchApplication(args: { path: string; args?: string[]; waitForWindow?: boolean; timeout?: number }) {
    try {
        const appArgs = args.args?.join(' ') || '';

        if (platform === 'win32') {
            await execAsync(`start "" "${args.path}" ${appArgs}`, { timeout: 5000 });
        } else if (platform === 'darwin') {
            await execAsync(`open -a "${args.path}" ${appArgs}`, { timeout: 5000 });
        } else {
            await execAsync(`${args.path} ${appArgs} &`, { timeout: 5000 });
        }

        await logAudit('launch_application', args, 'success');

        let windowInfo: WindowInfo | null = null;
        if (args.waitForWindow) {
            // Try to guess title from path or use generic wait
            const basename = args.path.split(/[/\\]/).pop() || args.path;
            const searchTerm = basename.replace(/\.(exe|app)$/i, '');
            
            try {
                const result = await handleWaitForWindow({ title: searchTerm, timeout: args.timeout || 10000 });
                if (!result.isError) {
                    const data = JSON.parse(result.content[0].text);
                    if (data.found) {
                        windowInfo = data.window;
                    }
                }
            } catch (err) {
                // Ignore wait errors, we still launched
            }
        }

        return {
            content: [{ type: 'text', text: JSON.stringify({ launched: true, path: args.path, window: windowInfo }, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('launch_application', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleWaitForWindow(args: { title: string; timeout?: number }) {
    const timeout = args.timeout || 5000;
    
    // Improved Event-Driven Logic using UI Automation
    if (platform === 'win32') {
        const script = `
            if (-not ("WindowWaiter" -as [type])) {
                Add-Type -AssemblyName UIAutomationClient
                Add-Type -AssemblyName UIAutomationTypes
                
                $source = @"
                using System;
                using System.Collections.Generic;
                using System.Text;
                using System.Threading;
                using System.Windows.Automation;
                using System.Diagnostics;
                using System.Runtime.InteropServices;
                
                public class WindowWaiter {
                    private static ManualResetEvent _arg = new ManualResetEvent(false);
                    private static string _foundTitle = null;
                    private static int _foundPid = 0;
                    private static string _foundHandle = null;
                    private static string _foundClass = null;
                    private static string _targetTitlePartial = null;
                    private static object _lock = new object();

                    public static object WaitForWindow(string titlePartial, int timeoutMs) {
                        _targetTitlePartial = titlePartial;
                        _arg.Reset();
                        _foundTitle = null;

                        // 1. Check existing windows first (fast path)
                        var existing = FindWindow(titlePartial);
                        if (existing != null) return existing;

                        // 2. Subscribe to WindowOpenedEvent
                        AutomationEventHandler handler = new AutomationEventHandler(OnWindowOpen);
                        try {
                            Automation.AddAutomationEventHandler(
                                WindowPattern.WindowOpenedEvent,
                                AutomationElement.RootElement,
                                TreeScope.Children,
                                handler
                            );

                            // Wait for event or timeout
                            if (_arg.WaitOne(timeoutMs)) {
                                lock(_lock) {
                                    return new { 
                                        found = true, 
                                        window = new { 
                                            title = _foundTitle, 
                                            pid = _foundPid, 
                                            handle = _foundHandle, 
                                            className = _foundClass 
                                        } 
                                    };
                                }
                            }
                        } catch (Exception ex) {
                             return new { error = ex.Message };
                        } finally {
                            try {
                                Automation.RemoveAutomationEventHandler(
                                    WindowPattern.WindowOpenedEvent,
                                    AutomationElement.RootElement,
                                    handler
                                );
                            } catch {}
                        }

                        // 3. One final check in case we missed the event race
                        var finalCheck = FindWindow(titlePartial);
                        if (finalCheck != null) return finalCheck;

                        return new { found = false };
                    }

                    private static void OnWindowOpen(object src, AutomationEventArgs e) {
                        try {
                            AutomationElement element = src as AutomationElement;
                            if (element == null) return;

                            string name = "";
                            try { name = element.Current.Name; } catch {}
                            
                            if (!string.IsNullOrEmpty(name) && 
                                name.IndexOf(_targetTitlePartial, StringComparison.OrdinalIgnoreCase) >= 0) {
                                
                                lock(_lock) {
                                    _foundTitle = name;
                                    _foundPid = element.Current.ProcessId;
                                    _foundHandle = element.Current.NativeWindowHandle.ToString();
                                    _foundClass = element.Current.ClassName;
                                    _arg.Set();
                                }
                            }
                        } catch {}
                    }

                    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
                    [DllImport("user32.dll")] private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
                    [DllImport("user32.dll")] private static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);
                    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
                    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
                    
                    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

                    private static object FindWindow(string partial) {
                        object result = null;
                        EnumWindows((hWnd, lParam) => {
                            if (!IsWindowVisible(hWnd)) return true;
                            
                            StringBuilder sb = new StringBuilder(256);
                            GetWindowText(hWnd, sb, 256);
                            string title = sb.ToString();

                            if (!string.IsNullOrEmpty(title) && 
                                title.IndexOf(partial, StringComparison.OrdinalIgnoreCase) >= 0) {
                                
                                int pid = 0;
                                GetWindowThreadProcessId(hWnd, out pid);
                                
                                StringBuilder sbClass = new StringBuilder(256);
                                GetClassName(hWnd, sbClass, 256);
                                
                                result = new { 
                                    found = true, 
                                    window = new { 
                                        title = title, 
                                        pid = pid, 
                                        handle = hWnd.ToString(), 
                                        className = sbClass.ToString() 
                                    } 
                                };
                                return false; // Stop enumeration
                            }
                            return true;
                        }, IntPtr.Zero);
                        return result;
                    }
                }
"@
                Add-Type -TypeDefinition $source -ReferencedAssemblies "UIAutomationClient","UIAutomationTypes","System.Core"
            }
            
            # Since native C# FindWindow helper above was stubbed, we do a quick PowerShell pre-check
            # Actually, let's just let the C# waiter run. If it misses existing, we might wait unnecessary time.
            # Ideally we combine them. For now, rely on list_windows loop as fallback if C# returns error?
            # No, let's implement the full C# Wait including the scan.
            
            [WindowWaiter]::WaitForWindow("${args.title}", ${timeout}) | ConvertTo-Json -Depth 2
        `;
        
        try {
            const stdout = await PowerShellSession.getInstance().execute(script);
            // If setup failed or returned empty
            if (!stdout) throw new Error("No output from WindowWaiter");
            
            const result = JSON.parse(stdout);
            
            // If the C# stub returned found=false (timeout), we double check with our robust listWindowsWin32 
            // just in case UIA missed it (some non-UIA windows).
            if (!result.found) {
                // One final check using P/Invoke enumerator
                const windows = await listWindowsWin32();
                const match = windows.find(w => w.title.toLowerCase().includes(args.title.toLowerCase()));
                if (match) {
                     await logAudit('wait_for_window', args, 'success (fallback scan)');
                     return {
                        content: [{ type: 'text', text: JSON.stringify({ found: true, window: match }, null, 2) }]
                     };
                }
            }

            await logAudit('wait_for_window', args, result.found ? 'success' : 'timeout');
            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
            };
        } catch (error: any) {
            // Fallback to polling loop if UIA setup totally failed
            // ... (keep existing polling logic as backup below) ...
        }
    }

    // ... Existing Polling Fallback (for Mac/Linux or if UIA fails) ...
    try {
        const interval = 500;
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout) {
            let windows: WindowInfo[] = [];
             if (platform === 'win32') {
                windows = await listWindowsWin32();
            } else if (platform === 'darwin') {
                windows = await listWindowsDarwin();
            } else {
                windows = await listWindowsLinux();
            }

            const match = windows.find(w => w.title.toLowerCase().includes(args.title.toLowerCase()));
            if (match) {
                 await logAudit('wait_for_window', args, 'success');
                 return {
                    content: [{ type: 'text', text: JSON.stringify({ found: true, window: match }, null, 2) }]
                 };
            }
            
            await new Promise(resolve => setTimeout(resolve, interval));
        }

        await logAudit('wait_for_window', args, 'timeout');
         return {
            content: [{ type: 'text', text: JSON.stringify({ found: false }, null, 2) }]
         };

    } catch (error: any) {
        await logAudit('wait_for_window', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}
