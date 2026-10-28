import path from "node:path";
import { fileURLToPath } from "node:url";
import { runFileIoBenchmarkSuite } from "./core/logger.js";
import { createLargeFileScenario } from "./scenarios/02-file-io/large-file.js";
import { createSmallFilesScenario } from "./scenarios/02-file-io/small-files.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Hlavní spouštěč benchmarku Kategorie 2: Souborové I/O operace pro Node.js.
 */
runFileIoBenchmarkSuite({
  projectRoot: __dirname,
  createLargeFileScenario,
  createSmallFilesScenario,
}).catch((err) => {
  console.error("\n[CHYBA BENCHMARKU NODE]:", err);
  process.exitCode = 1;
});
