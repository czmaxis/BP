/**
 * Hlavní lokální orchestrátor pro Kategorii 6: Paralelní zpracování / Worker Threads (Node.js, Deno, Bun).
 *
 * Postup:
 * 1. Zjistí dostupnost a cesty k binárkám Node.js, Deno a Bun.
 * 2. Sekvenčně (s 1 000ms stabilizační pauzou mezi procesy) spustí Worker benchmarky pro:
 *    - Node.js (scenarios/06-workers/node.mjs)
 *    - Deno (scenarios/06-workers/deno.ts)
 *    - Bun (scenarios/06-workers/bun.ts)
 * 3. Po dokončení automaticky spustí compare.js, který ověří shodu kontrolních součtů (checksum)
 *    mezi všemi třemi prostředími i mezi Variantou B a C, vykreslí srovnávací tabulku
 *    a uloží results/workers_comparison.json.
 *
 * Podporuje předání parametrů:
 *   --warmup=N --iterations=N --workers=W --scenario=spawn|message|shared --quick
 */

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBinary, runExternalCommand } from "./core/process.js";
import { logInfo, logSection } from "./core/worker-runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  logSection("LOKÁLNÍ ORCHESTRÁTOR – KATEGORIE 6: PARALELNÍ ZPRACOVÁNÍ (WORKERS)");
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

  // 1. Spuštění Node.js (node:worker_threads)
  logSection("1/3 SPUŠTĚNÍ PROSTŘEDÍ: NODE.JS (node:worker_threads)");
  await runExternalCommand(
    nodeBin,
    [path.join(__dirname, "scenarios", "06-workers", "node.mjs"), ...passthroughArgs],
    { cwd: __dirname },
  );

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 2. Spuštění Deno (Web Workers API)
  logSection("2/3 SPUŠTĚNÍ PROSTŘEDÍ: DENO (Web Workers API)");
  await runExternalCommand(
    denoBin,
    [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-sys",
      path.join(__dirname, "scenarios", "06-workers", "deno.ts"),
      ...passthroughArgs,
    ],
    { cwd: __dirname },
  );

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 3. Spuštění Bun (Web Workers API)
  logSection("3/3 SPUŠTĚNÍ PROSTŘEDÍ: BUN (Web Workers API)");
  await runExternalCommand(
    bunBin,
    [
      "run",
      path.join(__dirname, "scenarios", "06-workers", "bun.ts"),
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
