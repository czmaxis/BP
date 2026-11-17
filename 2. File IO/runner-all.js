/**
 * Hlavní lokální orchestrátor pro spuštění všech 3 prostředí (Node.js, Deno, Bun).
 *
 * Postup:
 * 1. Zjistí dostupnost a cesty k binárkám Node.js, Deno a Bun (s fallbackem na výchozí uživatelské složky ~/.deno/bin a ~/.bun/bin na Windows).
 * 2. Sekvenčně (postupně za sebou) spustí benchmarky pro:
 *    - Node.js (runner.js)
 *    - Deno (scenarios/02-file-io/deno.ts)
 *    - Bun (scenarios/02-file-io/bun.ts)
 * 3. Po dokončení automaticky spustí compare.js pro vykreslení křížové srovnávací tabulky a uložení file_io_comparison.json.
 *
 * Podporuje předání parametrů:
 *   --warmup=N --iterations=N --scenario=large|small --quick
 */

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBinary, runExternalCommand } from "./core/process.js";
import { logInfo, logSection } from "./core/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  logSection("LOKÁLNÍ ORCHESTRÁTOR – KATEGORIE 2: SOUBOROVÉ I/O OPERACE");
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

  // Zpracování předaných CLI argumentů
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

  // 1. Spuštění Node.js
  logSection("1/3 SPUŠTĚNÍ PROSTŘEDÍ: NODE.JS");
  await runExternalCommand(
    nodeBin,
    [path.join(__dirname, "runner.js"), ...passthroughArgs],
    { cwd: __dirname },
  );

  // Stabilizační pauza (1 000 ms) mezi prostředími pro doznění I/O operací a TRIM
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
      path.join(__dirname, "scenarios", "02-file-io", "deno.ts"),
      ...passthroughArgs,
    ],
    { cwd: __dirname },
  );

  // Stabilizační pauza (1 000 ms) mezi prostředími pro doznění I/O operací a TRIM
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 3. Spuštění Bun
  logSection("3/3 SPUŠTĚNÍ PROSTŘEDÍ: BUN");
  await runExternalCommand(
    bunBin,
    [
      "run",
      path.join(__dirname, "scenarios", "02-file-io", "bun.ts"),
      ...passthroughArgs,
    ],
    { cwd: __dirname },
  );

  // 4. Křížové porovnání
  logSection("KŘÍŽOVÉ POROVNÁNÍ VÝSLEDKŮ (compare.js)");
  await runExternalCommand(nodeBin, [path.join(__dirname, "compare.js")], {
    cwd: __dirname,
  });
}

main().catch((err) => {
  console.error("\n[CHYBA ORCHESTRÁTORU]:", err.message);
  process.exitCode = 1;
});
