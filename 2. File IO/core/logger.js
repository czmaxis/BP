import path from "node:path";
import { getEnvironmentMetadata } from "./runtime.js";
import { buildScenarioSummary } from "./stats.js";
import {
  ensureCleanDir,
  exportBenchmarkResults,
  loadConfig,
  saveJsonResult,
} from "./fs-helper.js";

/**
 * Vypíše formátovanou hlavičku do konzole.
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
 * Vypíše průběh iterace (warmup nebo měřený běh).
 *
 * @param {'WARMUP' | 'RUN'} phase
 * @param {number} current
 * @param {number} total
 * @param {object} metrics
 */
export function logIteration(phase, current, total, metrics) {
  const indexStr = `${String(current).padStart(2, " ")}/${String(total).padStart(2, " ")}`;
  const tag = phase === "WARMUP" ? "WARMUP" : "MĚŘENÍ";
  console.log(
    `  [${tag} ${indexStr}] ` +
      `Zápis: ${metrics.writeMs.toFixed(2).padStart(8, " ")} ms (${metrics.writeThroughputMBps.toFixed(1).padStart(7, " ")} MB/s) | ` +
      `Čtení: ${metrics.readMs.toFixed(2).padStart(8, " ")} ms (${metrics.readThroughputMBps.toFixed(1).padStart(7, " ")} MB/s) | ` +
      `Celkem: ${metrics.totalMs.toFixed(2).padStart(8, " ")} ms | ` +
      `RSS po: ${metrics.rssAfterMB.toFixed(1)} MB`,
  );
}

/**
 * Vypíše přehlednou souhrnnou tabulku statistik pro daný scénář do konzole.
 *
 * @param {string} scenarioTitle
 * @param {object} summary
 */
export function logScenarioSummary(scenarioTitle, summary) {
  console.log(
    `\n  Souhrnné výsledky – ${scenarioTitle} (N = ${summary.iterations}):`,
  );
  console.log(
    "  ──────────────────────────────────────────────────────────────────────",
  );

  const formatRow = (label, stats, unit) =>
    `  ${label.padEnd(20, " ")} | ` +
    `p50: ${String(stats.p50.toFixed(2)).padStart(9, " ")} ${unit} | ` +
    `p95: ${String(stats.p95.toFixed(2)).padStart(9, " ")} ${unit} | ` +
    `p99: ${String(stats.p99.toFixed(2)).padStart(9, " ")} ${unit} | ` +
    `Ø: ${String(stats.mean.toFixed(2)).padStart(9, " ")} ± ${String(stats.stdDev.toFixed(2)).padStart(7, " ")} ${unit}`;

  console.log(formatRow("Doba zápisu", summary.metrics.writeMs, "ms  "));
  console.log(formatRow("Doba čtení", summary.metrics.readMs, "ms  "));
  console.log(formatRow("Doba celkem", summary.metrics.totalMs, "ms  "));
  console.log(
    formatRow(
      "Propustnost zápisu",
      summary.metrics.writeThroughputMBps,
      "MB/s",
    ),
  );
  console.log(
    formatRow("Propustnost čtení", summary.metrics.readThroughputMBps, "MB/s"),
  );
  console.log(
    formatRow(
      "Propustnost celkem",
      summary.metrics.totalThroughputMBps,
      "MB/s",
    ),
  );
  console.log(
    formatRow("Operace za sekundu", summary.metrics.totalOpsPerSec, "op/s"),
  );
  console.log(formatRow("Paměť RSS (po)", summary.metrics.rssAfterMB, "MB  "));
  console.log(
    formatRow("Paměť RSS (špička)", summary.metrics.rssPeakMB, "MB  "),
  );
  console.log(
    "  ──────────────────────────────────────────────────────────────────────",
  );
}

/**
 * Spustí kompletní životní cyklus jednoho scénáře (Setup -> Warmup -> Měřené iterace -> Cleanup)
 * a vrátí surová i agregovaná data. Sdíleno mezi Node.js, Deno a Bun.
 *
 * @param {object} scenario Objekt scénáře se metodami setup(), runIteration(i), cleanup()
 * @param {number} warmupCount Počet zahřívacích cyklů
 * @param {number} iterationCount Počet měřených iterací N
 */
export async function executeScenario(scenario, warmupCount, iterationCount) {
  logSection(scenario.name);
  logInfo(`Popis: ${scenario.description}`);
  logInfo(
    `Zahřívací fáze (Warmup): ${warmupCount} cyklů | Měřené iterace: N = ${iterationCount}`,
  );

  await scenario.setup();

  try {
    // 1. Zahřívací fáze (Warmup) – stabilizace JIT a bufferů
    for (let w = 1; w <= warmupCount; w++) {
      const warmupMetrics = await scenario.runIteration(w);
      logIteration("WARMUP", w, warmupCount, warmupMetrics);
    }

    // Stabilizační pauza (200 ms) mezi Warmupem a 1. měřenou iterací pro doznění I/O operací OS
    if (warmupCount > 0) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.log(
      "  ----------------------------------------------------------------------",
    );

    // 2. Měřená fáze (N nezávislých iterací)
    const rawResults = [];
    for (let i = 1; i <= iterationCount; i++) {
      const metrics = await scenario.runIteration(i);
      rawResults.push(metrics);
      logIteration("RUN", i, iterationCount, metrics);
    }

    const summary = buildScenarioSummary(scenario, rawResults, warmupCount);
    logScenarioSummary(scenario.name, summary);

    return {
      raw: {
        scenarioId: scenario.id,
        name: scenario.name,
        config: scenario.config,
        warmupIterations: warmupCount,
        measuredIterations: iterationCount,
        iterations: rawResults,
      },
      summary,
    };
  } finally {
    await scenario.cleanup();
  }
}

/**
 * Sdílený hlavní běhový orchestrátor pro kategorii 02-file-io (Node.js, Deno, Bun).
 * Načte konfiguraci, připraví adresář temp/, spustí povolené scénáře, uklidí temp/
 * a vyexportuje raw + summary JSON soubory.
 */
export async function runFileIoBenchmarkSuite({
  projectRoot = process.cwd(),
  createLargeFileScenario,
  createSmallFilesScenario,
}) {
  const config = await loadConfig(projectRoot);
  const environment = getEnvironmentMetadata();
  const tempDir = path.resolve(projectRoot, config.tempDir);
  const resultsDir = path.resolve(projectRoot, config.resultsDir);

  logSection(
    `BENCHMARK KATEGORIE 2: SOUBOROVÉ I/O OPERACE (${environment.runtime.toUpperCase()} ${environment.version})`,
  );
  logInfo(
    `Platforma: ${environment.platform} (${environment.arch}) | CPU: ${environment.cpuModel} (${environment.cpuCores} jader) | RAM: ${environment.totalMemoryMB} MB`,
  );
  logInfo(
    `Konfigurace: Warmup = ${config.benchmark.warmupIterations}, Iterace N = ${config.benchmark.measuredIterations}`,
  );

  await ensureCleanDir(tempDir);

  const scenarios = [];
  if (config.scenarios.largeFile?.enabled) {
    scenarios.push(
      createLargeFileScenario({
        tempDir,
        ...config.scenarios.largeFile,
      }),
    );
  }
  if (config.scenarios.smallFiles?.enabled) {
    scenarios.push(
      createSmallFilesScenario({
        tempDir,
        ...config.scenarios.smallFiles,
      }),
    );
  }

  const allRawScenarios = {};
  const allSummaryScenarios = {};

  try {
    for (let sIdx = 0; sIdx < scenarios.length; sIdx++) {
      const scenario = scenarios[sIdx];
      const { raw, summary } = await executeScenario(
        scenario,
        config.benchmark.warmupIterations,
        config.benchmark.measuredIterations,
      );
      allRawScenarios[scenario.id] = raw;
      allSummaryScenarios[scenario.id] = summary;

      // Stabilizační pauza mezi scénáři (Varianta A -> Varianta B) pro vyprázdnění dirty pages v OS
      if (sIdx < scenarios.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  } finally {
    await ensureCleanDir(tempDir);
  }

  const { savedRawPath, savedSummaryPath } = await exportBenchmarkResults({
    resultsDir,
    category: config.category,
    environment,
    benchmarkConfig: config.benchmark,
    allRawScenarios,
    allSummaryScenarios,
  });

  logSection(`BENCHMARK ${environment.runtime.toUpperCase()} DOKONČEN`);
  logInfo(
    `Surová data (N = ${config.benchmark.measuredIterations}) uložena do: ${savedRawPath}`,
  );
  logInfo(
    `Agregované statistiky (p50, p95, p99, Ø, σ) uloženy do: ${savedSummaryPath}`,
  );
}

export { saveJsonResult, exportBenchmarkResults };
