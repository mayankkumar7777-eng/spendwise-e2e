import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { CATEGORIES } from './validation.js';

type Param = string | number | null;

export interface Statement {
  run(...params: Param[]): { changes: number | bigint };
  get(...params: Param[]): unknown;
  all(...params: Param[]): unknown[];
}

// Thin wrapper over the built-in node:sqlite (no native build step); keeps SQL portable to PostgreSQL later.
export interface Db {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  transaction<T>(fn: () => T): () => T;
}

function wrap(raw: DatabaseSync): Db {
  return {
    prepare: (sql) => raw.prepare(sql) as unknown as Statement,
    exec: (sql) => raw.exec(sql),
    transaction: (fn) => () => {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Employee','Manager','Finance')),
  manager_id TEXT REFERENCES users(id),
  password_hash TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS categories (name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES users(id),
  claim_date TEXT NOT NULL,
  category TEXT NOT NULL REFERENCES categories(name),
  amount_paise INTEGER NOT NULL,
  description TEXT NOT NULL,
  receipt_file TEXT,
  receipt_mime TEXT,
  status TEXT NOT NULL CHECK (status IN ('Submitted','Approved','Rejected')),
  decided_by TEXT,
  decided_at TEXT,
  decision_comment TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_dup ON claims (employee_id, claim_date, category, amount_paise);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims (status);
CREATE INDEX IF NOT EXISTS idx_claims_date ON claims (claim_date);
CREATE TABLE IF NOT EXISTS claim_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('created','edited','approved','rejected')),
  actor TEXT NOT NULL,
  at TEXT NOT NULL,
  comment TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_claim ON claim_events (claim_id);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  last_seen_at INTEGER NOT NULL
);
`;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') raw.exec('PRAGMA journal_mode = WAL');
  raw.exec(SCHEMA);
  const db = wrap(raw);
  const insert = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
  for (const name of CATEGORIES) insert.run(name);
  return db;
}
