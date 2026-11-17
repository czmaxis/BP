/**
 * Správa souborového systému, generování náhodných binárních dat,
 * načítání konfigurace (config.json) a export výsledků do JSON.
 * Plně kompatibilní s Node.js, Deno i Bun.
 */

import { randomFillSync } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectRuntime, getCliArgs } from "./runtime.js";

/**
 * Vygeneruje binární buffer (Buffer / Uint8Array) naplněný kryptograficky náhodnými bajty.
 * Použití náhodných dat brání optimalizacím souborového systému (sparse files, deduplikace nulových bloků).
 * Volá se před samotným měřením, aby režie RNG neovlivnila měřený čas I/O.
 *
 * @param {number} sizeBytes Velikost bufferu v bajtech
 * @returns {Buffer | Uint8Array}
 */
export function generateRandomBuffer(sizeBytes) {
  if (
    detectRuntime() === "deno" &&
    typeof crypto?.getRandomValues === "function"
  ) {
    const buffer = new Uint8Array(sizeBytes);
    const maxQuota = 65536;
    for (let offset = 0; offset < sizeBytes; offset += maxQuota) {
      const length = Math.min(maxQuota, sizeBytes - offset);
      crypto.getRandomValues(buffer.subarray(offset, offset + length));
    }
    return buffer;
  }

  // Použití Buffer.allocUnsafeSlow zajišťuje samostatný nepoolovaný ArrayBuffer (byteOffset === 0)
  // i pro malé velikosti (< 4 KB), identicky k new Uint8Array(sizeBytes) v Denu.
  const buffer = Buffer.allocUnsafeSlow(sizeBytes);
  randomFillSync(buffer);
  return buffer;
}

/**
 * Alias pro generateRandomBuffer (pro kompatibilitu s typovanými scénáři v Deno a Bun).
 */
export const generateRandomBytes = generateRandomBuffer;

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
 * Zajistí existenci adresáře (vytvoří jej, pokud neexistuje, bez mazání) v Node.js, Deno i Bun.
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
 * Zajistí čistý adresář (smaže existující obsah a znovu jej vytvoří) v Node.js, Deno i Bun.
 *
 * @param {string} dirPath
 */
export async function ensureCleanDir(dirPath) {
  await removeSafe(dirPath);
  await ensureDir(dirPath);
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
      const scenario = arg.split("=")[1].toLowerCase();
      if (scenario === "large" || scenario === "large-file") {
        config.scenarios.largeFile.enabled = true;
        config.scenarios.smallFiles.enabled = false;
      } else if (scenario === "small" || scenario === "small-files") {
        config.scenarios.largeFile.enabled = false;
        config.scenarios.smallFiles.enabled = true;
      } else {
        throw new Error(
          `Neznámý scénář v parametru ${arg}. Povolené hodnoty: large, small.`,
        );
      }
    }
  }

  return config;
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

