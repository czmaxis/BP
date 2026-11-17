/**
 * Hlavní lokální orchestrátor pro Kategorii 4: Databázové operace (Node.js, Deno, Bun).
 *
 * Postup:
 * 1. Zjistí dostupnost a cesty k binárkám Node.js, Deno a Bun.
 * 2. Sekvenčně (s 1 000ms stabilizační pauzou mezi procesy) spustí SQLite benchmarky pro:
 *    - Node.js (--experimental-sqlite scenarios/04-database/node.mjs)
 *    - Deno (scenarios/04-database/deno.ts)
 *    - Bun (scenarios/04-database/bun.ts)
 * 3. Po dokončení automaticky spustí compare.js, který ověří shodu kontrolních součtů (checksum)
 *    mezi všemi třemi prostředími, vykreslí srovnávací tabulku a uloží results/database_comparison.json.
 *
 * Podporuje předání parametrů:
 *   --warmup=N --iterations=N --scenario=insert|select --quick
 */

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logInfo, logSection } from "./core/db-runner.js";
import { resolveBinary, runExternalCommand } from "./core/process.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  logSection("LOKÁLNÍ ORCHESTRÁTOR – KATEGORIE 4: DATABÁZOVÉ OPERACE (SQLITE)");
  logInfo("Detekuji dostupná běhová prostředí (Node.js, Deno, Bun)...");

  const home = os.homedir();
  const isWin = os.platform() === "win32";

  const nodeBin = process.execPath;
  const denoBin = await resolveBinary("deno", [
    path.join(home, isWin ? ".deno/bin/deno.exe" : ".deno/bin/deno"),
  ]);
  const bunBin = await resolveBinary("bun", [
    path.join(home, isWin ? ".bun/bin/bun.exe" : ".bun/bin/bun"),
  ]);

  logInfo(`Node.js : ${nodeBin}`);
  logInfo(`Deno    : ${denoBin ? denoBin : "NENALEZENO"}`);
  logInfo(`Bun     : ${bunBin ? bunBin : "NENALEZENO"}`);

  if (!denoBin || !bunBin) {
    const missing = [];
    if (!denoBin) missing.push("Deno");
    if (!bunBin) missing.push("Bun");
    throw new Error(
      `Chybí nainstalované prostředí: ${missing.join(", ")}. Nainstalujte je prosím dle dokumentace.`,
    );
  }

  let passthroughArgs = process.argv.slice(2);
  if (passthroughArgs.includes("--quick")) {
    passthroughArgs = passthroughArgs.filter((a) => a !== "--quick");
    if (!passthroughArgs.some((a) => a.startsWith("--warmup="))) {
      passthroughArgs.push("--warmup=2");
    }
    if (!passthroughArgs.some((a) => a.startsWith("--iterations="))) {
      passthroughArgs.push("--iterations=5");
    }
  }

  if (passthroughArgs.length > 0) {
    logInfo(`Předávané parametry: ${passthroughArgs.join(" ")}`);
  }

  // 1. Spuštění Node.js (node:sqlite)
  logSection("1/3 SPUŠTĚNÍ PROSTŘEDÍ: NODE.JS (node:sqlite)");
  await runExternalCommand(
    nodeBin,
    [
      "--experimental-sqlite",
      "--no-warnings",
      path.join(__dirname, "scenarios", "04-database", "node.mjs"),
      ...passthroughArgs,
    ],
    { cwd: __dirname },
  );

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 2. Spuštění Deno (node:sqlite)
  logSection("2/3 SPUŠTĚNÍ PROSTŘEDÍ: DENO (node:sqlite)");
  await runExternalCommand(
    denoBin,
    [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-sys",
      path.join(__dirname, "scenarios", "04-database", "deno.ts"),
      ...passthroughArgs,
    ],
    { cwd: __dirname },
  );

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 3. Spuštění Bun (bun:sqlite)
  logSection("3/3 SPUŠTĚNÍ PROSTŘEDÍ: BUN (bun:sqlite)");
  await runExternalCommand(
    bunBin,
    [
      "run",
      path.join(__dirname, "scenarios", "04-database", "bun.ts"),
      ...passthroughArgs,
    ],
    { cwd: __dirname },
  );

  // 4. Křížové porovnání a verifikace shody kontrolních součtů
  logSection("KŘÍŽOVÉ POROVNÁNÍ VÝSLEDKŮ A KONTROLA CHECKSUMŮ (compare.js)");
  await runExternalCommand(nodeBin, [path.join(__dirname, "compare.js")], {
    cwd: __dirname,
  });
}

main().catch((err) => {
  console.error("\n[CHYBA ORCHESTRÁTORU]:", err.message);
  process.exitCode = 1;
});
