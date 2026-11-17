/**
 * Benchmark Kategorie 6: Paralelní zpracování (Worker Threads) – Bun (Web Workers API)
 *
 * Využívá standardní Web Workers API (`new Worker(new URL('./bun-worker.ts', import.meta.url).href)`).
 *
 * Spuštění:
 *   bun run scenarios/06-workers/bun.ts
 */

import { runWorkersBenchmarkSuite } from "../../core/worker-runner.js";

const workerUrl = new URL("./bun-worker.ts", import.meta.url).href;

const bunWorkerAdapter = {
  spawnWorker() {
    return new Worker(workerUrl);
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
      onReject(new Error(err.message || "Bun Worker error"));
    };
  },
  async terminateWorker(worker: Worker) {
    worker.terminate();
  },
};

runWorkersBenchmarkSuite({
  projectRoot: process.cwd(),
  adapter: bunWorkerAdapter,
  driverLabel: "Web Workers API (Bun Worker)",
}).catch((err) => {
  console.error("\n[CHYBA WORKER BENCHMARKU BUN]:", err);
  process.exit(1);
});
