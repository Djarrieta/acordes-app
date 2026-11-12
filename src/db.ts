import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config";
import { MIGRATIONS } from "./db/migrations";

function migrate(db: Database): void {
  const row = db.query("PRAGMA user_version").get() as { user_version?: number } | null;
  const current = row?.user_version ?? 0;
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    })();
  }
}

let instance: Database | null = null;

export function openDatabase(path: string = config.dbPath): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

export function setDb(db: Database | null): void {
  instance = db;
}

export function getDb(): Database {
  if (!instance) instance = openDatabase();
  return instance;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

export function transaction<T>(db: Database, fn: () => T): T {
  return db.transaction(fn)();
}
