/**
 * Benchmark Kategorie 6: Paralelní zpracování (Worker Threads) – Deno (Web Workers API)
 *
 * Využívá standardní Web Workers API (`new Worker(new URL('./deno-worker.ts', import.meta.url).href, { type: 'module' })`).
 *
 * Spuštění:
 *   deno run --allow-read --allow-write --allow-sys scenarios/06-workers/deno.ts
 */

import { runWorkersBenchmarkSuite } from "../../core/worker-runner.js";

const workerUrl = new URL("./deno-worker.ts", import.meta.url).href;

const denoWorkerAdapter = {
  spawnWorker() {
    return new Worker(workerUrl, { type: "module" });
  },
  postMessage(worker: Worker, message: unknown) {
    worker.postMessage(message);
  },
  onceMessage(
    worker: Worker,
    onResolve: (data: unknown) => void,
    onReject: (err: unknown) => void,
  ) {
    worker.onmessage = (event: MessageEvent) => {
      worker.onmessage = null;
      worker.onerror = null;
      onResolve(event.data);
    };
    worker.onerror = (err: ErrorEvent) => {
      worker.onmessage = null;
      worker.onerror = null;
      onReject(new Error(err.message || "Deno Worker error"));
    };
  },
  async terminateWorker(worker: Worker) {
    worker.terminate();
  },
};

runWorkersBenchmarkSuite({
  projectRoot: Deno.cwd(),
  adapter: denoWorkerAdapter,
  driverLabel: "Web Workers API (Deno Worker)",
}).catch((err) => {
  console.error("\n[CHYBA WORKER BENCHMARKU DENO]:", err);
  Deno.exit(1);
});
