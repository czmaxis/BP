import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { runDatabaseBenchmarkSuite } from "./core/db-runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Hlavní spouštěč benchmarku Kategorie 4: Databázové operace pro Node.js (node:sqlite).
 * Spouštějte s přepínačem: node --experimental-sqlite --no-warnings runner.js
 */
runDatabaseBenchmarkSuite({
  projectRoot: __dirname,
  driverName: "node:sqlite (DatabaseSync)",
  openDatabase: (dbPath) => new DatabaseSync(dbPath),
}).catch((err) => {
  console.error("\n[CHYBA DATABÁZOVÉHO BENCHMARKU NODE]:", err);
  process.exitCode = 1;
});
