/**
 * Benchmark Kategorie 2: Souborové I/O operace – Nativní implementace pro Bun
 *
 * Využívá sdílené jádro (core/utils.js a core/logger.js) a nativní I/O API prostředí Bun:
 * - Varianta A (100 MB): Bun.write(path, ReadableStream) + Bun.file(path).stream()
 * - Varianta B (1 000 x 4 KB): Bun.write(path, buffer) + Bun.file(path).arrayBuffer() v Promise.all
 *
 * Spuštění:
 *   bun run scenarios/02-file-io/bun.ts
 */

import path from "node:path";
import {
  bytesToMB,
  computeIterationMetrics,
  ensureCleanDir,
  exportBenchmarkResults,
  generateRandomBytes,
  getEnvironmentMetadata,
  getRssBytes,
  loadConfig,
  removeSafe,
  round,
} from "../../core/utils.js";
import { executeScenario, logInfo, logSection } from "../../core/logger.js";

/**
 * Varianta A: Sekvenční proudový zápis pomocí nativního Bun.write(path, ReadableStream)
 */
async function bunStreamWriteFile(
  filePath: string,
  chunkBuffer: Uint8Array,
  totalSizeBytes: number,
): Promise<number> {
  let bytesSent = 0;

  const readableStream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const remaining = totalSizeBytes - bytesSent;
      if (remaining <= 0) {
        controller.close();
        return;
      }

      const chunk =
        remaining >= chunkBuffer.byteLength
          ? chunkBuffer
          : chunkBuffer.subarray(0, remaining);

      bytesSent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });

  const bytesWritten = await Bun.write(filePath, readableStream);
  return bytesWritten;
}

/**
 * Varianta A: Sekvenční proudové čtení pomocí nativního Bun.file(path).stream()
 */
async function bunStreamReadFile(filePath: string): Promise<number> {
  const stream = Bun.file(filePath).stream();
  const reader = stream.getReader();
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
    }
    return bytesRead;
  } catch (err) {
    try {
      await reader.cancel();
    } catch {
      // Ignorujeme při úklidu po chybě
    }
    throw err;
  }
}

/**
 * Vytvoří scénář Varianty A (Velký 100MB soubor) pro Bun.
 */
function createLargeFileScenarioBun(options: {
  tempDir: string;
  totalSizeBytes: number;
  chunkSizeBytes: number;
  fileName: string;
}) {
  const { tempDir, totalSizeBytes, chunkSizeBytes, fileName } = options;
  const scenarioDir = path.resolve(tempDir, "large_file_bun");
  const filePath = path.join(scenarioDir, fileName);
  const totalSizeMB = bytesToMB(totalSizeBytes);

  // Předgenerování 64KB bloku náhodných dat mimo měřenou část
  const chunkBuffer = generateRandomBytes(chunkSizeBytes);

  return {
    id: "large-file-100mb",
    name: "Varianta A: Sekvenční streamování (1x 100 MB)",
    description:
      "Sekvenční zápis a čtení jednoho 100MB binárního souboru pomocí Bun.write(stream) a Bun.file().stream() (64KB bloky).",
    config: {
      totalSizeBytes,
      totalSizeMB: round(totalSizeMB, 2),
      chunkSizeBytes,
      fileCount: 1,
    },

    async setup() {
      await ensureCleanDir(scenarioDir);
    },

    async runIteration(iterationIndex: number) {
      await removeSafe(filePath);

      const rssBeforeBytes = getRssBytes();

      // 1. Měření streamovaného zápisu
      const writeStart = performance.now();
      const bytesWritten = await bunStreamWriteFile(
        filePath,
        chunkBuffer,
        totalSizeBytes,
      );
      const writeEnd = performance.now();
      const rssAfterWriteBytes = getRssBytes();

      // 2. Měření streamovaného čtení
      const readStart = performance.now();
      const bytesRead = await bunStreamReadFile(filePath);
      const readEnd = performance.now();
      const rssAfterBytes = getRssBytes();

      if (bytesWritten !== totalSizeBytes || bytesRead !== totalSizeBytes) {
        throw new Error(
          `Nekonzistentní velikost přenesených dat: zapsáno=${bytesWritten}, přečteno=${bytesRead}, očekáváno=${totalSizeBytes}`,
        );
      }

      // Úklid po iteraci mimo měřený čas
      await removeSafe(filePath);

      return computeIterationMetrics({
        iterationIndex,
        bytesProcessed: totalSizeBytes,
        fileCount: 1,
        writeMs: writeEnd - writeStart,
        readMs: readEnd - readStart,
        rssBeforeBytes,
        rssAfterWriteBytes,
        rssAfterBytes,
        opsDecimals: 3,
      });
    },

    async cleanup() {
      await removeSafe(scenarioDir);
    },
  };
}

/**
 * Vytvoří scénář Varianty B (1 000 malých 4KB souborů) pro Bun.
 */
function createSmallFilesScenarioBun(options: {
  tempDir: string;
  fileCount: number;
  fileSizeBytes: number;
  subDir: string;
}) {
  const { tempDir, fileCount, fileSizeBytes, subDir } = options;
  const scenarioDir = path.resolve(tempDir, `${subDir}_bun`);
  const totalSizeBytes = fileCount * fileSizeBytes;
  const totalSizeMB = bytesToMB(totalSizeBytes);

  // Předgenerování 4KB náhodného bufferu a cest mimo měřený čas
  const fileBuffer = generateRandomBytes(fileSizeBytes);
  const filePaths = Array.from({ length: fileCount }, (_, i) =>
    path.join(scenarioDir, `small_${String(i).padStart(4, "0")}.bin`),
  );

  return {
    id: "small-files-1000x4kb",
    name: "Varianta B: Systémová režie – Malé soubory (1 000x 4 KB)",
    description:
      "Paralelní zápis a následné čtení 1 000 souborů o velikosti 4 KB pomocí Bun.write() a Bun.file().arrayBuffer().",
    config: {
      fileCount,
      fileSizeBytes,
      totalSizeBytes,
      totalSizeMB: round(totalSizeMB, 2),
    },

    async setup() {
      await ensureCleanDir(scenarioDir);
    },

    async runIteration(iterationIndex: number) {
      await ensureCleanDir(scenarioDir);

      const rssBeforeBytes = getRssBytes();

      // 1. Měření paralelního zápisu 1 000 souborů
      const writeStart = performance.now();
      await Promise.all(
        filePaths.map((filePath) => Bun.write(filePath, fileBuffer)),
      );
      const writeEnd = performance.now();
      const rssAfterWriteBytes = getRssBytes();

      // 2. Měření paralelního čtení 1 000 souborů
      const readStart = performance.now();
      const buffers = await Promise.all(
        filePaths.map((filePath) => Bun.file(filePath).arrayBuffer()),
      );
      const readEnd = performance.now();
      const rssAfterBytes = getRssBytes();

      let bytesRead = 0;
      for (let i = 0; i < buffers.length; i++) {
        bytesRead += buffers[i].byteLength;
      }

      if (bytesRead !== totalSizeBytes) {
        throw new Error(
          `Nekonzistentní velikost přečtených dat: přečteno=${bytesRead}, očekáváno=${totalSizeBytes}`,
        );
      }

      // Úklid všech 1 000 souborů mimo měřený čas
      await removeSafe(scenarioDir);

      return computeIterationMetrics({
        iterationIndex,
        bytesProcessed: totalSizeBytes,
        fileCount,
        writeMs: writeEnd - writeStart,
        readMs: readEnd - readStart,
        rssBeforeBytes,
        rssAfterWriteBytes,
        rssAfterBytes,
        opsDecimals: 2,
      });
    },

    async cleanup() {
      await removeSafe(scenarioDir);
    },
  };
}

async function main() {
  const projectRoot = process.cwd();
  const config = await loadConfig(projectRoot);
  const environment = getEnvironmentMetadata();
  const tempDir = path.resolve(projectRoot, config.tempDir);
  const resultsDir = path.resolve(projectRoot, config.resultsDir);

  logSection(
    `BENCHMARK KATEGORIE 2: SOUBOROVÉ I/O OPERACE (${environment.runtime.toUpperCase()} ${environment.version})`,
  );
  logInfo(
    `Platforma: ${environment.platform} (${environment.arch}) | CPU: ${environment.cpuModel} (${environment.cpuCores} jader)`,
  );
  logInfo(
    `Konfigurace: Warmup = ${config.benchmark.warmupIterations}, Iterace N = ${config.benchmark.measuredIterations}`,
  );

  await ensureCleanDir(tempDir);

  const scenarios = [];
  if (config.scenarios.largeFile?.enabled) {
    scenarios.push(
      createLargeFileScenarioBun({
        tempDir,
        ...config.scenarios.largeFile,
      }),
    );
  }
  if (config.scenarios.smallFiles?.enabled) {
    scenarios.push(
      createSmallFilesScenarioBun({
        tempDir,
        ...config.scenarios.smallFiles,
      }),
    );
  }

  const allRawScenarios: Record<string, unknown> = {};
  const allSummaryScenarios: Record<string, unknown> = {};

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

  logSection("BENCHMARK BUN DOKONČEN");
  logInfo(
    `Surová data (N = ${config.benchmark.measuredIterations}) uložena do: ${savedRawPath}`,
  );
  logInfo(
    `Agregované statistiky (p50, p95, p99, Ø, σ) uloženy do: ${savedSummaryPath}`,
  );
}

main().catch((err) => {
  console.error("\n[CHYBA BENCHMARKU BUN]:", err);
  process.exit(1);
});
