/**
 * Matematické a statistické funkce:
 * převody jednotek, zaokrouhlování, výpočet percentilů (p50, p95, p99),
 * směrodatné odchylky a agregace metrik iterací a scénářů.
 */

/**
 * Globální volatilní akumulátor (Blackhole) zabraňující JIT kompilátoru
 * (V8 TurboFan / JavaScriptCore DFG/FTL) odstranit čtení bufferů nebo výpočty
 * v rámci optimalizace mrtvého kódu (Dead Code Elimination).
 */
let blackholeAccumulator = 0;

/**
 * Zkonzumuje číselnou hodnotu (např. kontrolní bajt z načteného bufferu nebo výsledek CPU operace)
 * do globálního akumulátoru, takže JIT nemůže operaci vyhodnotit jako mrtvý kód.
 *
 * @param {number} value
 * @returns {number} Aktuální stav akumulátoru
 */
export function consumeBlackhole(value) {
  blackholeAccumulator =
    (Math.imul(blackholeAccumulator, 31) + (value | 0)) | 0;
  return blackholeAccumulator;
}

/**
 * Vrátí aktuální hodnotu Blackhole akumulátoru.
 *
 * @returns {number}
 */
export function getBlackholeChecksum() {
  return blackholeAccumulator;
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
 * Pokud je `lowerIsBetter = false` (např. u propustnosti MB/s nebo op/s, kde vyšší hodnota znamená lepší výkon),
 * počítají se percentily p95 a p99 ze sestupně seřazeného pole (od nejlepšího po nejhorší běh),
 * takže p95 a p99 vždy konzistentně vyjadřují tail výkon (hodnotu dosaženou v 95 %, resp. 99 % běhů)
 * a matematicky odpovídají p95 a p99 latenci.
 *
 * Pokud je `useHarmonicMean = true` (pro rychlostní metriky MB/s a op/s s konstantním objemem práce na iteraci),
 * počítá se průměr (`mean` i `trimmedMean`) jako harmonický průměr (dle Jensenovy nerovnosti),
 * aby exaktně platil fyzikální vztah: Průměrná rychlost = Objem práce / Průměrný čas.
 *
 * @param {number[]} values Pole naměřených hodnot
 * @param {number} [decimals=3] Počet desetinných míst pro zaokrouhlení
 * @param {{ lowerIsBetter?: boolean, useHarmonicMean?: boolean }} [options] Nastavení směru a typu střední hodnoty
 * @returns {{ count: number, mean: number, trimmedMean: number, stdDev: number, cvPercent: number, iqr: number, outliersCount: number, min: number, p50: number, p95: number, p99: number, max: number }}
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

  // Výběrová směrodatná odchylka (sample standard deviation, N - 1)
  // Pro harmonický průměr (R = D / T) se směrodatná odchylka šíří dle delta metody:
  // sigma_H = H^2 * sigma_(1/x) = H * CV(T), takže je centrovaná kolem H a má shodný CV jako čas T.
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

  // Mezikvartilové rozpětí (IQR = Q3 - Q1) a detekce odlehlých hodnot (Tukey 1.5 * IQR)
  const q1 = calculatePercentile(sortedAsc, 25);
  const q3 = calculatePercentile(sortedAsc, 75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const outliersCount =
    iqr > 0
      ? sortedAsc.filter((v) => v < lowerFence || v > upperFence).length
      : 0;

  // 10% oříznutý průměr (Trimmed Mean) odolný vůči extrémním špičkám
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
  const cleanWriteMs = round(writeMs, 3);
  const cleanReadMs = round(readMs, 3);
  const cleanTotalMs = round(cleanWriteMs + cleanReadMs, 3);

  const writeSec = writeMs / 1000;
  const readSec = readMs / 1000;
  const totalSec = (writeMs + readMs) / 1000;

  const rssPeakBytes = Math.max(
    rssBeforeBytes,
    rssAfterWriteBytes,
    rssAfterBytes,
  );

  return {
    iteration: iterationIndex,
    ...(fileCount > 1 ? { fileCount } : {}),
    bytesProcessed,
    writeMs: cleanWriteMs,
    readMs: cleanReadMs,
    totalMs: cleanTotalMs,
    writeThroughputMBps: round(totalSizeMB / writeSec, 3),
    readThroughputMBps: round(totalSizeMB / readSec, 3),
    totalThroughputMBps: round((totalSizeMB * 2) / totalSec, 3),
    writeOpsPerSec: round(fileCount / writeSec, opsDecimals),
    readOpsPerSec: round(fileCount / readSec, opsDecimals),
    totalOpsPerSec: round((fileCount * 2) / totalSec, opsDecimals),
    rssBeforeBytes,
    rssAfterWriteBytes,
    rssAfterBytes,
    rssPeakBytes,
    rssBeforeMB: round(bytesToMB(rssBeforeBytes), 3),
    rssAfterWriteMB: round(bytesToMB(rssAfterWriteBytes), 3),
    rssAfterMB: round(bytesToMB(rssAfterBytes), 3),
    rssPeakMB: round(bytesToMB(rssPeakBytes), 3),
    rssDeltaMB: round(bytesToMB(rssAfterBytes - rssBeforeBytes), 3),
  };
}

/**
 * Spočítá souhrnné statistiky (p50, p95, p99, průměr, směrodatnou odchylku, IQR, min, max)
 * pro všechny klíčové metriky ze surových výsledků jednotlivých iterací.
 */
export function buildScenarioSummary(
  scenario,
  rawIterations,
  warmupIterations,
) {
  const metricDefs = [
    { key: "writeMs", lowerIsBetter: true, useHarmonicMean: false },
    { key: "readMs", lowerIsBetter: true, useHarmonicMean: false },
    { key: "totalMs", lowerIsBetter: true, useHarmonicMean: false },
    { key: "writeThroughputMBps", lowerIsBetter: false, useHarmonicMean: true },
    { key: "readThroughputMBps", lowerIsBetter: false, useHarmonicMean: true },
    { key: "totalThroughputMBps", lowerIsBetter: false, useHarmonicMean: true },
    { key: "writeOpsPerSec", lowerIsBetter: false, useHarmonicMean: true },
    { key: "readOpsPerSec", lowerIsBetter: false, useHarmonicMean: true },
    { key: "totalOpsPerSec", lowerIsBetter: false, useHarmonicMean: true },
    { key: "rssBeforeMB", lowerIsBetter: true, useHarmonicMean: false },
    { key: "rssAfterWriteMB", lowerIsBetter: true, useHarmonicMean: false },
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
    metrics: metricsSummary,
  };
}
