/**
 * Externí spouštěč benchmarku Kategorie 5: Doba spuštění (05-startup)
 * pro jedno vybrané prostředí (--runtime=node|deno|bun, výchozí: node).
 */

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./core/fs-helper.js";
import { resolveBinary } from "./core/process.js";
import { detectRuntime, getCliArgs } from "./core/runtime.js";
import { runStartupBenchmarkForRuntime } from "./core/startup-runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function resolveRuntimeBinary(runtimeKey) {
  const home = os.homedir();
  const isWin = os.platform() === "win32";
  const currentRuntime = detectRuntime();

  if (runtimeKey === "node") {
    return {
      key: "node",
      label: "Node.js",
      binaryPath: currentRuntime === "node" ? process.execPath : (await resolveBinary("node")) || "node",
    };
  }

  if (runtimeKey === "deno") {
    if (currentRuntime === "deno" && typeof globalThis.Deno?.execPath === "function") {
      return {
        key: "deno",
        label: "Deno",
        binaryPath: globalThis.Deno.execPath(),
      };
    }
    const denoBin = await resolveBinary("deno", [
      path.join(home, isWin ? ".deno/bin/deno.exe" : ".deno/bin/deno"),
    ]);
    if (!denoBin) {
      throw new Error("Binárka Deno nebyla nalezena v PATH ani v ~/.deno/bin.");
    }
    return {
      key: "deno",
      label: "Deno",
      binaryPath: denoBin,
    };
  }

  if (runtimeKey === "bun") {
    if (currentRuntime === "bun") {
      return {
        key: "bun",
        label: "Bun",
        binaryPath: process.execPath,
      };
    }
    const bunBin = await resolveBinary("bun", [
      path.join(home, isWin ? ".bun/bin/bun.exe" : ".bun/bin/bun"),
    ]);
    if (!bunBin) {
      throw new Error("Binárka Bun nebyla nalezena v PATH ani v ~/.bun/bin.");
    }
    return {
      key: "bun",
      label: "Bun",
      binaryPath: bunBin,
    };
  }

  throw new Error(
    `Neznámé běhové prostředí "${runtimeKey}". Povolené hodnoty: node, deno, bun.`,
  );
}

async function main() {
  const config = await loadConfig(__dirname);
  const resultsDir = path.resolve(__dirname, config.resultsDir);

  let runtimeKey = detectRuntime();
  for (const arg of getCliArgs()) {
    if (arg.startsWith("--runtime=")) {
      runtimeKey = arg.split("=")[1].toLowerCase();
    }
  }

  const target = await resolveRuntimeBinary(runtimeKey);

  await runStartupBenchmarkForRuntime({
    runtimeKey: target.key,
    runtimeLabel: target.label,
    binaryPath: target.binaryPath,
    config,
    projectRoot: __dirname,
    resultsDir,
  });
}

main().catch((err) => {
  console.error("\n[CHYBA STARTUP BENCHMARKU]:", err.message || err);
  process.exitCode = 1;
});
