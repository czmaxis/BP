import { readFile, writeFile } from 'node:fs/promises';
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
 * Varianta B: Systémová režie – Malé soubory (1 000 x 4 KB).
 * Měří režii systémových volání (open/write/close/read), práci s metadaty FS
 * a propustnost interního thread poolu knihovny libuv při paralelních operacích.
 *
 * @param {object} options
 * @param {string} options.tempDir Cesta k dočasnému adresáři
 * @param {number} options.fileCount Počet malých souborů (1 000)
 * @param {number} options.fileSizeBytes Velikost každého souboru v bajtech (4 096 B)
 * @param {string} options.subDir Podadresář pro malé soubory
 */
export function createSmallFilesScenario({
  tempDir,
  fileCount = 1000,
  fileSizeBytes = 4096,
  subDir = 'small_files'
}) {
  const scenarioDir = path.resolve(tempDir, subDir);
  const totalSizeBytes = fileCount * fileSizeBytes;
  const totalSizeMB = bytesToMB(totalSizeBytes);

  // Předgenerování 4KB náhodného bufferu a cest k souborům mimo měřený interval
  const fileBuffer = generateRandomBuffer(fileSizeBytes);
  const filePaths = Array.from({ length: fileCount }, (_, i) =>
    path.join(scenarioDir, `small_${String(i).padStart(4, '0')}.bin`)
  );

  return {
    id: 'small-files-1000x4kb',
    name: 'Varianta B: Systémová režie – Malé soubory (1 000x 4 KB)',
    description:
      'Paralelní zápis a následné čtení 1 000 souborů o velikosti 4 KB pomocí node:fs/promises.',
    config: {
      fileCount,
      fileSizeBytes,
      totalSizeBytes,
      totalSizeMB: round(totalSizeMB, 2)
    },

    async setup() {
      await ensureCleanDir(scenarioDir);
    },

    async runIteration(iterationIndex) {
      // Čistý adresář před každou iterací
      await ensureCleanDir(scenarioDir);

      const rssBeforeBytes = getRssBytes();

      // 1. Měření paralelního zápisu 1 000 souborů
      const writeStart = performance.now();
      await Promise.all(filePaths.map((filePath) => writeFile(filePath, fileBuffer)));
      const writeEnd = performance.now();
      const rssAfterWriteBytes = getRssBytes();

      // 2. Měření paralelního čtení 1 000 souborů
      const readStart = performance.now();
      const buffers = await Promise.all(filePaths.map((filePath) => readFile(filePath)));
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

      // Úklid všech 1 000 souborů mimo měřený čas operace
      await removeSafe(scenarioDir);

      const writeMs = writeEnd - writeStart;
      const readMs = readEnd - readStart;
      const totalMs = writeMs + readMs;

      const writeSec = writeMs / 1000;
      const readSec = readMs / 1000;
      const totalSec = totalMs / 1000;

      // Počet souborových operací za sekundu (1 000 zápisů, 1 000 čtení, 2 000 celkem)
      const writeOpsPerSec = fileCount / writeSec;
      const readOpsPerSec = fileCount / readSec;
      const totalOpsPerSec = (fileCount * 2) / totalSec;

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
        writeOpsPerSec: round(writeOpsPerSec, 2),
        readOpsPerSec: round(readOpsPerSec, 2),
        totalOpsPerSec: round(totalOpsPerSec, 2),
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

