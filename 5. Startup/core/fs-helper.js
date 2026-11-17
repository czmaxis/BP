/**
 * Správa souborového systému, načítání konfigurace (config.json)
 * a export výsledků Startup benchmarku do JSON.
 */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectRuntime, getCliArgs } from "./runtime.js";

/**
 * Ověří existenci souboru na disku.
 *
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Načte konfiguraci z config.json a aplikuje případné CLI přepínače
 * (--quick, --warmup=N, --iterations=N, --scenario=minimal|realistic).
 *
 * @param {string} [projectRoot=process.cwd()] Kořenový adresář projektu
 */
export async function loadConfig(projectRoot = process.cwd()) {
  const configPath = path.resolve(projectRoot, "config.json");
  const raw = await readFile(configPath, "utf-8");
  const config = JSON.parse(raw);
  const cliArgs = getCliArgs();

  if (cliArgs.includes("--quick")) {
    if (!cliArgs.some((a) => a.startsWith("--warmup="))) {
      config.benchmark.warmupIterations = 2;
    }
    if (!cliArgs.some((a) => a.startsWith("--iterations="))) {
      config.benchmark.startupIterations = 15;
    }
  }

  for (const arg of cliArgs) {
    if (arg.startsWith("--warmup=")) {
      const parsed = Number.parseInt(arg.split("=")[1], 10);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(
          `Neplatná hodnota parametru ${arg}. Počet warmup cyklů musí být nezáporné celé číslo.`,
        );
      }
      config.benchmark.warmupIterations = parsed;
    } else if (arg.startsWith("--iterations=")) {
      const parsed = Number.parseInt(arg.split("=")[1], 10);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(
          `Neplatná hodnota parametru ${arg}. Počet měřených spuštění musí být celé číslo >= 1.`,
        );
      }
      config.benchmark.startupIterations = parsed;
    } else if (arg.startsWith("--scenario=")) {
      const sc = arg.split("=")[1].toLowerCase();
      if (!config.scenarios[sc]) {
        throw new Error(
          `Neznámý scénář "${sc}". Povolené hodnoty: minimal, realistic.`,
        );
      }
      for (const key of Object.keys(config.scenarios)) {
        config.scenarios[key].enabled = key === sc;
      }
    }
  }

  return config;
}

/**
 * Uloží objekt dat jako formátovaný JSON soubor do výsledkového adresáře.
 */
export async function saveJsonResult(resultsDir, fileName, data) {
  const runtime = detectRuntime();
  const fullPath = path.resolve(resultsDir, fileName);
  const jsonContent = JSON.stringify(data, null, 2);

  if (runtime === "deno") {
    await globalThis.Deno.mkdir(resultsDir, { recursive: true });
    await globalThis.Deno.writeTextFile(fullPath, jsonContent);
  } else if (runtime === "bun") {
    await mkdir(resultsDir, { recursive: true });
    await globalThis.Bun.write(fullPath, jsonContent);
  } else {
    await mkdir(resultsDir, { recursive: true });
    await writeFile(fullPath, jsonContent, "utf-8");
  }

  return fullPath;
}

/**
 * Sestaví a vyexportuje kompletní výsledky Startup benchmarku (raw i summary JSON)
 * pro dané běhové prostředí (Node.js, Deno nebo Bun).
 */
export async function exportBenchmarkResults({
  resultsDir,
  category = "05-startup",
  environment,
  benchmarkConfig,
  allRawScenarios,
  allSummaryScenarios,
  filePrefix = "startup",
}) {
  const runtimeSuffix = environment.runtime;
  const rawFileName = `${filePrefix}_raw_${runtimeSuffix}.json`;
  const summaryFileName = `${filePrefix}_summary_${runtimeSuffix}.json`;

  const rawPayload = {
    category,
    environment,
    benchmarkConfig,
    scenarios: allRawScenarios,
  };

  const summaryPayload = {
    category,
    environment,
    benchmarkConfig,
    scenarios: allSummaryScenarios,
  };

  const savedRawPath = await saveJsonResult(
    resultsDir,
    rawFileName,
    rawPayload,
  );
  const savedSummaryPath = await saveJsonResult(
    resultsDir,
    summaryFileName,
    summaryPayload,
  );

  return { savedRawPath, savedSummaryPath };
}
