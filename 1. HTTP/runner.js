/**
 * Spouštěč benchmarku Kategorie 1: Výkon HTTP serveru pro vybrané prostředí
 * (výchozí: Node.js, případně --runtime=node|deno|bun).
 *
 * Server je vždy spuštěn jako samostatný OS podproces a zatěžován z odděleného
 * klientského procesu, aby klient a server nesdílely Event Loop ani Garbage Collector.
 */

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./core/fs-helper.js";
import {
  detectHttpLoadTool,
  runHttpBenchmarkForRuntime,
} from "./core/http-runner.js";
import { resolveBinary } from "./core/process.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function resolveRuntimeTarget(runtimeKey) {
  const home = os.homedir();
  const isWin = os.platform() === "win32";

  if (runtimeKey === "node") {
    return {
      key: "node",
      label: "Node.js",
      command: process.execPath,
      args: [path.join(__dirname, "scenarios", "01-http", "node.mjs")],
    };
  }

  if (runtimeKey === "deno") {
    const denoBin = await resolveBinary("deno", [
      path.join(home, isWin ? ".deno/bin/deno.exe" : ".deno/bin/deno"),
    ]);
    if (!denoBin) {
      throw new Error("Binárka Deno nebyla nalezena v PATH ani v ~/.deno/bin.");
    }
    return {
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
    };
  }

  if (runtimeKey === "bun") {
    const bunBin = await resolveBinary("bun", [
      path.join(home, isWin ? ".bun/bin/bun.exe" : ".bun/bin/bun"),
    ]);
    if (!bunBin) {
      throw new Error("Binárka Bun nebyla nalezena v PATH ani v ~/.bun/bin.");
    }
    return {
      key: "bun",
      label: "Bun",
      command: bunBin,
      args: ["run", path.join(__dirname, "scenarios", "01-http", "bun.ts")],
    };
  }

  throw new Error(
    `Neznámé běhové prostředí "${runtimeKey}". Povolené hodnoty: node, deno, bun.`,
  );
}

async function main() {
  const config = await loadConfig(__dirname);
  const resultsDir = path.resolve(__dirname, config.resultsDir);

  let runtimeKey = "node";
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--runtime=")) {
      runtimeKey = arg.split("=")[1].toLowerCase();
    }
  }

  const runtimeTarget = await resolveRuntimeTarget(runtimeKey);
  const loadTool = await detectHttpLoadTool(config.http.loadTool, __dirname);

  await runHttpBenchmarkForRuntime({
    runtimeTarget,
    httpConfig: config.http,
    loadTool,
    projectRoot: __dirname,
    resultsDir,
  });
}

main().catch((err) => {
  console.error("\n[CHYBA HTTP BENCHMARKU]:", err.message || err);
  process.exitCode = 1;
});
