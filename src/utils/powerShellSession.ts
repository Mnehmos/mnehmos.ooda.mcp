import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';

export class PowerShellSession {
    private static instance: PowerShellSession;
    private process: ChildProcessWithoutNullStreams | null = null;
    private buffer: string = '';
    private currentTask: {
        resolve: (value: string) => void;
        reject: (reason: any) => void;
        token: string;
    } | null = null;
    private isReady: boolean = false;

    private constructor() {
        this.startProcess();
    }

    public static getInstance(): PowerShellSession {
        if (!PowerShellSession.instance) {
            PowerShellSession.instance = new PowerShellSession();
        }
        return PowerShellSession.instance;
    }

    private startProcess() {
        if (this.process) {
            this.process.kill();
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
            console.log(`PowerShell process exited with code ${code}`);
            this.process = null;
            this.isReady = false;
            // Reject current task if any
            if (this.currentTask) {
                this.currentTask.reject(new Error('PowerShell process crashed'));
                this.currentTask = null;
            }
        });

        this.isReady = true;
    }

    private handleOutput(data: Buffer) {
        const chunk = data.toString();
        this.buffer += chunk;

        if (this.currentTask && this.buffer.includes(this.currentTask.token)) {
            const [output, ...rest] = this.buffer.split(this.currentTask.token);
            // Clean output: remove trailing newlines and the token line
            const cleanOutput = output.trim(); // .replace(new RegExp(this.currentTask.token + '.*$'), '').trim();
            
            // Resolve the promise
            this.currentTask.resolve(cleanOutput);
            
            // Reset state
            this.buffer = rest.join(this.currentTask.token); // Keep remainders if any (rare)
            this.currentTask = null;
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
            
            this.currentTask = { resolve, reject, token };
            
            // Important: We wrap the command in a block to ensure robust execution
            // and we echo the token strictly after the command finishes.
            // Using Write-Host or Write-Output for the token.
            const wrappedCommand = `
                $ErrorActionPreference = 'Stop'
                try {
                    ${command}
                } catch {
                    Write-Error $_
                } finally {
                    Write-Output "${token}"
                }
            `;

            // Reset buffer before new command to avoid stale data
            this.buffer = '';
            
            if (this.process && this.process.stdin) {
                // Ensure we write a single line or handle newlines correctly for stdin
                // For stdin mode, sending the command + newline triggers execution
                this.process.stdin.write(wrappedCommand + '\n');
            } else {
                reject(new Error('PowerShell process not ready'));
            }
        });
    }

    public cleanup() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }
}
