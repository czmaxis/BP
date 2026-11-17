/**
 * Benchmark Kategorie 3: CPU-náročné úlohy – Nativní spouštěč pro Bun
 *
 * Všechna tři prostředí (Node.js, Deno, Bun) vykonávají naprosto identické
 * výpočetní algoritmy ze sdíleného modulu `core/cpu-workloads.js`:
 * - Varianta A: Kryptografické hashování (WebCrypto PBKDF2-SHA512 + SHA-512/SHA-256)
 * - Varianta B: Polymorfní JSON transformace, filtrace a řazení (10 000 záznamů)
 * - Varianta C: Numerické násobení hustých matic (250×250 Float64Array)
 *
 * Spuštění:
 *   bun run scenarios/03-cpu/bun.ts
 */

import { runCpuBenchmarkSuite } from "../../core/cpu-runner.js";

runCpuBenchmarkSuite({ projectRoot: process.cwd() }).catch((err) => {
  console.error("\n[CHYBA CPU BENCHMARKU BUN]:", err);
  process.exit(1);
});
