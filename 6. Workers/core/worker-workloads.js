/**
 * Sdílené šablony scénářů pro Kategorii 6: Paralelní zpracování (06-workers).
 *
 * Implementuje tři varianty měřící odlišné aspekty paralelismu:
 * 1. Varianta A (spawn-overhead): Čistá režie vytvoření W=4 vláken, výměny ping/pong a ukončení vláken.
 * 2. Varianta B (message-passing): Paralelní výpočet nad 16MB blokem předávaným přes postMessage (Structured Clone).
 * 3. Varianta C (shared-memory): Tentýž paralelní výpočet nad 16MB SharedArrayBuffer + Atomics (zero-copy).
 *
 * Varianty B a C vykonávají nad stejnými vstupními daty naprosto identickou matematickou transformaci,
 * takže produkují bitově shodný kontrolní součet (checksum) a jejich porovnání přímo izoluje
 * režii serializace/kopírování dat (Structured Clone) oproti sdílené paměti (SharedArrayBuffer).
 */

import { consumeBlackhole, round, bytesToMB } from "./stats.js";

/**
 * Deterministický 32bitový pseudonáhodný generátor (Mulberry32).
 */
export function createSeededPrng(seed = 0x20260601) {
  let state = seed >>> 0;
  return function nextUint32() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/**
 * Vygeneruje deterministický základní obraz 16MB celočíselného pole (Int32Array).
 *
 * @param {number} totalElements Počet 32bitových prvků (např. 4 194 304 pro 16 MB)
 * @param {number} [seed=0x60616263]
 * @returns {Int32Array}
 */
export function createBaseInt32Dataset(totalElements, seed = 0x60616263) {
  const prng = createSeededPrng(seed);
  const arr = new Int32Array(totalElements);
  for (let i = 0; i < totalElements; i++) {
    arr[i] = prng() | 0;
  }
  return arr;
}

/**
 * Deterministicky připraví vstupní pole před měřenou iterací `stepIndex`.
 *
 * @param {Int32Array} target Cílové pole (v RAM nebo v SharedArrayBuffer)
 * @param {Int32Array} base Základní seedované pole
 * @param {number} stepIndex Index iterace
 */
export function prepareDatasetForIteration(target, base, stepIndex) {
  target.set(base);
  const len = target.length;
  const stride = 257;
  const delta = Math.imul(stepIndex, 0x01000193) | 0;
  for (let i = stepIndex % stride; i < len; i += stride) {
    target[i] = (base[i] ^ (delta + i)) | 0;
  }
}

/**
 * Odešle zprávu workeru a vrátí Promise, který se vyřeší při přijetí odpovědi.
 */
function requestWorker(adapter, worker, message) {
  return new Promise((resolve, reject) => {
    adapter.onceMessage(worker, resolve, reject);
    adapter.postMessage(worker, message);
  });
}

/**
 * ============================================================================
 * VARIANTA A: Režie vytváření a ukončení vláken (spawn-overhead)
 * ============================================================================
 */
export function createSpawnOverheadScenario({
  workerCount = 4,
  adapter,
  driverLabel,
}) {
  let currentToken = 0;

  return {
    id: "workers-spawn-overhead",
    name: `Varianta A: Režie vytváření a ukončení vláken (${workerCount}× Worker)`,
    description: `Spuštění ${workerCount} pracovních vláken (${driverLabel}), výměna zprávy "ping" -> "pong" a korektní ukončení všech vláken (worker.terminate()).`,
    config: {
      workerCount,
      bytesProcessed: 0,
    },

    async setup() {
      currentToken = 0;
    },

    prepareIteration(stepIndex) {
      currentToken = (0x10203040 ^ Math.imul(stepIndex, 16777619)) | 0;
    },

    async runIteration() {
      const workers = new Array(workerCount);
      const tasks = new Array(workerCount);

      for (let w = 0; w < workerCount; w++) {
        const worker = adapter.spawnWorker();
        workers[w] = worker;
        tasks[w] = requestWorker(adapter, worker, {
          type: "ping",
          text: "ping",
          workerIndex: w,
          token: currentToken,
        });
      }

      const responses = await Promise.all(tasks);
      await Promise.all(workers.map((w) => adapter.terminateWorker(w)));

      let checksum = currentToken;
      for (let w = 0; w < workerCount; w++) {
        const resp = responses[w];
        if (resp.text !== "pong" || resp.workerIndex !== w) {
          throw new Error(`Neplatná odpověď workeru #${w}: ${JSON.stringify(resp)}`);
        }
        checksum = (Math.imul(checksum, 31) + (resp.checksum | 0)) | 0;
      }

      if (checksum === 0) checksum = 1;
      consumeBlackhole(checksum);

      return {
        checksum,
        bytesProcessed: 0,
      };
    },

    async cleanup() {
      // Vlákna u Varianty A jsou ukončena v každé iteraci
    },
  };
}

/**
 * ============================================================================
 * VARIANTA B: Paralelní CPU úloha přes předávání zpráv (message-passing / Structured Clone)
 * ============================================================================
 */
export function createMessagePassingScenario({
  workerCount = 4,
  totalBytes = 16 * 1024 * 1024,
  computeRounds = 6,
  adapter,
  driverLabel,
}) {
  const totalElements = Math.floor(totalBytes / 4);
  const elementsPerWorker = Math.floor(totalElements / workerCount);
  const actualTotalElements = elementsPerWorker * workerCount;
  const actualTotalBytes = actualTotalElements * 4;

  const baseDataset = createBaseInt32Dataset(actualTotalElements, 0x60616263);
  const stagingDataset = new Int32Array(actualTotalElements);
  const workerSlices = Array.from(
    { length: workerCount },
    () => new Int32Array(elementsPerWorker),
  );

  let pool = [];

  return {
    id: "workers-message-passing",
    name: `Varianta B: Paralelní výpočet přes postMessage – Structured Clone (${round(bytesToMB(actualTotalBytes), 0)} MB, ${workerCount}× Worker)`,
    description: `Rozdělení ${round(bytesToMB(actualTotalBytes), 0)}MB bloku na ${workerCount} části po ${round(bytesToMB(actualTotalBytes / workerCount), 0)} MB, kopírování přes postMessage (Structured Clone), paralelní transformace (${computeRounds} průchodů) a návrat výsledků (${driverLabel}).`,
    config: {
      workerCount,
      totalBytes: actualTotalBytes,
      totalMB: round(bytesToMB(actualTotalBytes), 2),
      computeRounds,
      transferMechanism: "StructuredClone",
    },

    async setup() {
      pool = Array.from({ length: workerCount }, () => adapter.spawnWorker());
      // Ověření připravenosti poolu před měřením
      await Promise.all(
        pool.map((worker, w) =>
          requestWorker(adapter, worker, {
            type: "ping",
            text: "ping",
            workerIndex: w,
            token: 1,
          }),
        ),
      );
    },

    prepareIteration(stepIndex) {
      prepareDatasetForIteration(stagingDataset, baseDataset, stepIndex);
      for (let w = 0; w < workerCount; w++) {
        const start = w * elementsPerWorker;
        workerSlices[w].set(
          stagingDataset.subarray(start, start + elementsPerWorker),
        );
      }
    },

    async runIteration(stepIndex) {
      const promises = new Array(workerCount);
      for (let w = 0; w < workerCount; w++) {
        promises[w] = requestWorker(adapter, pool[w], {
          type: "compute-clone",
          workerIndex: w,
          stepIndex,
          rounds: computeRounds,
          payload: workerSlices[w],
        });
      }

      const results = await Promise.all(promises);

      let checksum = (stepIndex * 0x45d9f3b) | 0;
      for (let w = 0; w < workerCount; w++) {
        const res = results[w];
        const outSlice = res.resultSlice;
        const firstVal = outSlice[0] | 0;
        const lastVal = outSlice[outSlice.length - 1] | 0;
        checksum =
          (Math.imul(checksum, 31) + (res.checksum | 0) + firstVal + lastVal) | 0;
      }

      if (checksum === 0) checksum = 1;
      consumeBlackhole(checksum);

      return {
        checksum,
        bytesProcessed: actualTotalBytes,
      };
    },

    async cleanup() {
      if (pool.length > 0) {
        await Promise.all(pool.map((w) => adapter.terminateWorker(w)));
        pool = [];
      }
    },
  };
}

/**
 * ============================================================================
 * VARIANTA C: Paralelní CPU úloha se sdílenou pamětí (SharedArrayBuffer + Atomics)
 * ============================================================================
 */
export function createSharedMemoryScenario({
  workerCount = 4,
  totalBytes = 16 * 1024 * 1024,
  computeRounds = 6,
  adapter,
  driverLabel,
}) {
  const totalElements = Math.floor(totalBytes / 4);
  const elementsPerWorker = Math.floor(totalElements / workerCount);
  const actualTotalElements = elementsPerWorker * workerCount;
  const actualTotalBytes = actualTotalElements * 4;

  const baseDataset = createBaseInt32Dataset(actualTotalElements, 0x60616263);
  const dataSab = new SharedArrayBuffer(actualTotalBytes);
  const sharedInt32View = new Int32Array(dataSab);

  // Řídicí SharedArrayBuffer: index 0 = atomický čítač dokončených vláken, indexy 1..W = dílčí checksumy
  const syncSab = new SharedArrayBuffer((workerCount + 2) * 4);
  const syncInt32View = new Int32Array(syncSab);

  let pool = [];

  return {
    id: "workers-shared-memory",
    name: `Varianta C: Paralelní výpočet se sdílenou pamětí – SharedArrayBuffer (${round(bytesToMB(actualTotalBytes), 0)} MB, ${workerCount}× Worker)`,
    description: `Paralelní transformace téhož ${round(bytesToMB(actualTotalBytes), 0)}MB bloku (${computeRounds} průchodů) přímo ve sdíleném SharedArrayBuffer se synchronizací přes Atomics bez kopírování dat (${driverLabel}).`,
    config: {
      workerCount,
      totalBytes: actualTotalBytes,
      totalMB: round(bytesToMB(actualTotalBytes), 2),
      computeRounds,
      transferMechanism: "SharedArrayBuffer+Atomics",
    },

    async setup() {
      pool = Array.from({ length: workerCount }, () => adapter.spawnWorker());
      await Promise.all(
        pool.map((worker, w) =>
          requestWorker(adapter, worker, {
            type: "init-sab",
            workerIndex: w,
            dataSab,
            syncSab,
          }),
        ),
      );
    },

    prepareIteration(stepIndex) {
      prepareDatasetForIteration(sharedInt32View, baseDataset, stepIndex);
      syncInt32View.fill(0);
    },

    async runIteration(stepIndex) {
      const promises = new Array(workerCount);
      for (let w = 0; w < workerCount; w++) {
        const startIdx = w * elementsPerWorker;
        promises[w] = requestWorker(adapter, pool[w], {
          type: "compute-sab",
          workerIndex: w,
          startIdx,
          length: elementsPerWorker,
          stepIndex,
          rounds: computeRounds,
        });
      }

      await Promise.all(promises);

      const completed = Atomics.load(syncInt32View, 0);
      if (completed !== workerCount) {
        throw new Error(
          `Neúplná synchronizace Atomics: dokončeno=${completed}, očekáváno=${workerCount}`,
        );
      }

      let checksum = (stepIndex * 0x45d9f3b) | 0;
      for (let w = 0; w < workerCount; w++) {
        const startIdx = w * elementsPerWorker;
        const endIdx = startIdx + elementsPerWorker - 1;
        const workerChecksum = Atomics.load(syncInt32View, w + 1);
        const firstVal = sharedInt32View[startIdx] | 0;
        const lastVal = sharedInt32View[endIdx] | 0;
        checksum =
          (Math.imul(checksum, 31) + workerChecksum + firstVal + lastVal) | 0;
      }

      if (checksum === 0) checksum = 1;
      consumeBlackhole(checksum);

      return {
        checksum,
        bytesProcessed: actualTotalBytes,
      };
    },

    async cleanup() {
      if (pool.length > 0) {
        await Promise.all(pool.map((w) => adapter.terminateWorker(w)));
        pool = [];
      }
    },
  };
}
