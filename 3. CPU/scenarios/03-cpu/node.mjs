/**
 * Benchmark Kategorie 3: CPU-náročné úlohy – Nativní spouštěč pro Node.js
 *
 * Všechna tři prostředí (Node.js, Deno, Bun) vykonávají naprosto identické
 * výpočetní algoritmy ze sdíleného modulu `core/cpu-workloads.js`:
 * - Varianta A: Kryptografické hashování (WebCrypto PBKDF2-SHA512 + SHA-512/SHA-256)
 * - Varianta B: Polymorfní JSON transformace, filtrace a řazení (10 000 záznamů)
 * - Varianta C: Numerické násobení hustých matic (250×250 Float64Array)
 *
 * Spuštění:
 *   node scenarios/03-cpu/node.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCpuBenchmarkSuite } from "../../core/cpu-runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");

runCpuBenchmarkSuite({ projectRoot }).catch((err) => {
  console.error("\n[CHYBA CPU BENCHMARKU NODE]:", err);
  process.exitCode = 1;
});
