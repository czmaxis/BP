/**
 * Worker skript pro Deno (Web Workers API).
 */

import { handleWorkerTask } from "../../core/worker-tasks.js";

self.onmessage = (event: MessageEvent) => {
  const response = handleWorkerTask(event.data);
  self.postMessage(response);
};
