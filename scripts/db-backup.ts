import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "../src/config";

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
const target = join(dirname(config.dbPath), `backup-${stamp}.sqlite`);
mkdirSync(dirname(target), { recursive: true });

const db = new Database(config.dbPath, { readonly: true });
try {
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
} finally {
  db.close();
}
console.log(`Copia de seguridad creada en ${target}`);
