/**
 * Hlavní lokální orchestrátor pro Kategorii 5: Doba spuštění (Node.js, Deno, Bun).
 *
 * Postup:
 * 1. Zjistí dostupnost binárek Node.js, Deno a Bun.
 * 2. Sekvenčně změří dobu spuštění (3× warmup + N = 100 měřených studených startů)
 *    pro obě varianty (A: minimal, B: realistic) ve všech třech prostředích.
 * 3. Po dokončení automaticky spustí compare.js pro vykreslení srovnávací tabulky
 *    a uložení results/startup_comparison.json.
 *
 * Podporuje přepínače:
 *   --warmup=N --iterations=N --scenario=minimal|realistic --quick
 */

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./core/fs-helper.js";
import { resolveBinary, runExternalCommand } from "./core/process.js";
import {
  logInfo,
  logSection,
  runStartupBenchmarkForRuntime,
} from "./core/startup-runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  logSection("LOKÁLNÍ ORCHESTRÁTOR – KATEGORIE 5: DOBA SPUŠTĚNÍ (STARTUP TIME)");
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

  const config = await loadConfig(__dirname);
  const resultsDir = path.resolve(__dirname, config.resultsDir);

  const targets = [
    { key: "node", label: "Node.js", binaryPath: nodeBin },
    { key: "deno", label: "Deno", binaryPath: denoBin },
    { key: "bun", label: "Bun", binaryPath: bunBin },
  ];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    logSection(`${i + 1}/3 MĚŘENÍ PROSTŘEDÍ: ${target.label.toUpperCase()}`);

    await runStartupBenchmarkForRuntime({
      runtimeKey: target.key,
      runtimeLabel: target.label,
      binaryPath: target.binaryPath,
      config,
      projectRoot: __dirname,
      resultsDir,
    });

    if (i < targets.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  logSection("KŘÍŽOVÉ POROVNÁNÍ VÝSLEDKŮ (compare.js)");
  await runExternalCommand(nodeBin, [path.join(__dirname, "compare.js")], {
    cwd: __dirname,
  });
}

main().catch((err) => {
  console.error("\n[CHYBA ORCHESTRÁTORU]:", err.message || err);
  process.exitCode = 1;
});
