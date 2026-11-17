/**
 * Benchmark Kategorie 4: Databázové operace – Nativní implementace pro Bun (bun:sqlite)
 *
 * Využívá vestavěný nativní SQLite modul `bun:sqlite` (`Database`) implementovaný přímo v Zigu/C.
 *
 * Spuštění:
 *   bun run scenarios/04-database/bun.ts
 */

import { Database } from "bun:sqlite";
import { runDatabaseBenchmarkSuite } from "../../core/db-runner.js";

runDatabaseBenchmarkSuite({
  projectRoot: process.cwd(),
  driverName: "bun:sqlite (Database)",
  openDatabase: (dbPath: string) => new Database(dbPath, { create: true }),
}).catch((err) => {
  console.error("\n[CHYBA DATABÁZOVÉHO BENCHMARKU BUN]:", err);
  process.exit(1);
});
