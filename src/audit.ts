import { getDb } from './storage/db.js';

export async function logAudit(tool: string, args: any, result: any, error?: any) {
    try {
        const db = await getDb();
        await db.run(
            `INSERT INTO audit_log (tool, args, result, error) VALUES (?, ?, ?, ?)`,
            tool,
            JSON.stringify(args),
            result ? JSON.stringify(result) : null,
            error ? JSON.stringify(error) : null
        );
    } catch {
        // Silent fail - can't log a logging failure (avoid recursion)
    }
}
