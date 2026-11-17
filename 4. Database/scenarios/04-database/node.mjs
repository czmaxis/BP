/**
 * Benchmark Kategorie 4: Databázové operace – Nativní implementace pro Node.js (node:sqlite)
 *
 * Využívá vestavěný synchronní C++ SQLite modul `node:sqlite` (`DatabaseSync` z Node.js 22+)
 * bez jakýchkoliv externích knihoven třetích stran.
 *
 * Spuštění:
 *   node --experimental-sqlite --no-warnings scenarios/04-database/node.mjs
 */

import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { runDatabaseBenchmarkSuite } from "../../core/db-runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");

runDatabaseBenchmarkSuite({
  projectRoot,
  driverName: "node:sqlite (DatabaseSync)",
  openDatabase: (dbPath) => new DatabaseSync(dbPath),
}).catch((err) => {
  console.error("\n[CHYBA DATABÁZOVÉHO BENCHMARKU NODE]:", err);
  process.exitCode = 1;
});
