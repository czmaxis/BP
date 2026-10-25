import { createReadStream, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  bytesToMB,
  ensureCleanDir,
  generateRandomBuffer,
  getRssBytes,
  removeSafe,
  round
} from '../../core/utils.js';

/**
 * Sekvenčně zapíše soubor o zadané velikosti pomocí WriteStream se správou zpětného tlaku (backpressure).
 *
 * @param {string} filePath Cesta k výstupnímu souboru
 * @param {Buffer} chunkBuffer Předgenerovaný binární blok (např. 64 KB)
 * @param {number} totalSizeBytes Celková cílová velikost souboru v bajtech (např. 100 MB)
 * @returns {Promise<number>} Počet zapsaných bajtů
 */
async function streamWriteFile(filePath, chunkBuffer, totalSizeBytes) {
  const writeStream = createWriteStream(filePath, {
    highWaterMark: chunkBuffer.length
  });

  let bytesWritten = 0;

  try {
    while (bytesWritten < totalSizeBytes) {
      const remaining = totalSizeBytes - bytesWritten;
      const chunk =
        remaining >= chunkBuffer.length
          ? chunkBuffer
          : chunkBuffer.subarray(0, remaining);

      const canContinue = writeStream.write(chunk);
      bytesWritten += chunk.length;

      if (!canContinue) {
        await once(writeStream, 'drain');
      }
    }

    writeStream.end();
    await once(writeStream, 'close');
    return bytesWritten;
  } catch (err) {
    writeStream.destroy();
    throw err;
  }
}

/**
 * Sekvenčně přečte celý soubor pomocí ReadStream.
 *
 * @param {string} filePath Cesta ke čtenému souboru
 * @param {number} chunkSizeBytes Velikost čtecího bufferu (highWaterMark)
 * @returns {Promise<number>} Počet přečtených bajtů
 */
function streamReadFile(filePath, chunkSizeBytes) {
  return new Promise((resolve, reject) => {
    const readStream = createReadStream(filePath, {
      highWaterMark: chunkSizeBytes
    });

    let bytesRead = 0;
    readStream.on('data', (chunk) => {
      bytesRead += chunk.length;
    });
    readStream.on('end', () => resolve(bytesRead));
    readStream.on('error', (err) => reject(err));
  });
}

/**
 * Varianta A: Sekvenční streamování – Velký soubor (100 MB).
 * Měří hrubou propustnost I/O a chování paměti při proudovém zápisu a čtení.
 *
 * @param {object} options
 * @param {string} options.tempDir Cesta k dočasnému adresáři
 * @param {number} options.totalSizeBytes Celková velikost souboru v bajtech (100 MB)
 * @param {number} options.chunkSizeBytes Velikost jednoho bloku proudu v bajtech (64 KB)
 * @param {string} options.fileName Název testovacího souboru
 */
export function createLargeFileScenario({
  tempDir,
  totalSizeBytes = 100 * 1024 * 1024,
  chunkSizeBytes = 64 * 1024,
  fileName = 'large_test_100mb.bin'
}) {
  const scenarioDir = path.resolve(tempDir, 'large_file');
  const filePath = path.join(scenarioDir, fileName);
  const totalSizeMB = bytesToMB(totalSizeBytes);

  // Předgenerování náhodného 64KB chunku mimo měřenou část
  const chunkBuffer = generateRandomBuffer(chunkSizeBytes);

  return {
    id: 'large-file-100mb',
    name: 'Varianta A: Sekvenční streamování (1x 100 MB)',
    description:
      'Sekvenční zápis a čtení jednoho 100MB binárního souboru pomocí Node.js Streams (64KB bloky).',
    config: {
      totalSizeBytes,
      totalSizeMB: round(totalSizeMB, 2),
      chunkSizeBytes,
      fileCount: 1
    },

    async setup() {
      await ensureCleanDir(scenarioDir);
    },

    async runIteration(iterationIndex) {
      // Garantujeme, že před měřením soubor neexistuje
      await removeSafe(filePath);

      const rssBeforeBytes = getRssBytes();

      // 1. Měření streamovaného zápisu
      const writeStart = performance.now();
      const bytesWritten = await streamWriteFile(filePath, chunkBuffer, totalSizeBytes);
      const writeEnd = performance.now();
      const rssAfterWriteBytes = getRssBytes();

      // 2. Měření streamovaného čtení
      const readStart = performance.now();
      const bytesRead = await streamReadFile(filePath, chunkSizeBytes);
      const readEnd = performance.now();
      const rssAfterBytes = getRssBytes();

      if (bytesWritten !== totalSizeBytes || bytesRead !== totalSizeBytes) {
        throw new Error(
          `Nekonzistentní velikost přenesených dat: zapsáno=${bytesWritten}, přečteno=${bytesRead}, očekáváno=${totalSizeBytes}`
        );
      }

      // Úklid po iteraci mimo měřený čas operace
      await removeSafe(filePath);

      const writeMs = writeEnd - writeStart;
      const readMs = readEnd - readStart;
      const totalMs = writeMs + readMs;

      const writeSec = writeMs / 1000;
      const readSec = readMs / 1000;
      const totalSec = totalMs / 1000;

      // 1 soubor zapsán + 1 soubor přečten = 2 souborové operace
      const writeOpsPerSec = 1 / writeSec;
      const readOpsPerSec = 1 / readSec;
      const totalOpsPerSec = 2 / totalSec;

      return {
        iteration: iterationIndex,
        bytesProcessed: totalSizeBytes,
        writeMs: round(writeMs, 3),
        readMs: round(readMs, 3),
        totalMs: round(totalMs, 3),
        writeThroughputMBps: round(totalSizeMB / writeSec, 3),
        readThroughputMBps: round(totalSizeMB / readSec, 3),
        totalThroughputMBps: round((totalSizeMB * 2) / totalSec, 3),
        writeOpsPerSec: round(writeOpsPerSec, 3),
        readOpsPerSec: round(readOpsPerSec, 3),
        totalOpsPerSec: round(totalOpsPerSec, 3),
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

