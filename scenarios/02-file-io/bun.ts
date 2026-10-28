/**
 * Benchmark Kategorie 2: Souborové I/O operace – Nativní implementace pro Bun
 *
 * Využívá sdílené šablony z core/scenario-templates.js a core/logger.js a nativní I/O API prostředí Bun:
 * - Varianta A (100 MB): Bun.file(path).writer({ highWaterMark }) (FileSink) + fs.promises.open (fileHandle.read)
 * - Varianta B (1 000 x 4 KB): Bun.write(path, buffer) + Bun.file(path).bytes() v Promise.all
 *
 * Spuštění:
 *   bun run scenarios/02-file-io/bun.ts
 */

import { open } from "node:fs/promises";
import {
  createLargeFileScenarioTemplate,
  createSmallFilesScenarioTemplate,
} from "../../core/scenario-templates.js";
import { consumeBlackhole } from "../../core/stats.js";
import { runFileIoBenchmarkSuite } from "../../core/logger.js";

/**
 * Varianta A: Sekvenční proudový zápis pomocí nativního FileSink (Bun.file(path).writer)
 */
async function bunStreamWriteFile(
  filePath: string,
  chunkBuffer: Uint8Array,
  totalSizeBytes: number,
): Promise<number> {
  const chunkSizeBytes = chunkBuffer.byteLength;
  const writer = Bun.file(filePath).writer({ highWaterMark: chunkSizeBytes });
  let bytesWritten = 0;

  try {
    while (bytesWritten < totalSizeBytes) {
      const remaining = totalSizeBytes - bytesWritten;
      const chunk =
        remaining >= chunkSizeBytes
          ? chunkBuffer
          : chunkBuffer.subarray(0, remaining);

      const writeResult = writer.write(chunk);
      if (writeResult instanceof Promise) {
        await writeResult;
      }
      bytesWritten += chunk.byteLength;
    }

    await writer.end();
    return bytesWritten;
  } catch (err) {
    try {
      await writer.end();
    } catch {
      // Ignorujeme při úklidu po chybě
    }
    throw err;
  }
}

/**
 * Varianta A: Sekvenční čtení po blocích o velikosti chunkSizeBytes pomocí file descriptoru (fs.promises.open)
 */
async function bunStreamReadFile(
  filePath: string,
  chunkSizeBytes: number,
  preallocatedBuf?: Buffer,
): Promise<number> {
  const buf =
    preallocatedBuf && preallocatedBuf.byteLength === chunkSizeBytes
      ? preallocatedBuf
      : Buffer.allocUnsafe(chunkSizeBytes);
  const fileHandle = await open(filePath, "r");
  let totalBytesRead = 0;
  let checksum = 0;

  try {
    while (true) {
      const { bytesRead } = await fileHandle.read(buf, 0, chunkSizeBytes, null);
      if (bytesRead === 0) break;
      totalBytesRead += bytesRead;
      checksum =
        (Math.imul(checksum, 31) + buf[0] + buf[bytesRead - 1] + bytesRead) | 0;
      buf[0] = 0;
      buf[bytesRead - 1] = 0;
    }
    consumeBlackhole(checksum);
    return totalBytesRead;
  } finally {
    await fileHandle.close();
  }
}

/**
 * Vytvoří scénář Varianty A (Velký 100MB soubor) pro Bun.
 */
function createLargeFileScenarioBun(options: Record<string, unknown>) {
  return createLargeFileScenarioTemplate({
    ...options,
    subDir: "large_file_bun",
    description:
      "Sekvenční zápis (Bun.file().writer() FileSink) a čtení (fs.promises.open + fileHandle.read) jednoho 100MB binárního souboru (64KB bloky).",
    streamWriteFile: bunStreamWriteFile,
    streamReadFile: bunStreamReadFile,
  });
}

/**
 * Vytvoří scénář Varianty B (1 000 malých 4KB souborů) pro Bun.
 */
function createSmallFilesScenarioBun(options: Record<string, unknown>) {
  return createSmallFilesScenarioTemplate({
    ...options,
    description:
      "Paralelní zápis a následné čtení 1 000 souborů o velikosti 4 KB pomocí Bun.write() a Bun.file().bytes().",
    writeSingleFile: (filePath: string, fileBuffer: Uint8Array) =>
      Bun.write(filePath, fileBuffer),
    readSingleFile: (filePath: string) => Bun.file(filePath).bytes(),
  });
}

runFileIoBenchmarkSuite({
  projectRoot: process.cwd(),
  createLargeFileScenario: createLargeFileScenarioBun,
  createSmallFilesScenario: createSmallFilesScenarioBun,
}).catch((err) => {
  console.error("\n[CHYBA BENCHMARKU BUN]:", err);
  process.exit(1);
});
