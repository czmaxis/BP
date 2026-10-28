import {
  buildScenarioSummary,
  exportBenchmarkResults,
  saveJsonResult,
} from "./utils.js";

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
    formatRow("Operace za sekundu", summary.metrics.totalOpsPerSec, "op/s"),
  );
  console.log(formatRow("Paměť RSS (po)", summary.metrics.rssAfterMB, "MB  "));
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

export { saveJsonResult, exportBenchmarkResults };
