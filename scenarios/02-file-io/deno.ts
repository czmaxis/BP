/**
 * Benchmark Kategorie 2: Souborové I/O operace – Nativní implementace pro Deno
 *
 * Využívá výhradně nativní API běhového prostředí Deno:
 * - Varianta A (100 MB): Deno.open() + Web Streams API (file.writable / file.readable)
 * - Varianta B (1 000 x 4 KB): Deno.writeFile() a Deno.readFile() v Promise.all
 * - Měření paměti: Deno.memoryUsage().rss
 * - Měření času: performance.now()
 *
 * Spuštění:
 *   deno run --allow-read --allow-write --allow-sys scenarios/02-file-io/deno.ts
 */

interface BenchmarkConfig {
  category: string;
  tempDir: string;
  resultsDir: string;
  benchmark: {
    warmupIterations: number;
    measuredIterations: number;
  };
  scenarios: {
    largeFile: {
      enabled: boolean;
      totalSizeBytes: number;
      chunkSizeBytes: number;
      fileName: string;
    };
    smallFiles: {
      enabled: boolean;
      fileCount: number;
      fileSizeBytes: number;
      subDir: string;
    };
  };
}

interface IterationMetrics {
  iteration: number;
  fileCount?: number;
  bytesProcessed: number;
  writeMs: number;
  readMs: number;
  totalMs: number;
  writeThroughputMBps: number;
  readThroughputMBps: number;
  totalThroughputMBps: number;
  writeOpsPerSec: number;
  readOpsPerSec: number;
  totalOpsPerSec: number;
  rssBeforeBytes: number;
  rssAfterWriteBytes: number;
  rssAfterBytes: number;
  rssBeforeMB: number;
  rssAfterWriteMB: number;
  rssAfterMB: number;
  rssDeltaMB: number;
}

interface StatSummary {
  count: number;
  mean: number;
  stdDev: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/**
 * Vygeneruje binární Uint8Array naplněný kryptograficky náhodnými bajty.
 * Web Crypto API getRandomValues umožňuje max. 65 536 bajtů na jedno volání,
 * proto je plnění rozděleno po 64KB blocích.
 */
function generateRandomBytes(sizeBytes: number): Uint8Array {
  const buffer = new Uint8Array(sizeBytes);
  const maxQuota = 65536;
  for (let offset = 0; offset < sizeBytes; offset += maxQuota) {
    const length = Math.min(maxQuota, sizeBytes - offset);
    crypto.getRandomValues(buffer.subarray(offset, offset + length));
  }
  return buffer;
}

function getRssBytes(): number {
  return Deno.memoryUsage().rss;
}

function bytesToMB(bytes: number): number {
  return bytes / (1024 * 1024);
}

function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (upper >= sortedValues.length) return sortedValues[sortedValues.length - 1];
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function calculateStats(values: number[], decimals = 3): StatSummary {
  const count = values.length;
  if (count === 0) {
    return { count: 0, mean: 0, stdDev: 0, min: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const mean = sum / count;

  const variance =
    count > 1
      ? sorted.reduce((acc, val) => acc + (val - mean) ** 2, 0) / (count - 1)
      : 0;
  const stdDev = Math.sqrt(variance);

  return {
    count,
    mean: round(mean, decimals),
    stdDev: round(stdDev, decimals),
    min: round(sorted[0], decimals),
    p50: round(calculatePercentile(sorted, 50), decimals),
    p95: round(calculatePercentile(sorted, 95), decimals),
    p99: round(calculatePercentile(sorted, 99), decimals),
    max: round(sorted[count - 1], decimals)
  };
}

async function removeSafe(targetPath: string): Promise<void> {
  try {
    await Deno.remove(targetPath, { recursive: true });
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      throw err;
    }
  }
}

async function ensureCleanDir(dirPath: string): Promise<void> {
  await removeSafe(dirPath);
  await Deno.mkdir(dirPath, { recursive: true });
}

function joinPath(...segments: string[]): string {
  const sep = Deno.build.os === 'windows' ? '\\' : '/';
  return segments
    .map((s, idx) => {
      if (idx === 0) return s.replace(/[\\/]+$/, '');
      return s.replace(/^[\\/]+|[\\/]+$/g, '');
    })
    .filter(Boolean)
    .join(sep);
}

function getEnvironmentMetadata() {
  let cpuModel = 'unknown';
  let cpuCores = navigator.hardwareConcurrency || 1;
  let totalMemoryMB = 0;
  let release = 'unknown';

  try {
    release = Deno.osRelease();
    const memInfo = Deno.systemMemoryInfo();
    totalMemoryMB = round(bytesToMB(memInfo.total), 0);
  } catch {
    // Pokud není předán --allow-sys, použijí se výchozí hodnoty
  }

  return {
    runtime: 'deno',
    version: `v${Deno.version.deno} (V8 ${Deno.version.v8}, TS ${Deno.version.typescript})`,
    platform: Deno.build.os,
    release,
    arch: Deno.build.arch,
    cpuModel,
    cpuCores,
    totalMemoryMB,
    timestamp: new Date().toISOString()
  };
}

function logSection(title: string): void {
  const line = '═'.repeat(72);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(`${line}`);
}

function logInfo(message: string): void {
  const now = new Date().toISOString().slice(11, 23);
  console.log(`[${now}] ${message}`);
}

function logIteration(
  phase: 'WARMUP' | 'RUN',
  current: number,
  total: number,
  metrics: IterationMetrics
): void {
  const indexStr = `${String(current).padStart(2, ' ')}/${String(total).padStart(2, ' ')}`;
  const tag = phase === 'WARMUP' ? 'WARMUP' : 'MĚŘENÍ';
  console.log(
    `  [${tag} ${indexStr}] ` +
      `Zápis: ${metrics.writeMs.toFixed(2).padStart(8, ' ')} ms (${metrics.writeThroughputMBps.toFixed(1).padStart(7, ' ')} MB/s) | ` +
      `Čtení: ${metrics.readMs.toFixed(2).padStart(8, ' ')} ms (${metrics.readThroughputMBps.toFixed(1).padStart(7, ' ')} MB/s) | ` +
      `Celkem: ${metrics.totalMs.toFixed(2).padStart(8, ' ')} ms | ` +
      `RSS po: ${metrics.rssAfterMB.toFixed(1)} MB`
  );
}

function logScenarioSummary(scenarioTitle: string, summary: { iterations: number; metrics: Record<string, StatSummary> }): void {
  console.log(`\n  Souhrnné výsledky – ${scenarioTitle} (N = ${summary.iterations}):`);
  console.log('  ──────────────────────────────────────────────────────────────────────');

  const formatRow = (label: string, stats: StatSummary, unit: string) =>
    `  ${label.padEnd(20, ' ')} | ` +
    `p50: ${String(stats.p50.toFixed(2)).padStart(9, ' ')} ${unit} | ` +
    `p95: ${String(stats.p95.toFixed(2)).padStart(9, ' ')} ${unit} | ` +
    `p99: ${String(stats.p99.toFixed(2)).padStart(9, ' ')} ${unit} | ` +
    `Ø: ${String(stats.mean.toFixed(2)).padStart(9, ' ')} ± ${String(stats.stdDev.toFixed(2)).padStart(7, ' ')} ${unit}`;

  console.log(formatRow('Doba zápisu', summary.metrics.writeMs, 'ms  '));
  console.log(formatRow('Doba čtení', summary.metrics.readMs, 'ms  '));
  console.log(formatRow('Doba celkem', summary.metrics.totalMs, 'ms  '));
  console.log(formatRow('Propustnost zápisu', summary.metrics.writeThroughputMBps, 'MB/s'));
  console.log(formatRow('Propustnost čtení', summary.metrics.readThroughputMBps, 'MB/s'));
  console.log(formatRow('Operace za sekundu', summary.metrics.totalOpsPerSec, 'op/s'));
  console.log(formatRow('Paměť RSS (po)', summary.metrics.rssAfterMB, 'MB  '));
  console.log('  ──────────────────────────────────────────────────────────────────────');
}

/**
 * Varianta A: Sekvenční proudový zápis pomocí Deno.open() a Web WritableStream
 */
async function denoStreamWriteFile(
  filePath: string,
  chunkBuffer: Uint8Array,
  totalSizeBytes: number
): Promise<number> {
  const file = await Deno.open(filePath, {
    write: true,
    create: true,
    truncate: true
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
  const scenarioDir = joinPath(tempDir, 'large_file_deno');
  const filePath = joinPath(scenarioDir, fileName);
  const totalSizeMB = bytesToMB(totalSizeBytes);

  // Předgenerování 64KB bloku náhodných dat mimo měřenou část
  const chunkBuffer = generateRandomBytes(chunkSizeBytes);

  return {
    id: 'large-file-100mb',
    name: 'Varianta A: Sekvenční streamování (1x 100 MB)',
    description:
      'Sekvenční zápis a čtení jednoho 100MB binárního souboru pomocí Deno.open a Web Streams (64KB bloky).',
    config: {
      totalSizeBytes,
      totalSizeMB: round(totalSizeMB, 2),
      chunkSizeBytes,
      fileCount: 1
    },

    async setup() {
      await ensureCleanDir(scenarioDir);
    },

    async runIteration(iterationIndex: number): Promise<IterationMetrics> {
      await removeSafe(filePath);

      const rssBeforeBytes = getRssBytes();

      // 1. Měření streamovaného zápisu
      const writeStart = performance.now();
      const bytesWritten = await denoStreamWriteFile(filePath, chunkBuffer, totalSizeBytes);
      const writeEnd = performance.now();
      const rssAfterWriteBytes = getRssBytes();

      // 2. Měření streamovaného čtení
      const readStart = performance.now();
      const bytesRead = await denoStreamReadFile(filePath);
      const readEnd = performance.now();
      const rssAfterBytes = getRssBytes();

      if (bytesWritten !== totalSizeBytes || bytesRead !== totalSizeBytes) {
        throw new Error(
          `Nekonzistentní velikost přenesených dat: zapsáno=${bytesWritten}, přečteno=${bytesRead}, očekáváno=${totalSizeBytes}`
        );
      }

      // Úklid po iteraci mimo měřený čas
      await removeSafe(filePath);

      const writeMs = writeEnd - writeStart;
      const readMs = readEnd - readStart;
      const totalMs = writeMs + readMs;

      const writeSec = writeMs / 1000;
      const readSec = readMs / 1000;
      const totalSec = totalMs / 1000;

      return {
        iteration: iterationIndex,
        bytesProcessed: totalSizeBytes,
        writeMs: round(writeMs, 3),
        readMs: round(readMs, 3),
        totalMs: round(totalMs, 3),
        writeThroughputMBps: round(totalSizeMB / writeSec, 3),
        readThroughputMBps: round(totalSizeMB / readSec, 3),
        totalThroughputMBps: round((totalSizeMB * 2) / totalSec, 3),
        writeOpsPerSec: round(1 / writeSec, 3),
        readOpsPerSec: round(1 / readSec, 3),
        totalOpsPerSec: round(2 / totalSec, 3),
        rssBeforeBytes,
        rssAfterWriteBytes,
        rssAfterBytes,
        rssBeforeMB: round(bytesToMB(rssBeforeBytes), 2),
        rssAfterWriteMB: round(bytesToMB(rssAfterWriteBytes), 2),
        rssAfterMB: round(bytesToMB(rssAfterBytes), 2),
        rssDeltaMB: round(bytesToMB(rssAfterBytes - rssBeforeBytes), 2)
      };
    },

    async cleanup() {
      await removeSafe(scenarioDir);
    }
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
  const scenarioDir = joinPath(tempDir, `${subDir}_deno`);
  const totalSizeBytes = fileCount * fileSizeBytes;
  const totalSizeMB = bytesToMB(totalSizeBytes);

  // Předgenerování 4KB náhodného bufferu a cest mimo měřený čas
  const fileBuffer = generateRandomBytes(fileSizeBytes);
  const filePaths = Array.from({ length: fileCount }, (_, i) =>
    joinPath(scenarioDir, `small_${String(i).padStart(4, '0')}.bin`)
  );

  return {
    id: 'small-files-1000x4kb',
    name: 'Varianta B: Systémová režie – Malé soubory (1 000x 4 KB)',
    description:
      'Paralelní zápis a následné čtení 1 000 souborů o velikosti 4 KB pomocí Deno.writeFile a Deno.readFile.',
    config: {
      fileCount,
      fileSizeBytes,
      totalSizeBytes,
      totalSizeMB: round(totalSizeMB, 2)
    },

    async setup() {
      await ensureCleanDir(scenarioDir);
    },

    async runIteration(iterationIndex: number): Promise<IterationMetrics> {
      await ensureCleanDir(scenarioDir);

      const rssBeforeBytes = getRssBytes();

      // 1. Měření paralelního zápisu 1 000 souborů
      const writeStart = performance.now();
      await Promise.all(filePaths.map((filePath) => Deno.writeFile(filePath, fileBuffer)));
      const writeEnd = performance.now();
      const rssAfterWriteBytes = getRssBytes();

      // 2. Měření paralelního čtení 1 000 souborů
      const readStart = performance.now();
      const buffers = await Promise.all(filePaths.map((filePath) => Deno.readFile(filePath)));
      const readEnd = performance.now();
      const rssAfterBytes = getRssBytes();

      let bytesRead = 0;
      for (let i = 0; i < buffers.length; i++) {
        bytesRead += buffers[i].byteLength;
      }

      if (bytesRead !== totalSizeBytes) {
        throw new Error(
          `Nekonzistentní velikost přečtených dat: přečteno=${bytesRead}, očekáváno=${totalSizeBytes}`
        );
      }

      // Úklid všech 1 000 souborů mimo měřený čas
      await removeSafe(scenarioDir);

      const writeMs = writeEnd - writeStart;
      const readMs = readEnd - readStart;
      const totalMs = writeMs + readMs;

      const writeSec = writeMs / 1000;
      const readSec = readMs / 1000;
      const totalSec = totalMs / 1000;

      return {
        iteration: iterationIndex,
        fileCount,
        bytesProcessed: totalSizeBytes,
        writeMs: round(writeMs, 3),
        readMs: round(readMs, 3),
        totalMs: round(totalMs, 3),
        writeThroughputMBps: round(totalSizeMB / writeSec, 3),
        readThroughputMBps: round(totalSizeMB / readSec, 3),
        totalThroughputMBps: round((totalSizeMB * 2) / totalSec, 3),
        writeOpsPerSec: round(fileCount / writeSec, 2),
        readOpsPerSec: round(fileCount / readSec, 2),
        totalOpsPerSec: round((fileCount * 2) / totalSec, 2),
        rssBeforeBytes,
        rssAfterWriteBytes,
        rssAfterBytes,
        rssBeforeMB: round(bytesToMB(rssBeforeBytes), 2),
        rssAfterWriteMB: round(bytesToMB(rssAfterWriteBytes), 2),
        rssAfterMB: round(bytesToMB(rssAfterBytes), 2),
        rssDeltaMB: round(bytesToMB(rssAfterBytes - rssBeforeBytes), 2)
      };
    },

    async cleanup() {
      await removeSafe(scenarioDir);
    }
  };
}

function buildScenarioSummary(
  scenario: { id: string; name: string; description: string; config: Record<string, unknown> },
  rawIterations: IterationMetrics[],
  warmupIterations: number
) {
  const metricKeys: (keyof IterationMetrics)[] = [
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

  const metricsSummary: Record<string, StatSummary> = {};
  for (const key of metricKeys) {
    const values = rawIterations.map((item) => Number(item[key]));
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

async function loadConfig(projectRoot: string): Promise<BenchmarkConfig> {
  const configPath = joinPath(projectRoot, 'config.json');
  const raw = await Deno.readTextFile(configPath);
  const config: BenchmarkConfig = JSON.parse(raw);

  for (const arg of Deno.args) {
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

async function main() {
  const projectRoot = Deno.cwd();
  const config = await loadConfig(projectRoot);
  const environment = getEnvironmentMetadata();
  const tempDir = joinPath(projectRoot, config.tempDir);
  const resultsDir = joinPath(projectRoot, config.resultsDir);

  logSection(
    `BENCHMARK KATEGORIE 2: SOUBOROVÉ I/O OPERACE (${environment.runtime.toUpperCase()} ${environment.version})`
  );
  logInfo(
    `Platforma: ${environment.platform} (${environment.arch}) | Jádra CPU: ${environment.cpuCores} | RAM: ${environment.totalMemoryMB} MB`
  );
  logInfo(
    `Konfigurace: Warmup = ${config.benchmark.warmupIterations}, Iterace N = ${config.benchmark.measuredIterations}`
  );

  await ensureCleanDir(tempDir);

  const scenarios = [];
  if (config.scenarios.largeFile?.enabled) {
    scenarios.push(
      createLargeFileScenarioDeno({
        tempDir,
        ...config.scenarios.largeFile
      })
    );
  }
  if (config.scenarios.smallFiles?.enabled) {
    scenarios.push(
      createSmallFilesScenarioDeno({
        tempDir,
        ...config.scenarios.smallFiles
      })
    );
  }

  const allRawScenarios: Record<string, unknown> = {};
  const allSummaryScenarios: Record<string, unknown> = {};

  try {
    for (const scenario of scenarios) {
      logSection(scenario.name);
      logInfo(`Popis: ${scenario.description}`);
      logInfo(
        `Zahřívací fáze (Warmup): ${config.benchmark.warmupIterations} cyklů | Měřené iterace: N = ${config.benchmark.measuredIterations}`
      );

      await scenario.setup();
      try {
        for (let w = 1; w <= config.benchmark.warmupIterations; w++) {
          const warmupMetrics = await scenario.runIteration(w);
          logIteration('WARMUP', w, config.benchmark.warmupIterations, warmupMetrics);
        }

        console.log('  ----------------------------------------------------------------------');

        const rawResults: IterationMetrics[] = [];
        for (let i = 1; i <= config.benchmark.measuredIterations; i++) {
          const metrics = await scenario.runIteration(i);
          rawResults.push(metrics);
          logIteration('RUN', i, config.benchmark.measuredIterations, metrics);
        }

        const summary = buildScenarioSummary(
          scenario,
          rawResults,
          config.benchmark.warmupIterations
        );
        logScenarioSummary(scenario.name, summary);

        allRawScenarios[scenario.id] = {
          scenarioId: scenario.id,
          name: scenario.name,
          config: scenario.config,
          warmupIterations: config.benchmark.warmupIterations,
          measuredIterations: config.benchmark.measuredIterations,
          iterations: rawResults
        };
        allSummaryScenarios[scenario.id] = summary;
      } finally {
        await scenario.cleanup();
      }
    }
  } finally {
    await ensureCleanDir(tempDir);
  }

  await Deno.mkdir(resultsDir, { recursive: true });
  const rawFilePath = joinPath(resultsDir, 'file_io_raw_deno.json');
  const summaryFilePath = joinPath(resultsDir, 'file_io_summary_deno.json');

  await Deno.writeTextFile(
    rawFilePath,
    JSON.stringify(
      {
        category: config.category,
        environment,
        benchmarkConfig: config.benchmark,
        scenarios: allRawScenarios
      },
      null,
      2
    )
  );

  await Deno.writeTextFile(
    summaryFilePath,
    JSON.stringify(
      {
        category: config.category,
        environment,
        benchmarkConfig: config.benchmark,
        scenarios: allSummaryScenarios
      },
      null,
      2
    )
  );

  logSection('BENCHMARK DENO DOKONČEN');
  logInfo(`Surová data (N = ${config.benchmark.measuredIterations}) uložena do: ${rawFilePath}`);
  logInfo(`Agregované statistiky (p50, p95, p99, Ø, σ) uloženy do: ${summaryFilePath}`);
}

main().catch((err) => {
  console.error('\n[CHYBA BENCHMARKU DENO]:', err);
  Deno.exit(1);
});

