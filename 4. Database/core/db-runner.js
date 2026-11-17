/**
 * Sdílený běhový orchestrátor a logger pro Kategorii 4: Databázové operace (04-database).
 *
 * Zajišťuje:
 * 1. Zahřívací fázi (Warmup = 10 cyklů).
 * 2. Měřenou fázi (N = 30 nezávislých iterací), kde každá iterace pracuje s fyzickým
 *    souborem `.sqlite` v adresáři `temp/` (v režimu WAL) a po skončení iterace jej smaže.
 * 3. Striktní oddělení měřeného času `performance.now()` a čtení RSS paměti od přípravy
 *    a úklidu databázových souborů.
 * 4. Kontrolu platnosti kontrolního součtu (`checksum`) a export do `results/database_raw_<runtime>.json`
 *    a `results/database_summary_<runtime>.json`.
 */

import path from "node:path";
import {
  createBatchInsertScenarioTemplate,
  createComplexSelectScenarioTemplate,
} from "./db-workloads.js";
import {
  ensureCleanDir,
  exportBenchmarkResults,
  loadConfig,
} from "./fs-helper.js";
import { getEnvironmentMetadata, getRssBytes } from "./runtime.js";
import {
  buildDbScenarioSummary,
  computeDbIterationMetrics,
  getBlackholeChecksum,
  resetBlackholeChecksum,
} from "./stats.js";

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
 * Vypíše průběh jedné iterace databázového benchmarku.
 */
export function logDbIteration(phase, current, total, metrics) {
  const indexStr = `${String(current).padStart(2, " ")}/${String(total).padStart(2, " ")}`;
  const tag = phase === "WARMUP" ? "WARMUP" : "MĚŘENÍ";
  const hexChecksum = `0x${(metrics.checksum >>> 0).toString(16).padStart(8, "0")}`;
  console.log(
    `  [${tag} ${indexStr}] ` +
      `Doba: ${metrics.durationMs.toFixed(2).padStart(7, " ")} ms | ` +
      `Ops: ${metrics.opsPerSec.toFixed(1).padStart(8, " ")} op/s | ` +
      `Řádky: ${metrics.rowsPerSec.toFixed(0).padStart(9, " ")} ř/s | ` +
      `Checksum: ${hexChecksum} | ` +
      `RSS po: ${metrics.rssAfterMB.toFixed(1)} MB`,
  );
}

/**
 * Vypíše přehlednou souhrnnou tabulku statistik pro daný databázový scénář.
 */
export function logDbScenarioSummary(scenarioTitle, summary) {
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
    `p95: ${String(stats.p95.toFixed(2)).padStart(9, " ")} ${unit} | ` +
    `p99: ${String(stats.p99.toFixed(2)).padStart(9, " ")} ${unit} | ` +
    `Ø: ${String(stats.mean.toFixed(2)).padStart(9, " ")} ± ${String(stats.stdDev.toFixed(2)).padStart(7, " ")} ${unit}`;

  console.log(formatRow("Doba operace", summary.metrics.durationMs, "ms  "));
  console.log(formatRow("Operace / dotazy", summary.metrics.opsPerSec, "op/s"));
  console.log(formatRow("Zpracované řádky", summary.metrics.rowsPerSec, "ř/s "));
  console.log(formatRow("Paměť RSS (po)", summary.metrics.rssAfterMB, "MB  "));
  console.log(formatRow("Paměť RSS (špička)", summary.metrics.rssPeakMB, "MB  "));
  console.log(
    "  ──────────────────────────────────────────────────────────────────────",
  );
}

/**
 * Spustí životní cyklus jednoho databázového scénáře (Setup -> Warmup -> Měřené iterace -> Cleanup).
 */
export async function executeDbScenario(scenario, warmupCount, iterationCount) {
  logSection(scenario.name);
  logInfo(`Popis: ${scenario.description}`);
  logInfo(
    `Zahřívací fáze (Warmup): ${warmupCount} cyklů | Měřené iterace: N = ${iterationCount}`,
  );

  await scenario.setup();

  try {
    // 1. Zahřívací fáze (Warmup) – výsledky se zahazují
    for (let w = 1; w <= warmupCount; w++) {
      await scenario.prepareIteration(w);
      const rssBeforeBytes = getRssBytes();
      const t0 = performance.now();
      const runResult = scenario.runIteration(w);
      const t1 = performance.now();
      const rssAfterBytes = getRssBytes();
      const warmupChecksum = await scenario.finishIteration(w, runResult);

      const warmupMetrics = computeDbIterationMetrics({
        iterationIndex: w,
        durationMs: t1 - t0,
        operationsCount: runResult.operationsCount,
        rowsProcessed: runResult.rowsProcessed,
        checksum: warmupChecksum,
        rssBeforeBytes,
        rssAfterBytes,
      });
      logDbIteration("WARMUP", w, warmupCount, warmupMetrics);
    }

    if (warmupCount > 0) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.log(
      "  ----------------------------------------------------------------------",
    );

    // 2. Měřená fáze (N nezávislých iterací)
    const rawResults = [];
    let scenarioChecksum = 0;

    for (let i = 1; i <= iterationCount; i++) {
      // Příprava databázového souboru v temp/ a dat mimo měřený čas
      await scenario.prepareIteration(i);

      const rssBeforeBytes = getRssBytes();
      const t0 = performance.now();
      const runResult = scenario.runIteration(i);
      const t1 = performance.now();
      const rssAfterBytes = getRssBytes();

      // Verifikace, uzavření a smazání .sqlite + -wal + -shm souborů mimo měřený čas
      const iterChecksum = await scenario.finishIteration(i, runResult);

      if (!Number.isInteger(iterChecksum) || iterChecksum === 0) {
        throw new Error(
          `Neplatný kontrolní součet (checksum=${iterChecksum}) ve scénáři "${scenario.id}" (iterace ${i}).`,
        );
      }

      scenarioChecksum = (Math.imul(scenarioChecksum, 31) + iterChecksum) | 0;
      if (scenarioChecksum === 0) {
        scenarioChecksum = iterChecksum;
      }

      const metrics = computeDbIterationMetrics({
        iterationIndex: i,
        durationMs: t1 - t0,
        operationsCount: runResult.operationsCount,
        rowsProcessed: runResult.rowsProcessed,
        checksum: iterChecksum,
        rssBeforeBytes,
        rssAfterBytes,
      });

      rawResults.push(metrics);
      logDbIteration("RUN", i, iterationCount, metrics);
    }

    const summary = buildDbScenarioSummary(
      scenario,
      rawResults,
      warmupCount,
      scenarioChecksum,
    );
    logDbScenarioSummary(scenario.name, summary);

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
 * Hlavní běhový orchestrátor pro kategorii 04-database (Node.js, Deno, Bun).
 */
export async function runDatabaseBenchmarkSuite({
  projectRoot = process.cwd(),
  openDatabase,
  driverName,
}) {
  const config = await loadConfig(projectRoot);
  const environment = getEnvironmentMetadata();
  const tempDir = path.resolve(projectRoot, config.tempDir);
  const resultsDir = path.resolve(projectRoot, config.resultsDir);

  logSection(
    `BENCHMARK KATEGORIE 4: DATABÁZOVÉ OPERACE (${environment.runtime.toUpperCase()} ${environment.version})`,
  );
  logInfo(
    `Platforma: ${environment.platform} (${environment.arch}) | CPU: ${environment.cpuModel} (${environment.cpuCores} jader) | RAM: ${environment.totalMemoryMB} MB`,
  );
  logInfo(
    `Ovladač SQLite: ${driverName} | Konfigurace: Warmup = ${config.benchmark.warmupIterations}, Iterace N = ${config.benchmark.measuredIterations}`,
  );

  await ensureCleanDir(tempDir);
  resetBlackholeChecksum(0x20260401);

  const scenarios = [];
  if (config.scenarios.batchInsert?.enabled) {
    scenarios.push(
      createBatchInsertScenarioTemplate({
        tempDir,
        ...config.scenarios.batchInsert,
        openDatabase,
        driverName,
      }),
    );
  }
  if (config.scenarios.complexSelect?.enabled) {
    scenarios.push(
      createComplexSelectScenarioTemplate({
        tempDir,
        ...config.scenarios.complexSelect,
        openDatabase,
        driverName,
      }),
    );
  }

  const allRawScenarios = {};
  const allSummaryScenarios = {};
  let globalChecksum = 0;

  try {
    for (let sIdx = 0; sIdx < scenarios.length; sIdx++) {
      const scenario = scenarios[sIdx];
      const { raw, summary, scenarioChecksum } = await executeDbScenario(
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
  } finally {
    await ensureCleanDir(tempDir);
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
      driver: driverName,
    },
    globalChecksum: globalChecksumMeta,
    allRawScenarios,
    allSummaryScenarios,
    filePrefix: "database",
  });

  logSection(`DATABÁZOVÝ BENCHMARK ${environment.runtime.toUpperCase()} DOKONČEN`);
  logInfo(
    `Globální kontrolní součet (Checksum): ${globalChecksumMeta.hex} (${globalChecksumMeta.value})`,
  );
  logInfo(
    `Surová data (N = ${config.benchmark.measuredIterations}) uložena do: ${savedRawPath}`,
  );
  logInfo(
    `Agregované statistiky (p50, p95, p99, Ø, σ) uloženy do: ${savedSummaryPath}`,
  );
}
