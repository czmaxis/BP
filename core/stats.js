/**
 * Matematické a statistické funkce:
 * převody jednotek, zaokrouhlování, výpočet percentilů (p50, p95, p99),
 * směrodatné odchylky a agregace metrik iterací a scénářů.
 */

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

  return {
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
}

/**
 * Spočítá souhrnné statistiky (p50, p95, p99, průměr, směrodatnou odchylku, min, max)
 * pro všechny klíčové metriky ze surových výsledků jednotlivých iterací.
 */
export function buildScenarioSummary(
  scenario,
  rawIterations,
  warmupIterations,
) {
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

