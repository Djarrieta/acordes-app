import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./songs/songs.schema";

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
  db.exec(SCHEMA_SQL);
  const row = db.query("PRAGMA user_version").get() as { user_version?: number } | null;
  if ((row?.user_version ?? 0) < SCHEMA_VERSION) {
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
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
