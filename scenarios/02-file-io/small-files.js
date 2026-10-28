import { readFile, writeFile } from "node:fs/promises";
import { createSmallFilesScenarioTemplate } from "../../core/scenario-templates.js";

/**
 * Varianta B: Systémová režie – Malé soubory (1 000 x 4 KB) pro Node.js.
 */
export function createSmallFilesScenario(options) {
  return createSmallFilesScenarioTemplate({
    ...options,
    description:
      "Paralelní zápis a následné čtení 1 000 souborů o velikosti 4 KB pomocí node:fs/promises.",
    writeSingleFile: (filePath, fileBuffer) => writeFile(filePath, fileBuffer),
    readSingleFile: (filePath) => readFile(filePath),
  });
}
