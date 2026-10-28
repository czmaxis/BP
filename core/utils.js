import { randomFillSync } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Detekuje název aktuálního běhového prostředí ('node' | 'deno' | 'bun').
 *
 * @returns {'node' | 'deno' | 'bun'}
 */
export function detectRuntime() {
  if (typeof globalThis.Bun !== "undefined") {
    return "bun";
  }
  if (typeof globalThis.Deno !== "undefined") {
    return "deno";
  }
  return "node";
}

/**
 * Vygeneruje binární buffer (Buffer / Uint8Array) naplněný kryptograficky náhodnými bajty.
 * Použití náhodných dat brání optimalizacím souborového systému (sparse files, deduplikace nulových bloků).
 * Volá se před samotným měřením, aby režie RNG neovlivnila měřený čas I/O.
 * Funguje univerzálně v Node.js, Deno i Bun.
 *
 * @param {number} sizeBytes Velikost bufferu v bajtech
 * @returns {Buffer | Uint8Array}
 */
export function generateRandomBuffer(sizeBytes) {
  if (detectRuntime() === "deno" && typeof crypto?.getRandomValues === "function") {
    const buffer = new Uint8Array(sizeBytes);
    const maxQuota = 65536;
    for (let offset = 0; offset < sizeBytes; offset += maxQuota) {
      const length = Math.min(maxQuota, sizeBytes - offset);
      crypto.getRandomValues(buffer.subarray(offset, offset + length));
    }
    return buffer;
  }

  const buffer = Buffer.allocUnsafe(sizeBytes);
  randomFillSync(buffer);
  return buffer;
}

/**
 * Alias pro generateRandomBuffer (pro kompatibilitu s typovanými scénáři v Deno a Bun).
 */
export const generateRandomBytes = generateRandomBuffer;

/**
 * Vrátí aktuální velikost Resident Set Size (RSS) paměti procesu v bajtech
 * napříč prostředími Node.js, Deno a Bun.
 *
 * @returns {number}
 */
export function getRssBytes() {
  if (
    typeof globalThis.Deno !== "undefined" &&
    typeof globalThis.Deno.memoryUsage === "function"
  ) {
    return globalThis.Deno.memoryUsage().rss;
  }
  return process.memoryUsage().rss;
}

/**
 * Převede bajty na megabajty (MiB, děleno 1024 * 1024).
 *
 * @param {number} bytes
 * @returns {number}
 */
export function bytesToMB(bytes) {
  return bytes / (1024 * 1024);
}

/**
 * Zaokrouhlí číslo na daný počet desetinných míst.
 *
 * @param {number} value
 * @param {number} [decimals=3]
 * @returns {number}
 */
export function round(value, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Vypočítá percentil ze seřazeného pole čísel pomocí lineární interpolace.
 *
 * @param {number[]} sortedValues Seřazené pole hodnot (vzestupně)
 * @param {number} percentile Hledaný percentil (0 až 100, např. 50, 95, 99)
 * @returns {number}
 */
export function calculatePercentile(sortedValues, percentile) {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (upper >= sortedValues.length) {
    return sortedValues[sortedValues.length - 1];
  }
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

/**
 * Vypočítá kompletní popisnou statistiku pro pole naměřených hodnot:
 * průměr (mean), směrodatnou odchylku (stdDev), medián (p50), p95, p99, min a max.
 *
 * @param {number[]} values Pole naměřených hodnot
 * @param {number} [decimals=3] Počet desetinných míst pro zaokrouhlení
 * @returns {{ count: number, mean: number, stdDev: number, min: number, p50: number, p95: number, p99: number, max: number }}
 */
export function calculateStats(values, decimals = 3) {
  const count = values.length;
  if (count === 0) {
    return {
      count: 0,
      mean: 0,
      stdDev: 0,
      min: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      max: 0,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const mean = sum / count;

  // Výběrová směrodatná odchylka (sample standard deviation, N - 1)
  const variance =
    count > 1
      ? sorted.reduce((acc, val) => acc + (val - mean) ** 2, 0) / (count - 1)
      : 0;
  const stdDev = Math.sqrt(variance);

  return {
    count,
    mean: round(mean, decimals),
    stdDev: round(stdDev, decimals),
    min: round(sorted[0], decimals),
    p50: round(calculatePercentile(sorted, 50), decimals),
    p95: round(calculatePercentile(sorted, 95), decimals),
    p99: round(calculatePercentile(sorted, 99), decimals),
    max: round(sorted[count - 1], decimals),
  };
}

/**
 * Vypočítá standardizovaný objekt metrik pro jednu iteraci File I/O benchmarku.
 * Sjednocuje výpočet časů, propustnosti (MB/s), IOPS (op/s) a spotřeby paměti (RSS)
 * pro Node.js, Deno i Bun.
 *
 * @param {object} params
 * @param {number} params.iterationIndex Pořadové číslo iterace (1..N)
 * @param {number} params.bytesProcessed Celkový počet zapsaných (a přečtených) bajtů
 * @param {number} [params.fileCount=1] Počet souborů zpracovaných v rámci jedné fáze (1 pro large-file, 1000 pro small-files)
 * @param {number} params.writeMs Doba zápisu v milisekundách
 * @param {number} params.readMs Doba čtení v milisekundách
 * @param {number} params.rssBeforeBytes Hodnota RSS před zápisem v bajtech
 * @param {number} params.rssAfterWriteBytes Hodnota RSS po zápisu v bajtech
 * @param {number} params.rssAfterBytes Hodnota RSS po čtení v bajtech
 * @param {number} [params.opsDecimals=3] Počet desetinných míst pro zaokrouhlení op/s
 */
export function computeIterationMetrics({
  iterationIndex,
  bytesProcessed,
  fileCount = 1,
  writeMs,
  readMs,
  rssBeforeBytes,
  rssAfterWriteBytes,
  rssAfterBytes,
  opsDecimals = 3,
}) {
  const totalSizeMB = bytesToMB(bytesProcessed);
  const totalMs = writeMs + readMs;

  const writeSec = writeMs / 1000;
  const readSec = readMs / 1000;
  const totalSec = totalMs / 1000;

  const result = {
    iteration: iterationIndex,
    ...(fileCount > 1 ? { fileCount } : {}),
    bytesProcessed,
    writeMs: round(writeMs, 3),
    readMs: round(readMs, 3),
    totalMs: round(totalMs, 3),
    writeThroughputMBps: round(totalSizeMB / writeSec, 3),
    readThroughputMBps: round(totalSizeMB / readSec, 3),
    totalThroughputMBps: round((totalSizeMB * 2) / totalSec, 3),
    writeOpsPerSec: round(fileCount / writeSec, opsDecimals),
    readOpsPerSec: round(fileCount / readSec, opsDecimals),
    totalOpsPerSec: round((fileCount * 2) / totalSec, opsDecimals),
    rssBeforeBytes,
    rssAfterWriteBytes,
    rssAfterBytes,
    rssBeforeMB: round(bytesToMB(rssBeforeBytes), 2),
    rssAfterWriteMB: round(bytesToMB(rssAfterWriteBytes), 2),
    rssAfterMB: round(bytesToMB(rssAfterBytes), 2),
    rssDeltaMB: round(bytesToMB(rssAfterBytes - rssBeforeBytes), 2),
  };

  return result;
}

/**
 * Spočítá souhrnné statistiky (p50, p95, p99, průměr, směrodatnou odchylku, min, max)
 * pro všechny klíčové metriky ze surových výsledků jednotlivých iterací.
 *
 * @param {object} scenario Definice scénáře (id, name, description, config)
 * @param {object[]} rawIterations Pole naměřených iterací
 * @param {number} warmupIterations Počet zahřívacích cyklů
 */
export function buildScenarioSummary(scenario, rawIterations, warmupIterations) {
  const metricKeys = [
    "writeMs",
    "readMs",
    "totalMs",
    "writeThroughputMBps",
    "readThroughputMBps",
    "totalThroughputMBps",
    "writeOpsPerSec",
    "readOpsPerSec",
    "totalOpsPerSec",
    "rssBeforeMB",
    "rssAfterWriteMB",
    "rssAfterMB",
    "rssDeltaMB",
  ];

  const metricsSummary = {};
  for (const key of metricKeys) {
    const values = rawIterations.map((item) => Number(item[key]));
    metricsSummary[key] = calculateStats(values, 3);
  }

  return {
    scenarioId: scenario.id,
    name: scenario.name,
    description: scenario.description,
    config: scenario.config,
    warmupIterations,
    iterations: rawIterations.length,
    metrics: metricsSummary,
  };
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
 * Zajistí čistý adresář (smaže existující obsah a znovu jej vytvoří) v Node.js, Deno i Bun.
 *
 * @param {string} dirPath
 */
export async function ensureCleanDir(dirPath) {
  await removeSafe(dirPath);
  if (detectRuntime() === "deno") {
    await globalThis.Deno.mkdir(dirPath, { recursive: true });
    return;
  }
  await mkdir(dirPath, { recursive: true });
}

/**
 * Vrátí pole CLI argumentů předaných skriptu v aktuálním běhovém prostředí (Node.js, Deno, Bun).
 *
 * @returns {string[]}
 */
export function getCliArgs() {
  const runtime = detectRuntime();
  if (runtime === "deno") {
    return globalThis.Deno.args ?? [];
  }
  if (runtime === "bun") {
    return globalThis.Bun.argv.slice(2);
  }
  return process.argv.slice(2);
}

/**
 * Načte konfiguraci z config.json a aplikuje případné CLI přepínače
 * (--warmup=N, --iterations=N, --scenario=large|small) v Node.js, Deno i Bun.
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

  for (const arg of getCliArgs()) {
    if (arg.startsWith("--warmup=")) {
      config.benchmark.warmupIterations = Number.parseInt(
        arg.split("=")[1],
        10,
      );
    } else if (arg.startsWith("--iterations=")) {
      config.benchmark.measuredIterations = Number.parseInt(
        arg.split("=")[1],
        10,
      );
    } else if (arg.startsWith("--scenario=")) {
      const scenario = arg.split("=")[1].toLowerCase();
      if (scenario === "large" || scenario === "large-file") {
        config.scenarios.largeFile.enabled = true;
        config.scenarios.smallFiles.enabled = false;
      } else if (scenario === "small" || scenario === "small-files") {
        config.scenarios.largeFile.enabled = false;
        config.scenarios.smallFiles.enabled = true;
      }
    }
  }

  return config;
}

/**
 * Detekuje aktuální běhové prostředí (Node.js, Deno, Bun) a informace o hardwaru a OS.
 */
export function getEnvironmentMetadata() {
  const runtime = detectRuntime();
  let version = process.version;

  if (runtime === "bun") {
    const rev = globalThis.Bun.revision
      ? ` (${globalThis.Bun.revision.slice(0, 8)})`
      : "";
    version = `v${globalThis.Bun.version}${rev}`;
  } else if (runtime === "deno") {
    const v = globalThis.Deno.version;
    version = `v${v.deno} (V8 ${v.v8}, TS ${v.typescript})`;
  }

  const cpus = os.cpus();
  return {
    runtime,
    version,
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model?.trim() ?? "unknown",
    cpuCores: cpus.length || navigator.hardwareConcurrency || 1,
    totalMemoryMB: round(bytesToMB(os.totalmem()), 0),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Uloží objekt dat jako formátovaný JSON soubor do výsledkového adresáře
 * s využitím nativního zápisu daného běhového prostředí (Node.js, Deno, Bun).
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
 * pro aktuální běhové prostředí (Node.js, Deno nebo Bun).
 *
 * @param {object} params
 * @param {string} params.resultsDir Adresář pro uložení výsledků
 * @param {string} params.category Identifikátor kategorie (např. '02-file-io')
 * @param {object} params.environment Metadata prostředí z getEnvironmentMetadata()
 * @param {object} params.benchmarkConfig Konfigurace benchmarku (warmupIterations, measuredIterations)
 * @param {object} params.allRawScenarios Surová data všech scénářů
 * @param {object} params.allSummaryScenarios Agregované statistiky všech scénářů
 * @param {string} [params.filePrefix='file_io'] Prefix názvu souboru
 * @returns {Promise<{ savedRawPath: string, savedSummaryPath: string }>}
 */
export async function exportBenchmarkResults({
  resultsDir,
  category,
  environment,
  benchmarkConfig,
  allRawScenarios,
  allSummaryScenarios,
  filePrefix = "file_io",
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

  const savedRawPath = await saveJsonResult(resultsDir, rawFileName, rawPayload);
  const savedSummaryPath = await saveJsonResult(
    resultsDir,
    summaryFileName,
    summaryPayload,
  );

  return { savedRawPath, savedSummaryPath };
}
