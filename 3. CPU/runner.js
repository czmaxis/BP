import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCpuBenchmarkSuite } from "./core/cpu-runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Hlavní spouštěč benchmarku Kategorie 3: CPU-náročné úlohy pro Node.js.
 */
runCpuBenchmarkSuite({
  projectRoot: __dirname,
}).catch((err) => {
  console.error("\n[CHYBA CPU BENCHMARKU NODE]:", err);
  process.exitCode = 1;
});
