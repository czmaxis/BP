/**
 * Hlavní porovnávací a agregační skript celé benchmarkové sady (Kategorie 01 až 06).
 *
 * Vykreslí porovnávací tabulky všech naměřených kategorií (01-http, 02-file-io, 03-cpu,
 * 04-database, 05-startup, 06-workers) a sloučí všechny výsledkové soubory
 * `*_comparison.json` do jednoho centrálního výstupu `results/master_comparison.json`.
 *
 * Použití:
 *   node compare.js
 *   node compare.js --category=06-workers
 */

import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATEGORIES = [
  {
    id: "01-http",
    aliases: ["1", "01", "http", "01-http"],
    dir: "1. HTTP",
    comparisonFile: "http_comparison.json",
  },
  {
    id: "02-file-io",
    aliases: ["2", "02", "file-io", "02-file-io"],
    dir: "2. File IO",
    comparisonFile: "file_io_comparison.json",
  },
  {
    id: "03-cpu",
    aliases: ["3", "03", "cpu", "03-cpu"],
    dir: "3. CPU",
    comparisonFile: "cpu_comparison.json",
  },
  {
    id: "04-database",
    aliases: ["4", "04", "db", "database", "04-database"],
    dir: "4. Database",
    comparisonFile: "database_comparison.json",
  },
  {
    id: "05-startup",
    aliases: ["5", "05", "startup", "05-startup"],
    dir: "5. Startup",
    comparisonFile: "startup_comparison.json",
  },
  {
    id: "06-workers",
    aliases: ["6", "06", "workers", "06-workers"],
    dir: "6. Workers",
    comparisonFile: "workers_comparison.json",
  },
];

function runCompareScript(catDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(catDir, "compare.js")], {
      cwd: catDir,
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(true);
      else resolve(false);
    });
  });
}

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  let categoryFilter = null;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--category=")) {
      categoryFilter = arg.split("=")[1].toLowerCase();
    }
  }

  const selected = categoryFilter
    ? CATEGORIES.filter((c) => c.aliases.includes(categoryFilter))
    : CATEGORIES;

  const masterComparison = {
    generatedAt: new Date().toISOString(),
    categories: {},
  };

  for (const cat of selected) {
    const catDir = path.join(__dirname, cat.dir);
    const resultsDir = path.join(catDir, "results");
    if (!(await fileExists(resultsDir))) continue;

    await runCompareScript(catDir);

    const compPath = path.join(resultsDir, cat.comparisonFile);
    if (await fileExists(compPath)) {
      const raw = await readFile(compPath, "utf-8");
      masterComparison.categories[cat.id] = JSON.parse(raw);
    }
  }

  const rootResultsDir = path.join(__dirname, "results");
  await mkdir(rootResultsDir, { recursive: true });
  const masterPath = path.join(rootResultsDir, "master_comparison.json");
  await writeFile(masterPath, JSON.stringify(masterComparison, null, 2), "utf-8");
  console.log(`\n  [MASTER INFO] Celkový souhrn všech kategorií uložen do: ${masterPath}\n`);
}

main().catch((err) => {
  console.error("\n[CHYBA POROVNÁNÍ]:", err);
  process.exitCode = 1;
});
