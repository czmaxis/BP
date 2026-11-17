/**
 * Hlavní lokální orchestrátor pro Kategorii 1: Výkon HTTP serveru (Node.js, Deno, Bun).
 *
 * Postup:
 * 1. Zjistí dostupnost binárek Node.js, Deno, Bun a zátěžového generátoru (autocannon / wrk / builtin).
 * 2. Sekvenčně pro každé prostředí (Node.js -> Deno -> Bun):
 *    - Spustí příslušný HTTP server jako izolovaný podproces na dedikovaném portu.
 *    - Provede 10s zahřívací fázi (Warmup) a N=10 měřených 30s zátěžových běhů pro:
 *      a) GET /plaintext
 *      b) GET /json
 *      c) POST /echo
 *    - Před a po každém běhu vyčte RSS paměť přes /metrics (mimo měřenou zátěž -> 0% Observer Effect).
 *    - Korektně ukončí proces HTTP serveru (SIGTERM/SIGKILL) a vyčká na uvolnění portu.
 * 3. Po dokončení všech tří prostředí automaticky spustí compare.js pro vykreslení
 *    křížové srovnávací tabulky a uložení results/http_comparison.json.
 *
 * Podporuje přepínače:
 *   --quick --iterations=N --duration=S --warmup-duration=S --connections=C --endpoint=plaintext|json|echo
 */

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./core/fs-helper.js";
import {
  detectHttpLoadTool,
  runHttpBenchmarkForRuntime,
} from "./core/http-runner.js";
import { logInfo, logSection } from "./core/logger.js";
import { resolveBinary, runExternalCommand } from "./core/process.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  logSection("LOKÁLNÍ ORCHESTRÁTOR – KATEGORIE 1: VÝKON HTTP SERVERU");
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
  const loadTool = await detectHttpLoadTool(config.http.loadTool, __dirname);
  logInfo(
    `Zátěžový generátor: ${loadTool.type} (${loadTool.bin}) – běží v odděleném OS procesu`,
  );

  const runtimeTargets = [
    {
      key: "node",
      label: "Node.js",
      command: nodeBin,
      args: [path.join(__dirname, "scenarios", "01-http", "node.mjs")],
    },
    {
      key: "deno",
      label: "Deno",
      command: denoBin,
      args: [
        "run",
        "--allow-net",
        "--allow-env",
        "--allow-read",
        "--allow-sys",
        path.join(__dirname, "scenarios", "01-http", "deno.ts"),
      ],
    },
    {
      key: "bun",
      label: "Bun",
      command: bunBin,
      args: ["run", path.join(__dirname, "scenarios", "01-http", "bun.ts")],
    },
  ];

  const basePort = config.http.port;

  for (let i = 0; i < runtimeTargets.length; i++) {
    const target = runtimeTargets[i];
    logSection(`${i + 1}/3 SPUŠTĚNÍ PROSTŘEDÍ: ${target.label.toUpperCase()}`);

    await runHttpBenchmarkForRuntime({
      runtimeTarget: target,
      httpConfig: {
        ...config.http,
        // Každé prostředí může běžet na stejném portu po uvolnění, nebo posunutém při TIME_WAIT
        port: basePort,
      },
      loadTool,
      projectRoot: __dirname,
      resultsDir,
    });

    if (i < runtimeTargets.length - 1) {
      logInfo("Stabilizační pauza (1 000 ms) před dalším prostředím...");
      await new Promise((resolve) => setTimeout(resolve, 1000));
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
