/**
 * Hlavní lokální orchestrátor pro Kategorii 3: CPU-náročné úlohy (Node.js, Deno, Bun).
 *
 * Postup:
 * 1. Zjistí dostupnost a cesty k binárkám Node.js, Deno a Bun.
 * 2. Sekvenčně (s 1 000ms stabilizační pauzou mezi procesy) spustí CPU benchmarky pro:
 *    - Node.js (scenarios/03-cpu/node.mjs)
 *    - Deno (scenarios/03-cpu/deno.ts)
 *    - Bun (scenarios/03-cpu/bun.ts)
 * 3. Po dokončení automaticky spustí compare.js, který ověří shodu kontrolních součtů (checksum)
 *    mezi všemi třemi prostředími, vykreslí srovnávací tabulku a uloží results/cpu_comparison.json.
 *
 * Podporuje předání parametrů:
 *   --warmup=N --iterations=N --scenario=crypto|json|matrix --quick
 */

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logInfo, logSection } from "./core/cpu-runner.js";
import { resolveBinary, runExternalCommand } from "./core/process.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  logSection("LOKÁLNÍ ORCHESTRÁTOR – KATEGORIE 3: CPU-NÁROČNÉ ÚLOHY");
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
      passthroughArgs.push("--warmup=5");
    }
    if (!passthroughArgs.some((a) => a.startsWith("--iterations="))) {
      passthroughArgs.push("--iterations=5");
    }
  }

  if (passthroughArgs.length > 0) {
    logInfo(`Předávané parametry: ${passthroughArgs.join(" ")}`);
  }

  // 1. Spuštění Node.js
  logSection("1/3 SPUŠTĚNÍ PROSTŘEDÍ: NODE.JS");
  await runExternalCommand(
    nodeBin,
    [path.join(__dirname, "scenarios", "03-cpu", "node.mjs"), ...passthroughArgs],
    { cwd: __dirname },
  );

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 2. Spuštění Deno
  logSection("2/3 SPUŠTĚNÍ PROSTŘEDÍ: DENO");
  await runExternalCommand(
    denoBin,
    [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-sys",
      path.join(__dirname, "scenarios", "03-cpu", "deno.ts"),
      ...passthroughArgs,
    ],
    { cwd: __dirname },
  );

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 3. Spuštění Bun
  logSection("3/3 SPUŠTĚNÍ PROSTŘEDÍ: BUN");
  await runExternalCommand(
    bunBin,
    [
      "run",
      path.join(__dirname, "scenarios", "03-cpu", "bun.ts"),
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
