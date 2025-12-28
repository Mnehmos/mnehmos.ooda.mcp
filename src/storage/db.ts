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
