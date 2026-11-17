import { open } from "node:fs/promises";
import { createLargeFileScenarioTemplate } from "../../core/scenario-templates.js";
import { consumeBlackhole } from "../../core/stats.js";

/**
 * Sekvenčně zapíše soubor o zadané velikosti po blocích (64 KB) pomocí nízkoúrovňového
 * file descriptoru (fs.promises.open + fileHandle.write) bez režie EventEmitteru.
 *
 * @param {string} filePath Cesta k výstupnímu souboru
 * @param {Buffer} chunkBuffer Předgenerovaný binární blok (např. 64 KB)
 * @param {number} totalSizeBytes Celková cílová velikost souboru v bajtech (např. 100 MB)
 * @returns {Promise<number>} Počet zapsaných bajtů
 */
async function streamWriteFile(filePath, chunkBuffer, totalSizeBytes) {
  const fileHandle = await open(filePath, "w");
  let bytesWritten = 0;

  try {
    while (bytesWritten < totalSizeBytes) {
      const remaining = totalSizeBytes - bytesWritten;
      const chunkLength = Math.min(chunkBuffer.length, remaining);

      let offset = 0;
      while (offset < chunkLength) {
        const { bytesWritten: written } = await fileHandle.write(
          chunkBuffer,
          offset,
          chunkLength - offset,
        );
        offset += written;
      }
      bytesWritten += chunkLength;
    }

    return bytesWritten;
  } finally {
    await fileHandle.close();
  }
}

/**
 * Sekvenčně přečte celý soubor po blocích o velikosti chunkSizeBytes pomocí file descriptoru (fs.promises.open)
 * do předalokovaného bufferu (architektonicky shodné s Deno a Bun).
 *
 * @param {string} filePath Cesta ke čtenému souboru
 * @param {number} chunkSizeBytes Velikost čtecího bufferu v bajtech
 * @param {Buffer} [preallocatedBuf] Předalokovaný čtecí buffer mimo měřený čas
 * @returns {Promise<number>} Počet přečtených bajtů
 */
async function streamReadFile(filePath, chunkSizeBytes, preallocatedBuf) {
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
 * Varianta A: Sekvenční streamování – Velký soubor (100 MB) pro Node.js.
 */
export function createLargeFileScenario(options) {
  return createLargeFileScenarioTemplate({
    ...options,
    subDir: "large_file_node",
    description:
      "Sekvenční zápis (fs.promises.open + fileHandle.write) a čtení (fs.promises.open + fileHandle.read) jednoho 100MB binárního souboru (64KB bloky).",
    streamWriteFile,
    streamReadFile,
  });
}
