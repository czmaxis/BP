/**
 * Hlavní zastřešující orchestrátor celé benchmarkové sady (Kategorie 01 až 06).
 *
 * Umožňuje spustit buď kompletní běh všech 6 kategorií za sebou, nebo vybranou kategorii:
 *   node runner.js
 *   node runner.js --quick
 *   node runner.js --category=06-workers
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SUITE_CATEGORIES = [
  { id: "01-http", aliases: ["1", "01", "http", "01-http"], dir: "1. HTTP", title: "Kategorie 1: Výkon HTTP serveru" },
  { id: "02-file-io", aliases: ["2", "02", "file-io", "02-file-io"], dir: "2. File IO", title: "Kategorie 2: Souborové I/O operace" },
  { id: "03-cpu", aliases: ["3", "03", "cpu", "03-cpu"], dir: "3. CPU", title: "Kategorie 3: CPU-náročné úlohy" },
  { id: "04-database", aliases: ["4", "04", "db", "database", "04-database"], dir: "4. Database", title: "Kategorie 4: Databázové operace (SQLite)" },
  { id: "05-startup", aliases: ["5", "05", "startup", "05-startup"], dir: "5. Startup", title: "Kategorie 5: Doba spuštění (Startup time)" },
  { id: "06-workers", aliases: ["6", "06", "workers", "06-workers"], dir: "6. Workers", title: "Kategorie 6: Paralelní zpracování (Worker Threads)" },
];

function runSubprocess(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Proces v "${cwd}" skončil s kódem ${code}.`));
    });
  });
}

async function main() {
  const rawArgs = process.argv.slice(2);
  let categoryFilter = null;
  const passthroughArgs = [];

  for (const arg of rawArgs) {
    if (arg.startsWith("--category=")) {
      categoryFilter = arg.split("=")[1].toLowerCase();
    } else {
      passthroughArgs.push(arg);
    }
  }

  const selected = categoryFilter
    ? SUITE_CATEGORIES.filter((c) => c.aliases.includes(categoryFilter))
    : SUITE_CATEGORIES;

  if (selected.length === 0) {
    throw new Error(
      `Neznámá kategorie "${categoryFilter}". Povolené hodnoty: 01-http, 02-file-io, 03-cpu, 04-database, 05-startup, 06-workers.`,
    );
  }

  console.log("\n╔══════════════════════════════════════════════════════════════════════════════╗");
  console.log("║   HLAVNÍ ORCHESTRÁTOR BENCHMARKOVÉ SADY (NODE.JS vs. DENO vs. BUN)          ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════════╝");
  console.log(`  Počet spouštěných kategorií: ${selected.length} (${selected.map((s) => s.id).join(", ")})`);

  for (let i = 0; i < selected.length; i++) {
    const cat = selected[i];
    const catDir = path.join(__dirname, cat.dir);
    console.log(`\n${"═".repeat(80)}`);
    console.log(`  [${i + 1}/${selected.length}] SPOUŠTÍM: ${cat.title} (${cat.dir})`);
    console.log(`${"═".repeat(80)}`);

    await runSubprocess(
      process.execPath,
      [path.join(catDir, "runner-all.js"), ...passthroughArgs],
      catDir,
    );

    if (i < selected.length - 1) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  console.log(`\n${"═".repeat(80)}`);
  console.log("  SOUHRNNÉ POROVNÁNÍ VŠECH KATEGORIÍ (compare.js)");
  console.log(`${"═".repeat(80)}`);
  await runSubprocess(
    process.execPath,
    [path.join(__dirname, "compare.js"), ...(categoryFilter ? [`--category=${categoryFilter}`] : [])],
    __dirname,
  );
}

main().catch((err) => {
  console.error("\n[CHYBA HLAVNÍHO ORCHESTRÁTORU]:", err.message);
  process.exitCode = 1;
});
