/**
 * Benchmark Kategorie 3: CPU-náročné úlohy – Nativní spouštěč pro Deno
 *
 * Všechna tři prostředí (Node.js, Deno, Bun) vykonávají naprosto identické
 * výpočetní algoritmy ze sdíleného modulu `core/cpu-workloads.js`:
 * - Varianta A: Kryptografické hashování (WebCrypto PBKDF2-SHA512 + SHA-512/SHA-256)
 * - Varianta B: Polymorfní JSON transformace, filtrace a řazení (10 000 záznamů)
 * - Varianta C: Numerické násobení hustých matic (250×250 Float64Array)
 *
 * Spuštění:
 *   deno run --allow-read --allow-write --allow-sys scenarios/03-cpu/deno.ts
 */

import { runCpuBenchmarkSuite } from "../../core/cpu-runner.js";

runCpuBenchmarkSuite({ projectRoot: Deno.cwd() }).catch((err) => {
  console.error("\n[CHYBA CPU BENCHMARKU DENO]:", err);
  Deno.exit(1);
});
