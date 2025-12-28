import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { logAudit } from '../audit.js';

const execAsync = promisify(exec);
const platform = os.platform();

// Schema definitions
export const GetSystemInfoSchema = {};

export const ListProcessesSchema = {
    filter: z.string().optional().describe('Filter processes by name (partial match)'),
    sortBy: z.enum(['cpu', 'memory', 'name', 'pid']).optional().describe('Sort by field'),
    limit: z.number().optional().describe('Limit number of results'),
};

export const KillProcessSchema = {
    pid: z.number().optional().describe('Process ID to kill'),
    name: z.string().optional().describe('Process name to kill (all matching)'),
    force: z.boolean().optional().describe('Force kill'),
};

export const GetEnvironmentSchema = {
    variable: z.string().optional().describe('Specific variable to get (returns all if not specified)'),
};

export const SetEnvironmentSchema = {
    variable: z.string().describe('Variable name'),
    value: z.string().describe('Variable value'),
    persistent: z.boolean().optional().describe('Make persistent (requires admin on Windows)'),
};

export const GetNetworkInfoSchema = {};

export const WaitSchema = {
    ms: z.number().describe('Milliseconds to wait'),
};

export const NotifySchema = {
    title: z.string().describe('Notification title'),
    message: z.string().describe('Notification message'),
    icon: z.string().optional().describe('Path to icon'),
};

// Tool handlers
export async function handleGetSystemInfo() {
    try {
        const cpus = os.cpus();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();

        const info = {
            platform: os.platform(),
            arch: os.arch(),
            release: os.release(),
            hostname: os.hostname(),
            uptime: os.uptime(),
            uptimeHuman: formatUptime(os.uptime()),
            cpu: {
                model: cpus[0]?.model,
                cores: cpus.length,
                speed: cpus[0]?.speed,
            },
            memory: {
                total: totalMem,
                totalHuman: formatBytes(totalMem),
                free: freeMem,
                freeHuman: formatBytes(freeMem),
                used: totalMem - freeMem,
                usedHuman: formatBytes(totalMem - freeMem),
                usagePercent: ((totalMem - freeMem) / totalMem * 100).toFixed(1) + '%',
            },
            user: {
                username: os.userInfo().username,
                homedir: os.homedir(),
                shell: os.userInfo().shell,
            },
            env: {
                PATH: process.env.PATH?.split(path.delimiter).slice(0, 5).join(path.delimiter) + '...',
                NODE_ENV: process.env.NODE_ENV,
            }
        };

        await logAudit('get_system_info', {}, 'success');

        return {
            content: [{ type: 'text', text: JSON.stringify(info, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('get_system_info', {}, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleListProcesses(args: { filter?: string; sortBy?: string; limit?: number }) {
    try {
        let processes: any[] = [];

        if (platform === 'win32') {
            const { stdout } = await execAsync('powershell -Command "Get-Process | Select-Object Id, ProcessName, CPU, WorkingSet64 | ConvertTo-Json"', { timeout: 10000 });
            const parsed = JSON.parse(stdout);
            processes = (Array.isArray(parsed) ? parsed : [parsed]).map((p: any) => ({
                pid: p.Id,
                name: p.ProcessName,
                cpu: p.CPU || 0,
                memory: p.WorkingSet64 || 0,
                memoryHuman: formatBytes(p.WorkingSet64 || 0),
            }));
        } else if (platform === 'darwin') {
            const { stdout } = await execAsync('ps aux', { timeout: 10000 });
            const lines = stdout.trim().split('\n').slice(1);
            processes = lines.map(line => {
                const parts = line.split(/\s+/);
                return {
                    pid: parseInt(parts[1]),
                    name: parts[10] || parts.slice(10).join(' '),
                    cpu: parseFloat(parts[2]),
                    memory: parseFloat(parts[3]),
                };
            });
        } else {
            const { stdout } = await execAsync('ps aux --sort=-pcpu', { timeout: 10000 });
            const lines = stdout.trim().split('\n').slice(1);
            processes = lines.map(line => {
                const parts = line.split(/\s+/);
                return {
                    pid: parseInt(parts[1]),
                    name: parts[10] || parts.slice(10).join(' '),
                    cpu: parseFloat(parts[2]),
                    memory: parseFloat(parts[3]),
                };
            });
        }

        // Filter
        if (args.filter) {
            const filter = args.filter.toLowerCase();
            processes = processes.filter(p => p.name.toLowerCase().includes(filter));
        }

        // Sort
        if (args.sortBy) {
            processes.sort((a, b) => {
                if (args.sortBy === 'cpu') return b.cpu - a.cpu;
                if (args.sortBy === 'memory') return b.memory - a.memory;
                if (args.sortBy === 'name') return a.name.localeCompare(b.name);
                if (args.sortBy === 'pid') return a.pid - b.pid;
                return 0;
            });
        }

        // Limit
        const limit = args.limit || 50;
        processes = processes.slice(0, limit);

        await logAudit('list_processes', args, { count: processes.length });

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    count: processes.length,
                    processes
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('list_processes', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleKillProcess(args: { pid?: number; name?: string; force?: boolean }) {
    try {
        let killed = 0;

        if (args.pid) {
            if (platform === 'win32') {
                await execAsync(`taskkill ${args.force ? '/F ' : ''}/PID ${args.pid}`, { timeout: 5000 });
            } else {
                await execAsync(`kill ${args.force ? '-9 ' : ''}${args.pid}`, { timeout: 5000 });
            }
            killed = 1;
        } else if (args.name) {
            if (platform === 'win32') {
                const { stdout } = await execAsync(`taskkill ${args.force ? '/F ' : ''}/IM "${args.name}*"`, { timeout: 5000 });
                const match = stdout.match(/(\d+) process/);
                killed = match ? parseInt(match[1]) : 1;
            } else {
                await execAsync(`pkill ${args.force ? '-9 ' : ''}"${args.name}"`, { timeout: 5000 });
                killed = 1;
            }
        }

        await logAudit('kill_process', args, { killed });

        return {
            content: [{ type: 'text', text: JSON.stringify({ killed, pid: args.pid, name: args.name }, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('kill_process', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleGetEnvironment(args: { variable?: string }) {
    try {
        let env: Record<string, string | undefined>;

        if (args.variable) {
            env = { [args.variable]: process.env[args.variable] };
        } else {
            // Return a subset of common variables
            const commonVars = ['PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'LANG', 'NODE_ENV', 'TEMP', 'TMP'];
            env = {};
            for (const v of commonVars) {
                if (process.env[v]) {
                    env[v] = process.env[v];
                }
            }
        }

        await logAudit('get_environment', args, 'success');

        return {
            content: [{ type: 'text', text: JSON.stringify(env, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('get_environment', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleSetEnvironment(args: { variable: string; value: string; persistent?: boolean }) {
    try {
        // Set for current process
        process.env[args.variable] = args.value;

        if (args.persistent) {
            if (platform === 'win32') {
                await execAsync(`setx ${args.variable} "${args.value}"`, { timeout: 5000 });
            } else {
                // On Unix, we can't really persist without modifying shell config files
                // Just note that this would need to be added to .bashrc/.zshrc etc.
            }
        }

        await logAudit('set_environment', { variable: args.variable, persistent: args.persistent }, 'success');

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    set: true,
                    variable: args.variable,
                    persistent: args.persistent || false
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('set_environment', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleGetNetworkInfo() {
    try {
        const interfaces = os.networkInterfaces();
        const networks: any[] = [];

        for (const [name, addrs] of Object.entries(interfaces)) {
            if (!addrs) continue;
            for (const addr of addrs) {
                if (!addr.internal) {
                    networks.push({
                        interface: name,
                        family: addr.family,
                        address: addr.address,
                        netmask: addr.netmask,
                        mac: addr.mac,
                    });
                }
            }
        }

        await logAudit('get_network_info', {}, 'success');

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    hostname: os.hostname(),
                    interfaces: networks
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('get_network_info', {}, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleWait(args: { ms: number }) {
    try {
        await new Promise(resolve => setTimeout(resolve, args.ms));

        await logAudit('wait', args, 'success');

        return {
            content: [{ type: 'text', text: JSON.stringify({ waited: true, ms: args.ms }, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('wait', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleNotify(args: { title: string; message: string; icon?: string }) {
    try {
        if (platform === 'win32') {
            const script = `
                [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
                [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
                $template = @"
                <toast>
                    <visual>
                        <binding template="ToastText02">
                            <text id="1">${args.title}</text>
                            <text id="2">${args.message}</text>
                        </binding>
                    </visual>
                </toast>
"@
                $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
                $xml.LoadXml($template)
                $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
                [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("MCP Server").Show($toast)
            `;
            await execAsync(`powershell -Command "${script.replace(/\n/g, ' ')}"`, { timeout: 5000 });
        } else if (platform === 'darwin') {
            await execAsync(`osascript -e 'display notification "${args.message}" with title "${args.title}"'`, { timeout: 5000 });
        } else {
            await execAsync(`notify-send "${args.title}" "${args.message}"`, { timeout: 5000 });
        }

        await logAudit('notify', args, 'success');

        return {
            content: [{ type: 'text', text: JSON.stringify({ notified: true, title: args.title }, null, 2) }],
        };
    } catch (error: any) {
        await logAudit('notify', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

// Utility functions
import path from 'path';

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    return parts.join(' ') || '< 1m';
}
