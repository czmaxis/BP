import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureCleanDir,
  exportBenchmarkResults,
  getEnvironmentMetadata,
  loadConfig,
  removeSafe,
} from "./core/utils.js";
import { executeScenario, logInfo, logSection } from "./core/logger.js";
import { createLargeFileScenario } from "./scenarios/02-file-io/large-file.js";
import { createSmallFilesScenario } from "./scenarios/02-file-io/small-files.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Hlavní orchestrátor benchmarku Kategorie 2: Souborové I/O operace (Node.js).
 */
async function main() {
  const config = await loadConfig(__dirname);
  const environment = getEnvironmentMetadata();
  const tempDir = path.resolve(__dirname, config.tempDir);
  const resultsDir = path.resolve(__dirname, config.resultsDir);

  logSection(
    `BENCHMARK KATEGORIE 2: SOUBOROVÉ I/O OPERACE (${environment.runtime.toUpperCase()} ${environment.version})`,
  );
  logInfo(
    `Platforma: ${environment.platform} (${environment.arch}) | CPU: ${environment.cpuModel} (${environment.cpuCores} jader)`,
  );
  logInfo(
    `Konfigurace: Warmup = ${config.benchmark.warmupIterations}, Iterace N = ${config.benchmark.measuredIterations}`,
  );

  // Příprava čistého dočasného adresáře před startem
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
    for (const scenario of scenarios) {
      const { raw, summary } = await executeScenario(
        scenario,
        config.benchmark.warmupIterations,
        config.benchmark.measuredIterations,
      );
      allRawScenarios[scenario.id] = raw;
      allSummaryScenarios[scenario.id] = summary;
    }
  } finally {
    // Finální úklid dočasného adresáře (ponechá prázdný adresář temp/)
    await removeSafe(tempDir);
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

  logSection("BENCHMARK DOKONČEN");
  logInfo(
    `Surová data (N = ${config.benchmark.measuredIterations}) uložena do: ${savedRawPath}`,
  );
  logInfo(
    `Agregované statistiky (p50, p95, p99, Ø, σ) uloženy do: ${savedSummaryPath}`,
  );
}

main().catch((err) => {
  console.error("\n[CHYBA BENCHMARKU]:", err);
  process.exitCode = 1;
});
