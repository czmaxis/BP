/**
 * Worker skript pro Node.js (node:worker_threads).
 */

import { parentPort } from "node:worker_threads";
import { handleWorkerTask } from "../../core/worker-tasks.js";

parentPort.on("message", (msg) => {
  const response = handleWorkerTask(msg);
  parentPort.postMessage(response);
});
