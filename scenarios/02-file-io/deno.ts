/**
 * Benchmark Kategorie 2: Souborové I/O operace – Nativní implementace pro Deno
 *
 * Využívá sdílené jádro (core/utils.js a core/logger.js) a nativní I/O API prostředí Deno:
 * - Varianta A (100 MB): Deno.open() + Web Streams API (file.writable / file.readable)
 * - Varianta B (1 000 x 4 KB): Deno.writeFile() a Deno.readFile() v Promise.all
 *
 * Spuštění:
 *   deno run --allow-read --allow-write --allow-sys scenarios/02-file-io/deno.ts
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
 * Varianta A: Sekvenční proudový zápis pomocí Deno.open() a Web WritableStream
 */
async function denoStreamWriteFile(
  filePath: string,
  chunkBuffer: Uint8Array,
  totalSizeBytes: number,
): Promise<number> {
  const file = await Deno.open(filePath, {
    write: true,
    create: true,
    truncate: true,
  });

  const writer = file.writable.getWriter();
  let bytesWritten = 0;

  try {
    while (bytesWritten < totalSizeBytes) {
      const remaining = totalSizeBytes - bytesWritten;
      const chunk =
        remaining >= chunkBuffer.byteLength
          ? chunkBuffer
          : chunkBuffer.subarray(0, remaining);

      await writer.ready;
      await writer.write(chunk);
      bytesWritten += chunk.byteLength;
    }

    await writer.close();
    return bytesWritten;
  } catch (err) {
    try {
      await writer.abort(err);
    } catch {
      // Ignorujeme chybu při uzavírání po selhání
    }
    throw err;
  }
}

/**
 * Varianta A: Sekvenční proudové čtení pomocí Deno.open() a Web ReadableStream
 */
async function denoStreamReadFile(filePath: string): Promise<number> {
  const file = await Deno.open(filePath, { read: true });
  const reader = file.readable.getReader();
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
      // Ignorujeme
    }
    throw err;
  }
}

/**
 * Vytvoří scénář Varianty A (Velký 100MB soubor) pro Deno.
 */
function createLargeFileScenarioDeno(options: {
  tempDir: string;
  totalSizeBytes: number;
  chunkSizeBytes: number;
  fileName: string;
}) {
  const { tempDir, totalSizeBytes, chunkSizeBytes, fileName } = options;
  const scenarioDir = path.resolve(tempDir, "large_file_deno");
  const filePath = path.join(scenarioDir, fileName);
  const totalSizeMB = bytesToMB(totalSizeBytes);

  // Předgenerování 64KB bloku náhodných dat mimo měřenou část
  const chunkBuffer = generateRandomBytes(chunkSizeBytes);

  return {
    id: "large-file-100mb",
    name: "Varianta A: Sekvenční streamování (1x 100 MB)",
    description:
      "Sekvenční zápis a čtení jednoho 100MB binárního souboru pomocí Deno.open a Web Streams (64KB bloky).",
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
      const bytesWritten = await denoStreamWriteFile(
        filePath,
        chunkBuffer,
        totalSizeBytes,
      );
      const writeEnd = performance.now();
      const rssAfterWriteBytes = getRssBytes();

      // 2. Měření streamovaného čtení
      const readStart = performance.now();
      const bytesRead = await denoStreamReadFile(filePath);
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
 * Vytvoří scénář Varianty B (1 000 malých 4KB souborů) pro Deno.
 */
function createSmallFilesScenarioDeno(options: {
  tempDir: string;
  fileCount: number;
  fileSizeBytes: number;
  subDir: string;
}) {
  const { tempDir, fileCount, fileSizeBytes, subDir } = options;
  const scenarioDir = path.resolve(tempDir, `${subDir}_deno`);
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
      "Paralelní zápis a následné čtení 1 000 souborů o velikosti 4 KB pomocí Deno.writeFile a Deno.readFile.",
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
        filePaths.map((filePath) => Deno.writeFile(filePath, fileBuffer)),
      );
      const writeEnd = performance.now();
      const rssAfterWriteBytes = getRssBytes();

      // 2. Měření paralelního čtení 1 000 souborů
      const readStart = performance.now();
      const buffers = await Promise.all(
        filePaths.map((filePath) => Deno.readFile(filePath)),
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
  const projectRoot = Deno.cwd();
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
      createLargeFileScenarioDeno({
        tempDir,
        ...config.scenarios.largeFile,
      }),
    );
  }
  if (config.scenarios.smallFiles?.enabled) {
    scenarios.push(
      createSmallFilesScenarioDeno({
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

  logSection("BENCHMARK DENO DOKONČEN");
  logInfo(
    `Surová data (N = ${config.benchmark.measuredIterations}) uložena do: ${savedRawPath}`,
  );
  logInfo(
    `Agregované statistiky (p50, p95, p99, Ø, σ) uloženy do: ${savedSummaryPath}`,
  );
}

main().catch((err) => {
  console.error("\n[CHYBA BENCHMARKU DENO]:", err);
  Deno.exit(1);
});
