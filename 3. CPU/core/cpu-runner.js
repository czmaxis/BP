/**
 * Sdílený běhový orchestrátor a logger pro Kategorii 3: CPU-náročné úlohy (03-cpu).
 *
 * Zajišťuje:
 * 1. Zahřívací fázi (Warmup = 50 cyklů) pro stabilizaci JIT kompilátorů (V8 TurboFan / JSC FTL).
 * 2. Reset deterministického stavu před měřenou fází (N = 30 iterací), aby byly kontrolní
 *    součty (checksum) 100% reprodukovatelné a bitově shodné napříč Node.js, Deno a Bun.
 * 3. Eliminaci Observer Effectu: mutace vstupu (prepareIteration) i čtení RSS paměti
 *    probíhají striktně mimo měřené časové okno `performance.now()`.
 * 4. Kontrolu platnosti kontrolního součtu (`if (globalChecksum === 0) throw new Error(...)`)
 *    a uložení surových i agregovaných výsledků do `results/cpu_raw_<runtime>.json` a `results/cpu_summary_<runtime>.json`.
 */

import path from "node:path";
import {
  createCryptoHashScenario,
  createJsonTransformScenario,
  createMatrixMultiplyScenario,
} from "./cpu-workloads.js";
import { exportBenchmarkResults, loadConfig } from "./fs-helper.js";
import { getEnvironmentMetadata, getRssBytes } from "./runtime.js";
import {
  buildCpuScenarioSummary,
  computeCpuIterationMetrics,
  getBlackholeChecksum,
  resetBlackholeChecksum,
} from "./stats.js";

/**
 * Vypíše formátovanou hlavičku sekce do konzole.
 *
 * @param {string} title
 */
export function logSection(title) {
  const line = "═".repeat(72);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(`${line}`);
}

/**
 * Vypíše informační zprávu s časovým razítkem.
 *
 * @param {string} message
 */
export function logInfo(message) {
  const now = new Date().toISOString().slice(11, 23);
  console.log(`[${now}] ${message}`);
}

/**
 * Vypíše průběh iterace (Warmup nebo Měření).
 */
export function logCpuIteration(phase, current, total, metrics) {
  const indexStr = `${String(current).padStart(2, " ")}/${String(total).padStart(2, " ")}`;
  const tag = phase === "WARMUP" ? "WARMUP" : "MĚŘENÍ";
  const hexChecksum = `0x${(metrics.checksum >>> 0).toString(16).padStart(8, "0")}`;
  console.log(
    `  [${tag} ${indexStr}] ` +
      `Doba: ${metrics.durationMs.toFixed(2).padStart(8, " ")} ms | ` +
      `Výkon: ${metrics.opsPerSec.toFixed(2).padStart(7, " ")} op/s | ` +
      `Checksum: ${hexChecksum} | ` +
      `RSS po: ${metrics.rssAfterMB.toFixed(1)} MB`,
  );
}

/**
 * Vypíše přehlednou souhrnnou tabulku statistik pro daný CPU scénář do konzole.
 */
export function logCpuScenarioSummary(scenarioTitle, summary) {
  const hexChecksum = `0x${(summary.checksum >>> 0).toString(16).padStart(8, "0")}`;
  console.log(
    `\n  Souhrnné výsledky – ${scenarioTitle} (N = ${summary.iterations}, Checksum = ${hexChecksum}):`,
  );
  console.log(
    "  ──────────────────────────────────────────────────────────────────────",
  );

  const formatRow = (label, stats, unit) =>
    `  ${label.padEnd(20, " ")} | ` +
    `p50: ${String(stats.p50.toFixed(2)).padStart(9, " ")} ${unit} | ` +
    `IQR: ${String(stats.iqr.toFixed(2)).padStart(7, " ")} ${unit} | ` +
    `p95: ${String(stats.p95.toFixed(2)).padStart(9, " ")} ${unit} | ` +
    `p99: ${String(stats.p99.toFixed(2)).padStart(9, " ")} ${unit} | ` +
    `Ø: ${String(stats.mean.toFixed(2)).padStart(8, " ")} ± ${String(stats.stdDev.toFixed(2)).padStart(6, " ")} ${unit}`;

  console.log(formatRow("Doba výpočtu", summary.metrics.durationMs, "ms  "));
  console.log(formatRow("Operace za sekundu", summary.metrics.opsPerSec, "op/s"));
  console.log(formatRow("Paměť RSS (po)", summary.metrics.rssAfterMB, "MB  "));
  console.log(formatRow("Paměť RSS (špička)", summary.metrics.rssPeakMB, "MB  "));
  console.log(
    "  ──────────────────────────────────────────────────────────────────────",
  );
}

/**
 * Spustí kompletní životní cyklus jednoho CPU scénáře:
 * Setup -> Warmup (50 iterací) -> Reset Seed State -> Měřené iterace (N = 30).
 */
export async function executeCpuScenario(scenario, warmupCount, iterationCount) {
  logSection(scenario.name);
  logInfo(`Popis: ${scenario.description}`);
  logInfo(
    `Zahřívací fáze (Warmup): ${warmupCount} cyklů | Měřené iterace: N = ${iterationCount}`,
  );

  await scenario.setup();

  // 1. Zahřívací fáze (Warmup) – kompilace hot paths v JIT (V8 TurboFan / JSC FTL), výsledky se zahazují
  const logWarmupStep = Math.max(1, Math.floor(warmupCount / 5));
  for (let w = 1; w <= warmupCount; w++) {
    scenario.prepareIteration(w);
    const rssBeforeBytes = getRssBytes();
    const t0 = performance.now();
    const warmupChecksum = await scenario.runIteration(w);
    const t1 = performance.now();
    const rssAfterBytes = getRssBytes();

    if (w === 1 || w === warmupCount || w % logWarmupStep === 0) {
      const warmupMetrics = computeCpuIterationMetrics({
        iterationIndex: w,
        durationMs: t1 - t0,
        checksum: warmupChecksum,
        rssBeforeBytes,
        rssAfterBytes,
      });
      logCpuIteration("WARMUP", w, warmupCount, warmupMetrics);
    }
  }

  // Stabilizační pauza (100 ms) a deterministický reset dat před měřenou fází
  await new Promise((resolve) => setTimeout(resolve, 100));
  await scenario.setup();

  console.log(
    "  ----------------------------------------------------------------------",
  );

  // 2. Měřená fáze (N nezávislých iterací se 100% deterministickou mutací vstupu)
  const rawResults = [];
  let scenarioChecksum = 0;

  for (let i = 1; i <= iterationCount; i++) {
    // Mutace vstupu striktně mimo měřený čas performance.now()
    scenario.prepareIteration(i);

    const rssBeforeBytes = getRssBytes();
    const t0 = performance.now();
    const iterChecksum = await scenario.runIteration(i);
    const t1 = performance.now();
    const rssAfterBytes = getRssBytes();

    if (!Number.isInteger(iterChecksum) || iterChecksum === 0) {
      throw new Error(
        `Neplatný kontrolní součet (checksum=${iterChecksum}) ve scénáři "${scenario.id}" (iterace ${i}).`,
      );
    }

    scenarioChecksum = (Math.imul(scenarioChecksum, 31) + iterChecksum) | 0;
    if (scenarioChecksum === 0) {
      scenarioChecksum = iterChecksum;
    }

    const metrics = computeCpuIterationMetrics({
      iterationIndex: i,
      durationMs: t1 - t0,
      checksum: iterChecksum,
      rssBeforeBytes,
      rssAfterBytes,
    });

    rawResults.push(metrics);
    logCpuIteration("RUN", i, iterationCount, metrics);
  }

  if (scenarioChecksum === 0) {
    throw new Error(`Invalid checksum: výsledný kontrolní součet scénáře ${scenario.id} je 0.`);
  }

  const summary = buildCpuScenarioSummary(
    scenario,
    rawResults,
    warmupCount,
    scenarioChecksum,
  );
  logCpuScenarioSummary(scenario.name, summary);

  return {
    scenarioChecksum,
    raw: {
      scenarioId: scenario.id,
      name: scenario.name,
      config: scenario.config,
      warmupIterations: warmupCount,
      measuredIterations: iterationCount,
      checksum: scenarioChecksum,
      checksumHex: `0x${(scenarioChecksum >>> 0).toString(16).padStart(8, "0")}`,
      iterations: rawResults,
    },
    summary: {
      ...summary,
      checksumHex: `0x${(scenarioChecksum >>> 0).toString(16).padStart(8, "0")}`,
    },
  };
}

/**
 * Hlavní běhový orchestrátor pro kategorii 03-cpu (Node.js, Deno, Bun).
 */
export async function runCpuBenchmarkSuite({
  projectRoot = process.cwd(),
} = {}) {
  const config = await loadConfig(projectRoot);
  const environment = getEnvironmentMetadata();
  const resultsDir = path.resolve(projectRoot, config.resultsDir);

  logSection(
    `BENCHMARK KATEGORIE 3: CPU-NÁROČNÉ ÚLOHY (${environment.runtime.toUpperCase()} ${environment.version})`,
  );
  logInfo(
    `Platforma: ${environment.platform} (${environment.arch}) | CPU: ${environment.cpuModel} (${environment.cpuCores} jader) | RAM: ${environment.totalMemoryMB} MB`,
  );
  logInfo(
    `Konfigurace: Warmup = ${config.benchmark.warmupIterations}, Iterace N = ${config.benchmark.measuredIterations}`,
  );

  resetBlackholeChecksum(0x20260301);

  const scenarios = [];
  if (config.scenarios.cryptoHash?.enabled) {
    scenarios.push(createCryptoHashScenario(config.scenarios.cryptoHash));
  }
  if (config.scenarios.jsonTransform?.enabled) {
    scenarios.push(createJsonTransformScenario(config.scenarios.jsonTransform));
  }
  if (config.scenarios.matrixMultiply?.enabled) {
    scenarios.push(
      createMatrixMultiplyScenario(config.scenarios.matrixMultiply),
    );
  }

  const allRawScenarios = {};
  const allSummaryScenarios = {};
  let globalChecksum = 0;

  for (let sIdx = 0; sIdx < scenarios.length; sIdx++) {
    const scenario = scenarios[sIdx];
    const { raw, summary, scenarioChecksum } = await executeCpuScenario(
      scenario,
      config.benchmark.warmupIterations,
      config.benchmark.measuredIterations,
    );

    allRawScenarios[scenario.id] = raw;
    allSummaryScenarios[scenario.id] = summary;
    globalChecksum = (Math.imul(globalChecksum, 31) + scenarioChecksum) | 0;

    if (sIdx < scenarios.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  const blackholeState = getBlackholeChecksum();
  if (globalChecksum === 0 || blackholeState === 0) {
    throw new Error("Invalid checksum: globální kontrolní součet je 0.");
  }

  const globalChecksumMeta = {
    value: globalChecksum,
    hex: `0x${(globalChecksum >>> 0).toString(16).padStart(8, "0")}`,
    blackholeAccumulator: blackholeState,
  };

  const { savedRawPath, savedSummaryPath } = await exportBenchmarkResults({
    resultsDir,
    category: config.category,
    environment,
    benchmarkConfig: config.benchmark,
    globalChecksum: globalChecksumMeta,
    allRawScenarios,
    allSummaryScenarios,
    filePrefix: "cpu",
  });

  logSection(`CPU BENCHMARK ${environment.runtime.toUpperCase()} DOKONČEN`);
  logInfo(
    `Globální kontrolní součet (Checksum): ${globalChecksumMeta.hex} (${globalChecksumMeta.value})`,
  );
  logInfo(
    `Surová data (N = ${config.benchmark.measuredIterations}) uložena do: ${savedRawPath}`,
  );
  logInfo(
    `Agregované statistiky (p50, IQR, p95, p99, Ø, σ) uloženy do: ${savedSummaryPath}`,
  );
}
