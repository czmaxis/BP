/**
 * Benchmark Kategorie 2: Souborové I/O operace – Nativní implementace pro Deno
 *
 * Využívá sdílené šablony z core/scenario-templates.js a core/logger.js a nativní I/O API prostředí Deno:
 * - Varianta A (100 MB): Deno.open() + file.write(chunk) pro zápis a file.read(buf) pro čtení
 * - Varianta B (1 000 x 4 KB): Deno.writeFile() a Deno.readFile() v Promise.all
 *
 * Spuštění:
 *   deno run --allow-read --allow-write --allow-sys scenarios/02-file-io/deno.ts
 */

import {
  createLargeFileScenarioTemplate,
  createSmallFilesScenarioTemplate,
} from "../../core/scenario-templates.js";
import { consumeBlackhole } from "../../core/stats.js";
import { runFileIoBenchmarkSuite } from "../../core/logger.js";

/**
 * Varianta A: Sekvenční proudový zápis po 64KB blocích pomocí Deno.open() a přímého file.write(chunk)
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

  let bytesWritten = 0;

  try {
    while (bytesWritten < totalSizeBytes) {
      const remaining = totalSizeBytes - bytesWritten;
      const chunk =
        remaining >= chunkBuffer.byteLength
          ? chunkBuffer
          : chunkBuffer.subarray(0, remaining);

      let offset = 0;
      while (offset < chunk.byteLength) {
        offset += await file.write(
          offset === 0 ? chunk : chunk.subarray(offset),
        );
      }
      bytesWritten += chunk.byteLength;
    }

    return bytesWritten;
  } finally {
    file.close();
  }
}

/**
 * Varianta A: Sekvenční čtení po blocích o velikosti chunkSizeBytes pomocí Deno.open() a file.read(buf)
 */
async function denoStreamReadFile(
  filePath: string,
  chunkSizeBytes: number,
  preallocatedBuf?: Uint8Array,
): Promise<number> {
  const buf =
    preallocatedBuf && preallocatedBuf.byteLength === chunkSizeBytes
      ? preallocatedBuf
      : new Uint8Array(chunkSizeBytes);
  const file = await Deno.open(filePath, { read: true });
  let bytesRead = 0;
  let checksum = 0;

  try {
    while (true) {
      const n = await file.read(buf);
      if (n === null || n === 0) break;
      bytesRead += n;
      checksum = (Math.imul(checksum, 31) + buf[0] + buf[n - 1] + n) | 0;
      buf[0] = 0;
      buf[n - 1] = 0;
    }
    consumeBlackhole(checksum);
    return bytesRead;
  } finally {
    file.close();
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
      "Sekvenční zápis (Deno.open + file.write) a čtení (Deno.open + file.read) jednoho 100MB binárního souboru (64KB bloky).",
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
