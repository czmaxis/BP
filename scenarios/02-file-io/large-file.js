import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";
import { createLargeFileScenarioTemplate } from "../../core/scenario-templates.js";

/**
 * Sekvenčně zapíše soubor o zadané velikosti pomocí Node.js WriteStream se správou zpětného tlaku (backpressure).
 *
 * @param {string} filePath Cesta k výstupnímu souboru
 * @param {Buffer} chunkBuffer Předgenerovaný binární blok (např. 64 KB)
 * @param {number} totalSizeBytes Celková cílová velikost souboru v bajtech (např. 100 MB)
 * @returns {Promise<number>} Počet zapsaných bajtů
 */
async function streamWriteFile(filePath, chunkBuffer, totalSizeBytes) {
  const writeStream = createWriteStream(filePath, {
    highWaterMark: chunkBuffer.length,
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
        await once(writeStream, "drain");
      }
    }

    writeStream.end();
    await once(writeStream, "close");
    return bytesWritten;
  } catch (err) {
    writeStream.destroy();
    throw err;
  }
}

/**
 * Sekvenčně přečte celý soubor pomocí Node.js ReadStream.
 *
 * @param {string} filePath Cesta ke čtenému souboru
 * @param {number} chunkSizeBytes Velikost čtecího bufferu (highWaterMark)
 * @returns {Promise<number>} Počet přečtených bajtů
 */
function streamReadFile(filePath, chunkSizeBytes) {
  return new Promise((resolve, reject) => {
    const readStream = createReadStream(filePath, {
      highWaterMark: chunkSizeBytes,
    });

    let bytesRead = 0;
    readStream.on("data", (chunk) => {
      bytesRead += chunk.length;
    });
    readStream.on("end", () => resolve(bytesRead));
    readStream.on("error", (err) => reject(err));
  });
}

/**
 * Varianta A: Sekvenční streamování – Velký soubor (100 MB) pro Node.js.
 */
export function createLargeFileScenario(options) {
  return createLargeFileScenarioTemplate({
    ...options,
    subDir: "large_file_node",
    description:
      "Sekvenční zápis a čtení jednoho 100MB binárního souboru pomocí Node.js Streams (64KB bloky).",
    streamWriteFile,
    streamReadFile,
  });
}
