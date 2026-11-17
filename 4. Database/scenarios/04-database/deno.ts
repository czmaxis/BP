/**
 * Benchmark Kategorie 4: Databázové operace – Nativní implementace pro Deno (node:sqlite)
 *
 * Využívá vestavěný nativní SQLite modul `node:sqlite` (`DatabaseSync` implementovaný v Rustu/C v Denu 2.2+)
 * bez externích závislostí.
 *
 * Spuštění:
 *   deno run --allow-read --allow-write --allow-sys scenarios/04-database/deno.ts
 */

import { DatabaseSync } from "node:sqlite";
import { runDatabaseBenchmarkSuite } from "../../core/db-runner.js";

runDatabaseBenchmarkSuite({
  projectRoot: Deno.cwd(),
  driverName: "node:sqlite (Deno native DatabaseSync)",
  openDatabase: (dbPath: string) => new DatabaseSync(dbPath),
}).catch((err) => {
  console.error("\n[CHYBA DATABÁZOVÉHO BENCHMARKU DENO]:", err);
  Deno.exit(1);
});
