import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calculateStats,
  ensureCleanDir,
  getEnvironmentMetadata,
  removeSafe
} from './core/utils.js';
import {
  logInfo,
  logIteration,
  logScenarioSummary,
  logSection,
  saveJsonResult
} from './core/logger.js';
import { createLargeFileScenario } from './scenarios/02-file-io/large-file.js';
import { createSmallFilesScenario } from './scenarios/02-file-io/small-files.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Načte konfiguraci z config.json a případně zohlední volitelné CLI přepínače
 * (--warmup=N, --iterations=N).
 */
async function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');
  const raw = await readFile(configPath, 'utf-8');
  const config = JSON.parse(raw);

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--warmup=')) {
      config.benchmark.warmupIterations = Number.parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--iterations=')) {
      config.benchmark.measuredIterations = Number.parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--scenario=')) {
      const scenario = arg.split('=')[1].toLowerCase();
      if (scenario === 'large' || scenario === 'large-file') {
        config.scenarios.largeFile.enabled = true;
        config.scenarios.smallFiles.enabled = false;
      } else if (scenario === 'small' || scenario === 'small-files') {
        config.scenarios.largeFile.enabled = false;
        config.scenarios.smallFiles.enabled = true;
      }
    }
  }

  return config;
}

/**
 * Spočítá souhrnné statistiky (p50, p95, p99, průměr, směrodatnou odchylku, min, max)
 * pro všechny klíčové metriky ze surových výsledků jednotlivých iterací.
 *
 * @param {object} scenario Definice scénáře
 * @param {object[]} rawIterations Pole naměřených iterací
 * @param {number} warmupIterations Počet zahřívacích cyklů
 */
function buildScenarioSummary(scenario, rawIterations, warmupIterations) {
  const metricKeys = [
    'writeMs',
    'readMs',
    'totalMs',
    'writeThroughputMBps',
    'readThroughputMBps',
    'totalThroughputMBps',
    'writeOpsPerSec',
    'readOpsPerSec',
    'totalOpsPerSec',
    'rssBeforeMB',
    'rssAfterWriteMB',
    'rssAfterMB',
    'rssDeltaMB'
  ];

  const metricsSummary = {};
  for (const key of metricKeys) {
    const values = rawIterations.map((item) => item[key]);
    metricsSummary[key] = calculateStats(values, 3);
  }

  return {
    scenarioId: scenario.id,
    name: scenario.name,
    description: scenario.description,
    config: scenario.config,
    warmupIterations,
    iterations: rawIterations.length,
    metrics: metricsSummary
  };
}

/**
 * Spustí životní cyklus jednoho scénáře:
 * 1. Setup
 * 2. Warmup fáze (výsledky se zahazují)
 * 3. Měřená fáze (N iterací)
 * 4. Cleanup
 */
async function executeScenario(scenario, warmupCount, iterationCount) {
  logSection(scenario.name);
  logInfo(`Popis: ${scenario.description}`);
  logInfo(`Zahřívací fáze (Warmup): ${warmupCount} cyklů | Měřené iterace: N = ${iterationCount}`);

  await scenario.setup();

  try {
    // 1. Zahřívací fáze (Warmup) – stabilizace JIT a bufferů
    for (let w = 1; w <= warmupCount; w++) {
      const warmupMetrics = await scenario.runIteration(w);
      logIteration('WARMUP', w, warmupCount, warmupMetrics);
    }

    console.log('  ----------------------------------------------------------------------');

    // 2. Měřená fáze (N nezávislých iterací)
    const rawResults = [];
    for (let i = 1; i <= iterationCount; i++) {
      const metrics = await scenario.runIteration(i);
      rawResults.push(metrics);
      logIteration('RUN', i, iterationCount, metrics);
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
        iterations: rawResults
      },
      summary
    };
  } finally {
    await scenario.cleanup();
  }
}

/**
 * Hlavní orchestrátor benchmarku Kategorie 2: Souborové I/O operace.
 */
async function main() {
  const config = await loadConfig();
  const environment = getEnvironmentMetadata();
  const tempDir = path.resolve(__dirname, config.tempDir);
  const resultsDir = path.resolve(__dirname, config.resultsDir);

  logSection(
    `BENCHMARK KATEGORIE 2: SOUBOROVÉ I/O OPERACE (${environment.runtime.toUpperCase()} ${environment.version})`
  );
  logInfo(`Platforma: ${environment.platform} (${environment.arch}) | CPU: ${environment.cpuModel} (${environment.cpuCores} jader)`);
  logInfo(`Konfigurace: Warmup = ${config.benchmark.warmupIterations}, Iterace N = ${config.benchmark.measuredIterations}`);

  // Příprava čistého dočasného adresáře před startem
  await ensureCleanDir(tempDir);

  const scenarios = [];
  if (config.scenarios.largeFile?.enabled) {
    scenarios.push(
      createLargeFileScenario({
        tempDir,
        ...config.scenarios.largeFile
      })
    );
  }
  if (config.scenarios.smallFiles?.enabled) {
    scenarios.push(
      createSmallFilesScenario({
        tempDir,
        ...config.scenarios.smallFiles
      })
    );
  }

  const allRawScenarios = {};
  const allSummaryScenarios = {};

  try {
    for (const scenario of scenarios) {
      const { raw, summary } = await executeScenario(
        scenario,
        config.benchmark.warmupIterations,
        config.benchmark.measuredIterations
      );
      allRawScenarios[scenario.id] = raw;
      allSummaryScenarios[scenario.id] = summary;
    }
  } finally {
    // Finální úklid dočasného adresáře (ponechá prázdný adresář temp/)
    await removeSafe(tempDir);
    await ensureCleanDir(tempDir);
  }

  const runtimeSuffix = environment.runtime;
  const rawFileName = `file_io_raw_${runtimeSuffix}.json`;
  const summaryFileName = `file_io_summary_${runtimeSuffix}.json`;

  const rawPayload = {
    category: config.category,
    environment,
    benchmarkConfig: config.benchmark,
    scenarios: allRawScenarios
  };

  const summaryPayload = {
    category: config.category,
    environment,
    benchmarkConfig: config.benchmark,
    scenarios: allSummaryScenarios
  };

  const savedRawPath = await saveJsonResult(resultsDir, rawFileName, rawPayload);
  const savedSummaryPath = await saveJsonResult(resultsDir, summaryFileName, summaryPayload);

  logSection('BENCHMARK DOKONČEN');
  logInfo(`Surová data (N = ${config.benchmark.measuredIterations}) uložena do: ${savedRawPath}`);
  logInfo(`Agregované statistiky (p50, p95, p99, Ø, σ) uloženy do: ${savedSummaryPath}`);
}

main().catch((err) => {
  console.error('\n[CHYBA BENCHMARKU]:', err);
  process.exitCode = 1;
});

