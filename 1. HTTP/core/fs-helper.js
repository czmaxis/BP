/**
 * Správa souborového systému, načítání konfigurace (config.json)
 * a export výsledků benchmarku do JSON.
 * Plně kompatibilní s Node.js, Deno i Bun.
 */

import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
 * Bezpečně odstraní soubor nebo adresář včetně obsahu.
 *
 * @param {string} targetPath
 */
export async function removeSafe(targetPath) {
  if (detectRuntime() === "deno") {
    try {
      await globalThis.Deno.remove(targetPath, { recursive: true });
    } catch (err) {
      if (!(err instanceof globalThis.Deno.errors.NotFound)) {
        throw err;
      }
    }
    return;
  }
  await rm(targetPath, { recursive: true, force: true });
}

/**
 * Zajistí existenci adresáře.
 *
 * @param {string} dirPath
 */
export async function ensureDir(dirPath) {
  if (detectRuntime() === "deno") {
    await globalThis.Deno.mkdir(dirPath, { recursive: true });
    return;
  }
  await mkdir(dirPath, { recursive: true });
}

/**
 * Načte konfiguraci z config.json a aplikuje případné CLI přepínače
 * (--quick, --iterations=N, --duration=S, --warmup-duration=S, --connections=C,
 *  --port=P, --endpoint=plaintext|json|echo, --load-tool=auto|autocannon|wrk|builtin).
 *
 * @param {string} [projectRoot=process.cwd()] Kořenový adresář projektu
 */
export async function loadConfig(projectRoot = process.cwd()) {
  const configPath = path.resolve(projectRoot, "config.json");
  const runtime = detectRuntime();

  let raw;
  if (runtime === "deno") {
    raw = await globalThis.Deno.readTextFile(configPath);
  } else if (runtime === "bun") {
    raw = await globalThis.Bun.file(configPath).text();
  } else {
    raw = await readFile(configPath, "utf-8");
  }

  const config = JSON.parse(raw);
  const cliArgs = getCliArgs();

  if (cliArgs.includes("--quick")) {
    if (!cliArgs.some((a) => a.startsWith("--warmup-duration="))) {
      config.http.warmupDurationSec = 1;
    }
    if (!cliArgs.some((a) => a.startsWith("--duration="))) {
      config.http.durationSec = 2;
    }
    if (!cliArgs.some((a) => a.startsWith("--iterations="))) {
      config.http.measuredIterations = 3;
    }
  }

  for (const arg of cliArgs) {
    if (arg.startsWith("--iterations=")) {
      const parsed = Number.parseInt(arg.split("=")[1], 10);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(
          `Neplatná hodnota parametru ${arg}. Počet měřených iterací musí být celé číslo >= 1.`,
        );
      }
      config.http.measuredIterations = parsed;
    } else if (arg.startsWith("--duration=")) {
      const parsed = Number.parseFloat(arg.split("=")[1]);
      if (Number.isNaN(parsed) || parsed <= 0) {
        throw new Error(
          `Neplatná hodnota parametru ${arg}. Doba trvání běhu musí být kladné číslo v sekundách.`,
        );
      }
      config.http.durationSec = parsed;
    } else if (arg.startsWith("--warmup-duration=")) {
      const parsed = Number.parseFloat(arg.split("=")[1]);
      if (Number.isNaN(parsed) || parsed < 0) {
        throw new Error(
          `Neplatná hodnota parametru ${arg}. Doba warmupu musí být nezáporné číslo v sekundách.`,
        );
      }
      config.http.warmupDurationSec = parsed;
    } else if (arg.startsWith("--connections=")) {
      const parsed = Number.parseInt(arg.split("=")[1], 10);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(
          `Neplatná hodnota parametru ${arg}. Počet souběžných spojení musí být celé číslo >= 1.`,
        );
      }
      config.http.connections = parsed;
      config.http.warmupConnections = parsed;
    } else if (arg.startsWith("--port=")) {
      const parsed = Number.parseInt(arg.split("=")[1], 10);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(`Neplatné číslo portu v parametru ${arg}.`);
      }
      config.http.port = parsed;
    } else if (arg.startsWith("--load-tool=")) {
      config.http.loadTool = arg.split("=")[1].toLowerCase();
    } else if (arg.startsWith("--endpoint=") || arg.startsWith("--scenario=")) {
      const ep = arg.split("=")[1].toLowerCase();
      if (!config.http.endpoints[ep]) {
        throw new Error(
          `Neznámý endpoint "${ep}". Povolené hodnoty: plaintext, json, echo.`,
        );
      }
      for (const key of Object.keys(config.http.endpoints)) {
        config.http.endpoints[key].enabled = key === ep;
      }
    }
  }

  return config;
}

/**
 * Uloží objekt dat jako formátovaný JSON soubor do výsledkového adresáře.
 *
 * @param {string} resultsDir Cílový adresář výsledků
 * @param {string} fileName Název výstupního JSON souboru
 * @param {object} data Data k serializaci
 * @returns {Promise<string>} Absolutní cesta k uloženému souboru
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
 * Sestaví a vyexportuje kompletní výsledky benchmarku (raw i summary JSON)
 * pro dané běhové prostředí (Node.js, Deno nebo Bun).
 */
export async function exportBenchmarkResults({
  resultsDir,
  category = "01-http",
  environment,
  benchmarkConfig,
  allRawScenarios,
  allSummaryScenarios,
  filePrefix = "http",
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
