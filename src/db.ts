import { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config";
import { SCHEMA } from "./db/schema";

// Incrementar al cambiar src/db/schema.ts. No hay retrocompatibilidad: si la
// base existente tiene otra versión (o no tiene versión), se borra y se crea
// de nuevo. Los datos se pueden perder sin problema.
const SCHEMA_VERSION = 1;

function configure(db: Database): void {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
}

function readVersion(db: Database): number {
  const row = db.query("PRAGMA user_version").get() as { user_version?: number } | null;
  return row?.user_version ?? 0;
}

function removeDatabaseFiles(path: string): void {
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    rmSync(file, { force: true });
  }
}

export function openDatabase(path: string = config.dbPath): Database {
  const inMemory = path === ":memory:";
  if (!inMemory) mkdirSync(dirname(path), { recursive: true });

  let db = new Database(path, { create: true });
  configure(db);

  if (!inMemory && readVersion(db) !== SCHEMA_VERSION) {
    db.close();
    removeDatabaseFiles(path);
    db = new Database(path, { create: true });
    configure(db);
  }

  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}

let instance: Database | null = null;

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
