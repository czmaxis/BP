/**
 * Benchmark Kategorie 6: Paralelní zpracování (Worker Threads) – Node.js (node:worker_threads)
 *
 * Využívá vestavěný modul `node:worker_threads` (`Worker`, `parentPort`).
 *
 * Spuštění:
 *   node scenarios/06-workers/node.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { runWorkersBenchmarkSuite } from "../../core/worker-runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const workerScriptPath = path.join(__dirname, "node-worker.mjs");

const nodeWorkerAdapter = {
  spawnWorker() {
    return new Worker(workerScriptPath);
  },
  postMessage(worker, message) {
    worker.postMessage(message);
  },
  onceMessage(worker, onResolve, onReject) {
    const handleMsg = (data) => {
      worker.off("error", handleErr);
      onResolve(data);
    };
    const handleErr = (err) => {
      worker.off("message", handleMsg);
      onReject(err);
    };
    worker.once("message", handleMsg);
    worker.once("error", handleErr);
  },
  async terminateWorker(worker) {
    await worker.terminate();
  },
};

runWorkersBenchmarkSuite({
  projectRoot,
  adapter: nodeWorkerAdapter,
  driverLabel: "node:worker_threads (Worker)",
}).catch((err) => {
  console.error("\n[CHYBA WORKER BENCHMARKU NODE]:", err);
  process.exitCode = 1;
});
