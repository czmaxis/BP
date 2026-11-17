/**
 * Sdílená výpočetní logika vykonávaná uvnitř pracovních vláken (Workerů)
 * v Node.js (node:worker_threads), Deno (Web Worker) i Bun (Web Worker).
 *
 * Podporuje tři typy zpráv:
 * 1. "ping"          -> Varianta A (spawn-overhead): Vrátí "pong" + deterministický token.
 * 2. "compute-clone" -> Varianta B (message-passing): Provede paralelní transformaci nad
 *                       naklonovaným 4MB blokem (Int32Array), vrátí transformovaný blok + checksum.
 * 3. "init-sab" / "compute-sab" -> Varianta C (shared-memory): Provede tutéž paralelní transformaci
 *                       přímo nad sdíleným `SharedArrayBuffer` bez kopírování dat a zapíše
 *                       kontrolní součet přes `Atomics.store` / `Atomics.add`.
 */

let sharedDataView = null;
let sharedSyncView = null;

/**
 * Deterministická CPU-náročná transformace výseku 32bitového celočíselného pole (Int32Array).
 * Kombinuje nelineární bitové míchání (Murmur3 / SplitMix32 avalanching) a modulární aritmetiku.
 * Používá se identicky ve Variantě B (nad naklonovaným polem) i ve Variantě C (nad SharedArrayBuffer).
 *
 * @param {Int32Array} int32Array Cílové pole
 * @param {number} startIdx Počáteční index výseku
 * @param {number} length Počet 32bitových prvků ve výseku
 * @param {number} stepIndex Index iterace benchmarku
 * @param {number} workerIndex Index vlákna (0 .. W-1)
 * @param {number} rounds Počet průchodů nad výsekem
 * @returns {number} 32bitový deterministický kontrolní součet výseku
 */
export function transformInt32SliceInPlace(
  int32Array,
  startIdx,
  length,
  stepIndex,
  workerIndex,
  rounds = 6,
) {
  const seed = (Math.imul(stepIndex, 0x9e3779b9) ^ Math.imul(workerIndex + 1, 0x85ebca6b)) | 0;

  for (let r = 0; r < rounds; r++) {
    const roundKey = (seed + Math.imul(r + 1, 0xc2b2ae35)) | 0;
    for (let localIdx = 0; localIdx < length; localIdx++) {
      const idx = startIdx + localIdx;
      let x = (int32Array[idx] + roundKey + localIdx) | 0;
      x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
      x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
      x = (x ^ (x >>> 16)) | 0;
      int32Array[idx] = x;
    }
  }

  let checksum = (seed ^ length) | 0;
  const stride = 16;
  for (let localIdx = 0; localIdx < length; localIdx += stride) {
    checksum = (Math.imul(checksum, 31) + int32Array[startIdx + localIdx]) | 0;
  }
  if (length > 0) {
    checksum = (Math.imul(checksum, 31) + int32Array[startIdx + length - 1]) | 0;
  }

  return checksum === 0 ? 1 : checksum;
}

/**
 * Hlavní obslužná funkce zpráv uvnitř workeru (100% sdílená mezi Node.js, Deno a Bun).
 *
 * @param {object} msg Příchozí zpráva z hlavního vlákna
 * @returns {object} Odpověď pro hlavní vlákno
 */
export function handleWorkerTask(msg) {
  switch (msg.type) {
    case "ping": {
      const pongChecksum =
        (Math.imul(msg.token | 0, 31) + ((msg.workerIndex + 1) * 0x01000193)) | 0;
      return {
        type: "pong",
        text: "pong",
        workerIndex: msg.workerIndex,
        checksum: pongChecksum === 0 ? 1 : pongChecksum,
      };
    }

    case "compute-clone": {
      /** @type {Int32Array} */
      const slice = msg.payload;
      const checksum = transformInt32SliceInPlace(
        slice,
        0,
        slice.length,
        msg.stepIndex,
        msg.workerIndex,
        msg.rounds,
      );
      // Vracíme transformovaný blok zpět přes postMessage (Structured Clone v obou směrech)
      return {
        type: "clone-done",
        workerIndex: msg.workerIndex,
        checksum,
        resultSlice: slice,
      };
    }

    case "init-sab": {
      sharedDataView = new Int32Array(msg.dataSab);
      sharedSyncView = new Int32Array(msg.syncSab);
      return {
        type: "sab-initialized",
        workerIndex: msg.workerIndex,
      };
    }

    case "compute-sab": {
      const checksum = transformInt32SliceInPlace(
        sharedDataView,
        msg.startIdx,
        msg.length,
        msg.stepIndex,
        msg.workerIndex,
        msg.rounds,
      );

      // Zápis kontrolního součtu a atomické zvýšení čítače dokončených vláken ve sdílené paměti
      Atomics.store(sharedSyncView, msg.workerIndex + 1, checksum);
      const completedCount = Atomics.add(sharedSyncView, 0, 1) + 1;
      Atomics.notify(sharedSyncView, 0, 1);

      return {
        type: "sab-done",
        workerIndex: msg.workerIndex,
        completedCount,
        checksum,
      };
    }

    default:
      throw new Error(`Neznámý typ úlohy ve workeru: ${msg.type}`);
  }
}
