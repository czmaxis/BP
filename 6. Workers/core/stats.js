/**
 * Matematické a statistické funkce pro Kategorii 6: Paralelní zpracování (06-workers).
 * Zahrnuje Blackhole akumulátor proti Dead Code Elimination (DCE), výpočet percentilů,
 * mezikvartilového rozpětí (IQR), harmonického průměru pro Ops/s a MB/s a směrodatné odchylky.
 */

let blackholeAccumulator = 0;

/**
 * Zkonzumuje číselnou hodnotu do globálního akumulátoru,
 * takže JIT kompilátor (V8 TurboFan / JSC FTL) nemůže operaci vyhodnotit jako mrtvý kód.
 *
 * @param {number} value
 * @returns {number}
 */
export function consumeBlackhole(value) {
  blackholeAccumulator =
    (Math.imul(blackholeAccumulator, 31) + (value | 0)) | 0;
  if (blackholeAccumulator === 0) {
    blackholeAccumulator = 0x5a5a5a5a;
  }
  return blackholeAccumulator;
}

/**
 * Vrátí aktuální hodnotu globálního Blackhole akumulátoru.
 *
 * @returns {number}
 */
export function getBlackholeChecksum() {
  return blackholeAccumulator;
}

/**
 * Resetuje globální Blackhole akumulátor.
 *
 * @param {number} [seed=0]
 */
export function resetBlackholeChecksum(seed = 0) {
  blackholeAccumulator = seed | 0;
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
 * @param {ArrayLike<number>} sortedValues Seřazené pole hodnot (vzestupně)
 * @param {number} percentile Hledaný percentil (0 až 100, např. 50, 95, 99)
 * @returns {number}
 */
export function calculatePercentile(sortedValues, percentile) {
  const len = sortedValues.length;
  if (len === 0) return 0;
  if (len === 1) return sortedValues[0];

  const index = (percentile / 100) * (len - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (upper >= len) {
    return sortedValues[len - 1];
  }
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

/**
 * Vypočítá kompletní popisnou statistiku pro pole naměřených hodnot.
 */
export function calculateStats(
  values,
  decimals = 3,
  { lowerIsBetter = true, useHarmonicMean = false } = {},
) {
  const count = values.length;
  if (count === 0) {
    return {
      count: 0,
      mean: 0,
      arithmeticMean: 0,
      harmonicMean: 0,
      trimmedMean: 0,
      stdDev: 0,
      cvPercent: 0,
      iqr: 0,
      outliersCount: 0,
      min: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      max: 0,
    };
  }

  const sortedAsc = [...values].sort((a, b) => a - b);
  const orderedForTail = lowerIsBetter ? sortedAsc : [...sortedAsc].reverse();
  const allPositive = sortedAsc.every((v) => v > 0);

  const calcArithmeticMean = (arr) =>
    arr.length > 0 ? arr.reduce((acc, val) => acc + val, 0) / arr.length : 0;

  const calcHarmonicMean = (arr) => {
    if (arr.length === 0 || !arr.every((v) => v > 0)) return 0;
    const reciprocalSum = arr.reduce((acc, val) => acc + 1 / val, 0);
    return arr.length / reciprocalSum;
  };

  const computeAverage = (arr) =>
    useHarmonicMean && allPositive
      ? calcHarmonicMean(arr)
      : calcArithmeticMean(arr);

  const arithmeticMean = calcArithmeticMean(sortedAsc);
  const harmonicMean = allPositive
    ? calcHarmonicMean(sortedAsc)
    : arithmeticMean;
  const mean = computeAverage(sortedAsc);

  let stdDev = 0;
  if (count > 1) {
    if (useHarmonicMean && allPositive) {
      const reciprocals = sortedAsc.map((v) => 1 / v);
      const meanRecip = 1 / harmonicMean;
      const varRecip =
        reciprocals.reduce((acc, r) => acc + (r - meanRecip) ** 2, 0) /
        (count - 1);
      stdDev = harmonicMean ** 2 * Math.sqrt(varRecip);
    } else {
      const variance =
        sortedAsc.reduce((acc, val) => acc + (val - arithmeticMean) ** 2, 0) /
        (count - 1);
      stdDev = Math.sqrt(variance);
    }
  }
  const cvPercent = mean !== 0 ? (stdDev / Math.abs(mean)) * 100 : 0;

  const q1 = calculatePercentile(sortedAsc, 25);
  const q3 = calculatePercentile(sortedAsc, 75);
  const iqr = q3 - q1;

  const outlierSample =
    useHarmonicMean && allPositive
      ? [...sortedAsc.map((v) => 1 / v)].sort((a, b) => a - b)
      : sortedAsc;
  const oq1 = calculatePercentile(outlierSample, 25);
  const oq3 = calculatePercentile(outlierSample, 75);
  const oiqr = oq3 - oq1;
  const lowerFence = oq1 - 1.5 * oiqr;
  const upperFence = oq3 + 1.5 * oiqr;
  const outliersCount =
    oiqr > 0
      ? outlierSample.filter((v) => v < lowerFence || v > upperFence).length
      : 0;

  const trimCount = Math.floor(count * 0.1);
  const trimmedSlice =
    trimCount > 0 ? sortedAsc.slice(trimCount, count - trimCount) : sortedAsc;
  const trimmedMean = computeAverage(trimmedSlice);

  return {
    count,
    mean: round(mean, decimals),
    arithmeticMean: round(arithmeticMean, decimals),
    harmonicMean: round(harmonicMean, decimals),
    trimmedMean: round(trimmedMean, decimals),
    stdDev: round(stdDev, decimals),
    cvPercent: round(cvPercent, 2),
    iqr: round(iqr, decimals),
    outliersCount,
    min: round(sortedAsc[0], decimals),
    p50: round(calculatePercentile(orderedForTail, 50), decimals),
    p95: round(calculatePercentile(orderedForTail, 95), decimals),
    p99: round(calculatePercentile(orderedForTail, 99), decimals),
    max: round(sortedAsc[count - 1], decimals),
  };
}

/**
 * Vypočítá standardizovaný objekt metrik pro jednu iteraci Worker benchmarku.
 */
export function computeWorkerIterationMetrics({
  iterationIndex,
  durationMs,
  workerCount,
  bytesProcessed = 0,
  checksum,
  rssBeforeBytes,
  rssAfterBytes,
}) {
  const cleanDurationMs = round(durationMs, 3);
  const durationSec = durationMs / 1000;
  const totalSizeMB = bytesToMB(bytesProcessed);
  const rssPeakBytes = Math.max(rssBeforeBytes, rssAfterBytes);

  return {
    iteration: iterationIndex,
    workerCount,
    bytesProcessed,
    durationMs: cleanDurationMs,
    opsPerSec: round(1 / durationSec, 2),
    throughputMBps:
      bytesProcessed > 0 ? round(totalSizeMB / durationSec, 2) : 0,
    checksum,
    rssBeforeBytes,
    rssAfterBytes,
    rssPeakBytes,
    rssBeforeMB: round(bytesToMB(rssBeforeBytes), 3),
    rssAfterMB: round(bytesToMB(rssAfterBytes), 3),
    rssPeakMB: round(bytesToMB(rssPeakBytes), 3),
    rssDeltaMB: round(bytesToMB(rssAfterBytes - rssBeforeBytes), 3),
  };
}

/**
 * Sestaví souhrnné statistiky z N měřených iterací pro daný Worker scénář.
 */
export function buildWorkerScenarioSummary(
  scenario,
  rawIterations,
  warmupIterations,
  scenarioChecksum,
) {
  const metricDefs = [
    { key: "durationMs", lowerIsBetter: true, useHarmonicMean: false },
    { key: "opsPerSec", lowerIsBetter: false, useHarmonicMean: true },
    { key: "throughputMBps", lowerIsBetter: false, useHarmonicMean: true },
    { key: "rssBeforeMB", lowerIsBetter: true, useHarmonicMean: false },
    { key: "rssAfterMB", lowerIsBetter: true, useHarmonicMean: false },
    { key: "rssPeakMB", lowerIsBetter: true, useHarmonicMean: false },
    { key: "rssDeltaMB", lowerIsBetter: true, useHarmonicMean: false },
  ];

  const metricsSummary = {};
  for (const { key, lowerIsBetter, useHarmonicMean } of metricDefs) {
    const values = rawIterations.map((item) => Number(item[key]));
    metricsSummary[key] = calculateStats(values, 3, {
      lowerIsBetter,
      useHarmonicMean,
    });
  }

  return {
    scenarioId: scenario.id,
    name: scenario.name,
    description: scenario.description,
    config: scenario.config,
    warmupIterations,
    iterations: rawIterations.length,
    checksum: scenarioChecksum,
    metrics: metricsSummary,
  };
}
