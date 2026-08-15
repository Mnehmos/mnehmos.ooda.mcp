import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import os from 'os';

/**
 * Initialization script run once per PowerShell session.
 *
 * Declares the process as PER_MONITOR_AWARE_V2. This is CRITICAL for multi-monitor
 * mouse targeting: without this, Windows silently rescales coordinates passed to
 * SetCursorPos/SendInput based on the primary monitor's DPI, causing clicks to
 * land at the wrong pixel on non-primary-DPI monitors.
 *
 * Must be called BEFORE any coordinate-sensitive API. Once a process has queried
 * any DPI-scaled information, the awareness mode is locked in.
 *
 * SetProcessDpiAwarenessContext returns false if awareness was already set
 * (e.g. by a manifest), which is fine — we just log and continue.
 *
 * Value -4 = DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
 */
const DPI_INIT_SCRIPT = `
if (-not ("MCP_DpiInit" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class MCP_DpiInit {
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    public static string TrySetPerMonitorV2() {
        try {
            IntPtr ctx = new IntPtr(-4); // PER_MONITOR_AWARE_V2
            bool ok = SetProcessDpiAwarenessContext(ctx);
            if (ok) return "ok";
            int err = Marshal.GetLastWin32Error();
            // 5 = ERROR_ACCESS_DENIED: already set (e.g. by manifest or earlier call)
            // 87 = ERROR_INVALID_PARAMETER: Windows 10 < 1607; fallback needed
            if (err == 5) return "already-set";
            return "failed:" + err.ToString();
        } catch (EntryPointNotFoundException) {
            return "unsupported-os";
        } catch (Exception ex) {
            return "exception:" + ex.Message;
        }
    }
}
"@
}
$dpiResult = [MCP_DpiInit]::TrySetPerMonitorV2()
# Write to stderr so it doesn't pollute command output, but is visible for debugging.
[Console]::Error.WriteLine("[MCP_DpiInit] " + $dpiResult)
`;

export class PowerShellSession {
    private static defaultInstance: PowerShellSession;

    private process: ChildProcessWithoutNullStreams | null = null;
    private buffer: string = '';
    private currentTask: {
        resolve: (value: string) => void;
        reject: (reason: any) => void;
        token: string;
        errorToken: string;
    } | null = null;
    private isReady: boolean = false;
    private readonly elevated: boolean;

    private constructor(elevated: boolean = false) {
        this.elevated = elevated;
        this.startProcess();
    }

    /**
     * Get the default (non-elevated) PowerShell session singleton.
     * Maintained for backward compatibility with existing call sites.
     */
    public static getInstance(): PowerShellSession {
        if (!PowerShellSession.defaultInstance) {
            PowerShellSession.defaultInstance = new PowerShellSession(false);
        }
        return PowerShellSession.defaultInstance;
    }

    /**
     * Persistent elevated sessions are not supported. Use
     * execElevatedOneShot() for the supported fire-and-forget UAC path.
     */
    public static async getElevatedInstance(): Promise<PowerShellSession | null> {
        return null;
    }

    public isElevated(): boolean {
        return this.elevated;
    }

    private startProcess() {
        if (this.process) {
            this.process.kill();
        }

        const platform = os.platform();

        if (this.elevated && platform === 'win32') {
            // For elevation, we spawn a helper PowerShell that launches a child
            // with -Verb RunAs, then pipes stdio through. This triggers a UAC
            // prompt on first call. We use Start-Process with -PassThru and
            // redirection via temp files isn't ideal; instead we use a simpler
            // approach: launch an already-elevated powershell via runas.
            //
            // The simplest reliable path: use PowerShell's Start-Process -Verb
            // RunAs which hands control to the Windows UAC prompt. The parent
            // process we spawn here is the non-elevated launcher; the actual
            // elevated shell is its child. We use named pipes for IPC.
            //
            // For now, a pragmatic approach: run `powershell.exe -Command "Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile','-NoExit','-Command','...'"` is complex. We use a simpler pattern: the FIRST elevated call triggers a UAC prompt via a wrapper script that relaunches itself elevated, and subsequent interactions go through a named-pipe IPC.
            //
            // Given complexity, we take the conservative path: spawn a
            // powershell.exe with -Verb RunAs via the Start-Process cmdlet,
            // and note that elevation in this MCP currently only supports
            // fire-and-forget elevated commands, not a persistent session.
            // See execElevatedOneShot() below for the supported pattern.
            //
            // Persistent elevated session is a known limitation — documented.
            throw new Error(
                'Persistent elevated PowerShell session not yet implemented. ' +
                'Use execElevatedOneShot() for one-shot elevated commands.'
            );
        }

        // -ExecutionPolicy Bypass: Allow scripts
        // -NoProfile: Faster startup
        // -Command -: Accept commands from stdin
        this.process = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-Command', '-'
        ]);

        this.process.stdout.on('data', (data) => this.handleOutput(data));
        this.process.stderr.on('data', (data) => console.error('PS Stderr:', data.toString()));

        this.process.on('close', (code) => {
            console.error(`PowerShell process exited with code ${code}`);
            this.process = null;
            this.isReady = false;
            // Reject current task if any
            if (this.currentTask) {
                this.currentTask.reject(new Error('PowerShell process crashed'));
                this.currentTask = null;
            }
        });

        this.isReady = true;

        // Fire-and-forget: declare DPI awareness on this process immediately.
        // Any DPI-sensitive API call before this point would lock us into
        // system-aware mode, breaking multi-monitor coordinate handling.
        if (platform === 'win32') {
            this.execute(DPI_INIT_SCRIPT).catch(err => {
                console.error('[PowerShellSession] DPI init failed:', err);
            });
        }
    }

    private handleOutput(data: Buffer) {
        const chunk = data.toString();
        this.buffer += chunk;

        const task = this.currentTask;
        if (task && this.buffer.includes(task.token)) {
            const [output, ...rest] = this.buffer.split(task.token);
            const cleanOutput = output.trim();
            const errorMarker = task.errorToken;
            const errorLine = cleanOutput
                .split(/\r?\n/)
                .find(line => line.startsWith(errorMarker));

            this.buffer = rest.join(task.token);
            this.currentTask = null;

            if (errorLine) {
                task.reject(new Error(errorLine.slice(errorMarker.length).trim()));
            } else {
                task.resolve(cleanOutput);
            }
        }
    }

    public async execute(command: string): Promise<string> {
        if (!this.process || !this.isReady) {
            this.startProcess();
        }

        // Wait for previous task to complete (simple queue)
        while (this.currentTask) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        return new Promise((resolve, reject) => {
            const token = `__EOC_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
            const errorToken = `__ERR_${Date.now()}_${Math.random().toString(36).slice(2)}__`;

            this.currentTask = { resolve, reject, token, errorToken };

            const wrappedCommand = `
                $ErrorActionPreference = 'Stop'
                try {
                    ${command}
                } catch {
                    Write-Output "${errorToken}$($_.Exception.Message -replace '\\r?\\n', ' ')"
                } finally {
                    Write-Output "${token}"
                }
            `;

            this.buffer = '';

            if (this.process && this.process.stdin) {
                this.process.stdin.write(wrappedCommand + '\n');
            } else {
                this.currentTask = null;
                reject(new Error('PowerShell process not ready'));
            }
        });
    }

    /**
     * Execute a single command with administrator privileges via UAC prompt.
     * Fire-and-forget model: does NOT return stdout (elevated child process has
     * its own window). Returns when the elevated process has been launched, not
     * when it completes.
     *
     * Use for actions where you need elevation but don't need to parse output:
     * - registry writes to HKLM
     * - file operations in Program Files
     * - service management
     *
     * For elevated reads or multi-step flows, future work: named-pipe IPC to a
     * persistent elevated helper.
     */
    public static async execElevatedOneShot(command: string, args: string[] = []): Promise<void> {
        if (os.platform() !== 'win32') {
            throw new Error('execElevatedOneShot only supported on Windows');
        }
        const session = PowerShellSession.getInstance();
        const argList = args.map(a => `'${a.replace(/'/g, "''")}'`).join(',');
        const argSuffix = argList ? ` -ArgumentList ${argList}` : '';
        await session.execute(
            `Start-Process -FilePath '${command.replace(/'/g, "''")}'${argSuffix} -Verb RunAs -WindowStyle Hidden`
        );
    }

    public cleanup() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }
}
