/**
 * Benchmark Kategorie 2: Souborové I/O operace – Nativní implementace pro Deno
 *
 * Využívá sdílené šablony z core/scenario-templates.js a core/logger.js a nativní I/O API prostředí Deno:
 * - Varianta A (100 MB): Deno.open() + Web Streams API (file.writable / file.readable)
 * - Varianta B (1 000 x 4 KB): Deno.writeFile() a Deno.readFile() v Promise.all
 *
 * Spuštění:
 *   deno run --allow-read --allow-write --allow-sys scenarios/02-file-io/deno.ts
 */

import {
  createLargeFileScenarioTemplate,
  createSmallFilesScenarioTemplate,
} from "../../core/scenario-templates.js";
import { runFileIoBenchmarkSuite } from "../../core/logger.js";

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
function createLargeFileScenarioDeno(options: Record<string, unknown>) {
  return createLargeFileScenarioTemplate({
    ...options,
    subDir: "large_file_deno",
    description:
      "Sekvenční zápis a čtení jednoho 100MB binárního souboru pomocí Deno.open a Web Streams (64KB bloky).",
    streamWriteFile: denoStreamWriteFile,
    streamReadFile: denoStreamReadFile,
  });
}

/**
 * Vytvoří scénář Varianty B (1 000 malých 4KB souborů) pro Deno.
 */
function createSmallFilesScenarioDeno(options: Record<string, unknown>) {
  return createSmallFilesScenarioTemplate({
    ...options,
    description:
      "Paralelní zápis a následné čtení 1 000 souborů o velikosti 4 KB pomocí Deno.writeFile a Deno.readFile.",
    writeSingleFile: (filePath: string, fileBuffer: Uint8Array) =>
      Deno.writeFile(filePath, fileBuffer),
    readSingleFile: (filePath: string) => Deno.readFile(filePath),
  });
}

runFileIoBenchmarkSuite({
  projectRoot: Deno.cwd(),
  createLargeFileScenario: createLargeFileScenarioDeno,
  createSmallFilesScenario: createSmallFilesScenarioDeno,
}).catch((err) => {
  console.error("\n[CHYBA BENCHMARKU DENO]:", err);
  Deno.exit(1);
});
