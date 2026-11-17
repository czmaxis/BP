/**
 * Hlavní Docker orchestrátor celé benchmarkové sady (Kategorie 01 až 06).
 *
 * Postupně spustí Docker orchestrátory jednotlivých kategorií (1. HTTP až 6. Workers).
 * Podporuje přepínače:
 *   node runner-docker.js
 *   node runner-docker.js --quick
 *   node runner-docker.js --category=06-workers
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUITE_CATEGORIES } from "./runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      else reject(new Error(`Docker orchestrátor v "${cwd}" skončil s kódem ${code}.`));
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

  for (let i = 0; i < selected.length; i++) {
    const cat = selected[i];
    const catDir = path.join(__dirname, cat.dir);
    console.log(`\n${"═".repeat(80)}`);
    console.log(`  [DOCKER ${i + 1}/${selected.length}] ${cat.title} (${cat.dir})`);
    console.log(`${"═".repeat(80)}`);

    await runSubprocess(
      process.execPath,
      [path.join(catDir, "runner-docker.js"), ...passthroughArgs],
      catDir,
    );
  }
}

main().catch((err) => {
  console.error("\n[CHYBA HLAVNÍHO DOCKER ORCHESTRÁTORU]:", err.message);
  process.exitCode = 1;
});
