import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import fs from 'fs';
import path from 'path';
import { loadConfig, expandHome } from '../config.js';

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
    if (dbInstance) {
        return dbInstance;
    }

    const config = loadConfig();
    const dbPath = expandHome(config.storage.path);

    // Ensure directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    dbInstance = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    // Initialize tables
    await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      tool TEXT NOT NULL,
      args TEXT,
      result TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS kv_store (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (collection, id)
    );
  `);

    return dbInstance;
}

/**
 * Close the singleton database connection. Primarily used in tests to allow
 * Node's test runner to exit cleanly after all tests complete — the sqlite
 * handle keeps the event loop alive otherwise, which suppresses the TAP
 * summary footer and breaks multi-file test chaining.
 *
 * In normal (production) usage the process lifecycle closes this naturally
 * when the MCP server exits.
 */
export async function closeDb(): Promise<void> {
    if (dbInstance) {
        await dbInstance.close();
        dbInstance = null;
    }
}
