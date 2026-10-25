import { randomFillSync } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";

/**
 * Vygeneruje binární Buffer naplněný kryptograficky náhodnými bajty.
 * Použití náhodných dat brání optimalizacím souborového systému (např. sparse files nebo deduplikaci nulových bloků).
 * Volá se před samotným měřením, aby režie RNG neovlivnila měřený čas I/O.
 *
 * @param {number} sizeBytes Velikost bufferu v bajtech
 * @returns {Buffer}
 */
export function generateRandomBuffer(sizeBytes) {
  const buffer = Buffer.allocUnsafe(sizeBytes);
  randomFillSync(buffer);
  return buffer;
}

/**
 * Vrátí aktuální velikost Resident Set Size (RSS) paměti procesu v bajtech.
 *
 * @returns {number}
 */
export function getRssBytes() {
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

  if (upper >= sortedValues.length)
    return sortedValues[sortedValues.length - 1];
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
 * Zajistí čistý adresář (smaže existující obsah a znovu jej vytvoří).
 *
 * @param {string} dirPath
 */
export async function ensureCleanDir(dirPath) {
  await rm(dirPath, { recursive: true, force: true });
  await mkdir(dirPath, { recursive: true });
}

/**
 * Bezpečně odstraní soubor nebo adresář včetně obsahu.
 *
 * @param {string} targetPath
 */
export async function removeSafe(targetPath) {
  await rm(targetPath, { recursive: true, force: true });
}

/**
 * Detekuje aktuální běhové prostředí a informace o hardwaru/OS.
 * Připraveno pro budoucí rozšíření o Deno a Bun.
 */
export function getEnvironmentMetadata() {
  let runtime = "node";
  let version = process.version;

  if (typeof globalThis.Bun !== "undefined") {
    runtime = "bun";
    version = globalThis.Bun.version;
  } else if (typeof globalThis.Deno !== "undefined") {
    runtime = "deno";
    version = globalThis.Deno.version.deno;
  }

  const cpus = os.cpus();
  return {
    runtime,
    version,
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model?.trim() ?? "unknown",
    cpuCores: cpus.length,
    totalMemoryMB: round(bytesToMB(os.totalmem()), 0),
    timestamp: new Date().toISOString(),
  };
}
