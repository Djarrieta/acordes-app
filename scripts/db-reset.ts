import { rmSync } from "node:fs";
import { config } from "../src/config";

for (const path of [config.dbPath, `${config.dbPath}-wal`, `${config.dbPath}-shm`]) {
  rmSync(path, { force: true });
}
console.log(`Base de datos eliminada: ${config.dbPath}`);
