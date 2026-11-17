/**
 * Sdílený běhový orchestrátor a logger pro Kategorii 6: Paralelní zpracování (06-workers).
 *
 * Zajišťuje:
 * 1. Zahřívací fázi (Warmup = 10 cyklů) pro každou variantu a runtime.
 * 2. Měřenou fázi (N = 30 nezávislých iterací) s měřením `performance.now()` a RSS paměti
 *    výhradně na hranicích iterací.
 * 3. Kontrolu platnosti kontrolního součtu (`checksum`), včetně ověření, že Varianta B
 *    (Structured Clone) a Varianta C (SharedArrayBuffer) produkují bitově shodný výsledek.
 * 4. Export do `results/workers_raw_<runtime>.json` a `results/workers_summary_<runtime>.json`.
 */

import path from "node:path";
import { exportBenchmarkResults, loadConfig } from "./fs-helper.js";
import { getEnvironmentMetadata, getRssBytes } from "./runtime.js";
import {
  buildWorkerScenarioSummary,
  computeWorkerIterationMetrics,
  getBlackholeChecksum,
  resetBlackholeChecksum,
} from "./stats.js";
import {
  createMessagePassingScenario,
  createSharedMemoryScenario,
  createSpawnOverheadScenario,
} from "./worker-workloads.js";

/**
 * Vypíše formátovanou hlavičku do konzole.
 */
export function logSection(title) {
  const line = "═".repeat(72);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(`${line}`);
}

/**
 * Vypíše informační zprávu s časovým razítkem.
 */
export function logInfo(message) {
  const now = new Date().toISOString().slice(11, 23);
  console.log(`[${now}] ${message}`);
}

/**
 * Vypíše průběh iterace Worker benchmarku.
 */
export function logWorkerIteration(phase, current, total, metrics) {
  const indexStr = `${String(current).padStart(2, " ")}/${String(total).padStart(2, " ")}`;
  const tag = phase === "WARMUP" ? "WARMUP" : "MĚŘENÍ";
  const hexChecksum = `0x${(metrics.checksum >>> 0).toString(16).padStart(8, "0")}`;
  const mbpsPart =
    metrics.bytesProcessed > 0
      ? ` | Tok: ${metrics.throughputMBps.toFixed(1).padStart(7, " ")} MB/s`
      : "";

  console.log(
    `  [${tag} ${indexStr}] ` +
      `Doba: ${metrics.durationMs.toFixed(2).padStart(7, " ")} ms | ` +
      `Výkon: ${metrics.opsPerSec.toFixed(2).padStart(7, " ")} op/s` +
      `${mbpsPart} | ` +
      `Checksum: ${hexChecksum} | ` +
      `RSS po: ${metrics.rssAfterMB.toFixed(1)} MB`,
  );
}

/**
 * Vypíše přehlednou souhrnnou tabulku statistik pro daný Worker scénář.
 */
export function logWorkerScenarioSummary(scenarioTitle, summary) {
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

  console.log(formatRow("Doba iterace", summary.metrics.durationMs, "ms  "));
  console.log(formatRow("Operace za sekundu", summary.metrics.opsPerSec, "op/s"));
  if (summary.config.totalBytes > 0) {
    console.log(
      formatRow("Datová propustnost", summary.metrics.throughputMBps, "MB/s"),
    );
  }
  console.log(formatRow("Paměť RSS (po)", summary.metrics.rssAfterMB, "MB  "));
  console.log(formatRow("Paměť RSS (špička)", summary.metrics.rssPeakMB, "MB  "));
  console.log(
    "  ──────────────────────────────────────────────────────────────────────",
  );
}

/**
 * Spustí životní cyklus jednoho Worker scénáře (Setup -> Warmup -> Měřené iterace -> Cleanup).
 */
export async function executeWorkerScenario(
  scenario,
  warmupCount,
  iterationCount,
  workerCount,
) {
  logSection(scenario.name);
  logInfo(`Popis: ${scenario.description}`);
  logInfo(
    `Zahřívací fáze (Warmup): ${warmupCount} cyklů | Měřené iterace: N = ${iterationCount} | Vlákna: W = ${workerCount}`,
  );

  await scenario.setup();

  try {
    // 1. Zahřívací fáze (Warmup) – výsledky se zahazují
    for (let w = 1; w <= warmupCount; w++) {
      scenario.prepareIteration(w);
      const rssBeforeBytes = getRssBytes();
      const t0 = performance.now();
      const res = await scenario.runIteration(w);
      const t1 = performance.now();
      const rssAfterBytes = getRssBytes();

      const warmupMetrics = computeWorkerIterationMetrics({
        iterationIndex: w,
        durationMs: t1 - t0,
        workerCount,
        bytesProcessed: res.bytesProcessed,
        checksum: res.checksum,
        rssBeforeBytes,
        rssAfterBytes,
      });
      logWorkerIteration("WARMUP", w, warmupCount, warmupMetrics);
    }

    if (warmupCount > 0) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    console.log(
      "  ----------------------------------------------------------------------",
    );

    // 2. Měřená fáze (N nezávislých iterací)
    const rawResults = [];
    let scenarioChecksum = 0;

    for (let i = 1; i <= iterationCount; i++) {
      // Mutace vstupu striktně mimo měřený čas performance.now()
      scenario.prepareIteration(i);

      const rssBeforeBytes = getRssBytes();
      const t0 = performance.now();
      const res = await scenario.runIteration(i);
      const t1 = performance.now();
      const rssAfterBytes = getRssBytes();

      if (!Number.isInteger(res.checksum) || res.checksum === 0) {
        throw new Error(
          `Neplatný kontrolní součet (checksum=${res.checksum}) ve scénáři "${scenario.id}" (iterace ${i}).`,
        );
      }

      scenarioChecksum = (Math.imul(scenarioChecksum, 31) + res.checksum) | 0;
      if (scenarioChecksum === 0) {
        scenarioChecksum = res.checksum;
      }

      const metrics = computeWorkerIterationMetrics({
        iterationIndex: i,
        durationMs: t1 - t0,
        workerCount,
        bytesProcessed: res.bytesProcessed,
        checksum: res.checksum,
        rssBeforeBytes,
        rssAfterBytes,
      });

      rawResults.push(metrics);
      logWorkerIteration("RUN", i, iterationCount, metrics);
    }

    const summary = buildWorkerScenarioSummary(
      scenario,
      rawResults,
      warmupCount,
      scenarioChecksum,
    );
    logWorkerScenarioSummary(scenario.name, summary);

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
  } finally {
    await scenario.cleanup();
  }
}

/**
 * Hlavní běhový orchestrátor pro kategorii 06-workers (Node.js, Deno, Bun).
 */
export async function runWorkersBenchmarkSuite({
  projectRoot = process.cwd(),
  adapter,
  driverLabel,
}) {
  const config = await loadConfig(projectRoot);
  const environment = getEnvironmentMetadata();
  const resultsDir = path.resolve(projectRoot, config.resultsDir);
  const workerCount = config.benchmark.workerCount ?? 4;

  logSection(
    `BENCHMARK KATEGORIE 6: PARALELNÍ ZPRACOVÁNÍ (${environment.runtime.toUpperCase()} ${environment.version})`,
  );
  logInfo(
    `Platforma: ${environment.platform} (${environment.arch}) | CPU: ${environment.cpuModel} (${environment.cpuCores} jader) | RAM: ${environment.totalMemoryMB} MB`,
  );
  logInfo(
    `Worker API: ${driverLabel} | Vlákna: W = ${workerCount} | Warmup = ${config.benchmark.warmupIterations}, Iterace N = ${config.benchmark.measuredIterations}`,
  );

  resetBlackholeChecksum(0x20260601);

  const scenarios = [];
  if (config.scenarios.spawnOverhead?.enabled) {
    scenarios.push(
      createSpawnOverheadScenario({
        workerCount,
        adapter,
        driverLabel,
      }),
    );
  }
  if (config.scenarios.messagePassing?.enabled) {
    scenarios.push(
      createMessagePassingScenario({
        workerCount,
        totalBytes: config.scenarios.messagePassing.totalBytes,
        computeRounds: config.scenarios.messagePassing.computeRounds,
        adapter,
        driverLabel,
      }),
    );
  }
  if (config.scenarios.sharedMemory?.enabled) {
    scenarios.push(
      createSharedMemoryScenario({
        workerCount,
        totalBytes: config.scenarios.sharedMemory.totalBytes,
        computeRounds: config.scenarios.sharedMemory.computeRounds,
        adapter,
        driverLabel,
      }),
    );
  }

  const allRawScenarios = {};
  const allSummaryScenarios = {};
  let globalChecksum = 0;

  for (let sIdx = 0; sIdx < scenarios.length; sIdx++) {
    const scenario = scenarios[sIdx];
    const { raw, summary, scenarioChecksum } = await executeWorkerScenario(
      scenario,
      config.benchmark.warmupIterations,
      config.benchmark.measuredIterations,
      workerCount,
    );

    allRawScenarios[scenario.id] = raw;
    allSummaryScenarios[scenario.id] = summary;
    globalChecksum = (Math.imul(globalChecksum, 31) + scenarioChecksum) | 0;

    if (sIdx < scenarios.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  // Ověření, že Varianta B (Structured Clone) a Varianta C (SharedArrayBuffer) vrátily shodný checksum
  if (
    allSummaryScenarios["workers-message-passing"] &&
    allSummaryScenarios["workers-shared-memory"]
  ) {
    const chkB = allSummaryScenarios["workers-message-passing"].checksum;
    const chkC = allSummaryScenarios["workers-shared-memory"].checksum;
    if (chkB !== chkC) {
      throw new Error(
        `Neshoda kontrolního součtu mezi Variantou B (${chkB}) a Variantou C (${chkC})!`,
      );
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
    benchmarkConfig: {
      ...config.benchmark,
      workerCount,
      driver: driverLabel,
    },
    globalChecksum: globalChecksumMeta,
    allRawScenarios,
    allSummaryScenarios,
    filePrefix: "workers",
  });

  logSection(`WORKER BENCHMARK ${environment.runtime.toUpperCase()} DOKONČEN`);
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
