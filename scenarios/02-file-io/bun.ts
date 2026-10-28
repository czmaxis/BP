/**
 * Benchmark Kategorie 2: Souborové I/O operace – Nativní implementace pro Bun
 *
 * Využívá sdílené šablony z core/scenario-templates.js a core/logger.js a nativní I/O API prostředí Bun:
 * - Varianta A (100 MB): Bun.write(path, ReadableStream) + Bun.file(path).stream()
 * - Varianta B (1 000 x 4 KB): Bun.write(path, buffer) + Bun.file(path).arrayBuffer() v Promise.all
 *
 * Spuštění:
 *   bun run scenarios/02-file-io/bun.ts
 */

import {
  createLargeFileScenarioTemplate,
  createSmallFilesScenarioTemplate,
} from "../../core/scenario-templates.js";
import { runFileIoBenchmarkSuite } from "../../core/logger.js";

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
function createLargeFileScenarioBun(options: Record<string, unknown>) {
  return createLargeFileScenarioTemplate({
    ...options,
    subDir: "large_file_bun",
    description:
      "Sekvenční zápis a čtení jednoho 100MB binárního souboru pomocí Bun.write(stream) a Bun.file().stream() (64KB bloky).",
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
      "Paralelní zápis a následné čtení 1 000 souborů o velikosti 4 KB pomocí Bun.write() a Bun.file().arrayBuffer().",
    writeSingleFile: (filePath: string, fileBuffer: Uint8Array) =>
      Bun.write(filePath, fileBuffer),
    readSingleFile: (filePath: string) => Bun.file(filePath).arrayBuffer(),
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
