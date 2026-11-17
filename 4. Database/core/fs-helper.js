/**
 * Správa souborového systému, mazání dočasných SQLite souborů (.sqlite, -wal, -shm),
 * načítání konfigurace (config.json) a export výsledků do JSON.
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
 * Bezpečně odstraní soubor nebo adresář včetně obsahu v Node.js, Deno i Bun.
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
 * Odstraní databázový soubor SQLite včetně jeho žurnálových souborů (-wal a -shm).
 *
 * @param {string} dbFilePath
 */
export async function removeDatabaseFiles(dbFilePath) {
  await removeSafe(dbFilePath);
  await removeSafe(`${dbFilePath}-wal`);
  await removeSafe(`${dbFilePath}-shm`);
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
 * Zajistí čistý adresář (smaže existující obsah a znovu jej vytvoří).
 *
 * @param {string} dirPath
 */
export async function ensureCleanDir(dirPath) {
  await removeSafe(dirPath);
  await ensureDir(dirPath);
}

/**
 * Načte konfiguraci z config.json a aplikuje případné CLI přepínače
 * (--quick, --warmup=N, --iterations=N, --scenario=insert|select).
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
    if (!cliArgs.some((a) => a.startsWith("--warmup="))) {
      config.benchmark.warmupIterations = 2;
    }
    if (!cliArgs.some((a) => a.startsWith("--iterations="))) {
      config.benchmark.measuredIterations = 5;
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
          `Neplatná hodnota parametru ${arg}. Počet měřených iterací musí být celé číslo >= 1.`,
        );
      }
      config.benchmark.measuredIterations = parsed;
    } else if (arg.startsWith("--scenario=")) {
      const sc = arg.split("=")[1].toLowerCase();
      const map = {
        insert: "batchInsert",
        "batch-insert": "batchInsert",
        select: "complexSelect",
        "complex-select": "complexSelect",
      };
      const targetKey = map[sc] || sc;
      if (!config.scenarios[targetKey]) {
        throw new Error(
          `Neznámý scénář "${sc}". Povolené hodnoty: insert, select.`,
        );
      }
      for (const key of Object.keys(config.scenarios)) {
        config.scenarios[key].enabled = key === targetKey;
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
 * Sestaví a vyexportuje kompletní výsledky databázového benchmarku (raw i summary JSON)
 * pro aktuální běhové prostředí (Node.js, Deno nebo Bun).
 */
export async function exportBenchmarkResults({
  resultsDir,
  category = "04-database",
  environment,
  benchmarkConfig,
  globalChecksum,
  allRawScenarios,
  allSummaryScenarios,
  filePrefix = "database",
}) {
  const runtimeSuffix = environment.runtime;
  const rawFileName = `${filePrefix}_raw_${runtimeSuffix}.json`;
  const summaryFileName = `${filePrefix}_summary_${runtimeSuffix}.json`;

  const rawPayload = {
    category,
    environment,
    benchmarkConfig,
    globalChecksum,
    scenarios: allRawScenarios,
  };

  const summaryPayload = {
    category,
    environment,
    benchmarkConfig,
    globalChecksum,
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
