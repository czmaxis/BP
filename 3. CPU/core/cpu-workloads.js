/**
 * Sdílené deterministické výpočetní úlohy pro Kategorii 3: CPU-náročné úlohy (03-cpu).
 *
 * Všechna tři běhová prostředí (Node.js, Deno, Bun) spouštějí naprosto identický kód
 * nad bitově shodnými deterministickými daty (generovanými přes seedovaný PRNG Mulberry32).
 *
 * Obrana proti "Microbenchmark Fallacy" a JIT Dead Code Elimination (DCE):
 * 1. Před každou iterací `i` (mimo měřený čas `performance.now()`) funkce `prepareIteration(i)`
 *    deterministicky zmutuje vstupní data na základě indexu `i`.
 * 2. Každá funkce `runIteration(i)` vypočítá z kompletního výstupu deterministický 32bitový
 *    kontrolní součet (`checksum`), který předá do globálního `consumeBlackhole(checksum)`.
 * 3. Kontrolní součty (`checksum`) jsou pro shodné vstupy 100% bitově identické napříč Node.js, Deno i Bun.
 */

import { consumeBlackhole } from "./stats.js";

/**
 * Deterministický 32bitový pseudonáhodný generátor (Mulberry32).
 * Zajišťuje bitově identická vstupní data v Node.js, Deno i Bun (na rozdíl od Math.random()).
 *
 * @param {number} seed
 * @returns {() => number} Funkce vracející uint32 (0 .. 0xFFFFFFFF)
 */
export function createSeededPrng(seed = 0x20260301) {
  let state = seed >>> 0;
  return function nextUint32() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/**
 * ============================================================================
 * VARIANTA A: Kryptografické hashování a odvození klíčů (WebCrypto API)
 * ============================================================================
 * Testuje nativní implementaci standardního WebCrypto API (`crypto.subtle`):
 * - PBKDF2-HMAC-SHA512 (iterativní odvození klíče)
 * - Zřetězené SHA-512 a SHA-256 hashování nad 64KB blokem dat
 */
export function createCryptoHashScenario({
  payloadBytes = 65536,
  pbkdf2Iterations = 120000,
  digestRounds = 80,
} = {}) {
  const basePayload = new Uint8Array(payloadBytes);
  const workBuffer = new Uint8Array(payloadBytes);
  const passwordBuffer = new Uint8Array(32);
  const saltBuffer = new Uint8Array(16);

  function initBaseData() {
    const prng = createSeededPrng(0x1a2b3c4d);
    for (let i = 0; i < payloadBytes; i++) {
      basePayload[i] = prng() & 0xff;
    }
    for (let i = 0; i < 32; i++) {
      passwordBuffer[i] = prng() & 0xff;
    }
    for (let i = 0; i < 16; i++) {
      saltBuffer[i] = prng() & 0xff;
    }
  }

  return {
    id: "cpu-crypto-webcrypto",
    name: "Varianta A: Kryptografické hashování (WebCrypto PBKDF2 + SHA-512)",
    description: `Odvození klíče PBKDF2-SHA512 (${pbkdf2Iterations.toLocaleString("cs-CZ")} iterací) a ${digestRounds} zřetězených SHA-512/SHA-256 hashů nad ${Math.round(payloadBytes / 1024)}KB blokem přes nativní crypto.subtle.`,
    config: {
      payloadBytes,
      pbkdf2Iterations,
      digestRounds,
    },

    setup() {
      initBaseData();
    },

    /**
     * Deterministická mutace vstupního bufferu a soli před měřeným časem iterace `stepIndex`.
     */
    prepareIteration(stepIndex) {
      workBuffer.set(basePayload);
      const mutIdx = (stepIndex * 1021) & (payloadBytes - 1);
      workBuffer[mutIdx] = (workBuffer[mutIdx] ^ ((stepIndex * 73 + 19) & 0xff)) & 0xff;
      workBuffer[0] = (basePayload[0] + stepIndex) & 0xff;
      passwordBuffer[stepIndex & 31] = ((stepIndex * 41) ^ 0xa5) & 0xff;
      saltBuffer[stepIndex & 15] = ((stepIndex * 59) + 17) & 0xff;
    },

    /**
     * Hlavní měřený výpočet Varianty A.
     *
     * @param {number} stepIndex
     * @returns {Promise<number>} 32bitový deterministický kontrolní součet
     */
    async runIteration(stepIndex) {
      const subtle = globalThis.crypto.subtle;

      const baseKey = await subtle.importKey(
        "raw",
        passwordBuffer,
        { name: "PBKDF2" },
        false,
        ["deriveBits"],
      );

      const derivedBits = await subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: saltBuffer,
          iterations: pbkdf2Iterations,
          hash: "SHA-512",
        },
        baseKey,
        512,
      );

      const derivedBytes = new Uint8Array(derivedBits);
      workBuffer.set(derivedBytes, 0);

      let rollingHash = (stepIndex * 16777619) | 0;
      for (let r = 0; r < digestRounds; r++) {
        const algo = (r & 1) === 0 ? "SHA-512" : "SHA-256";
        const digestBuf = await subtle.digest(algo, workBuffer);
        const digestView = new DataView(digestBuf);
        const word0 = digestView.getInt32(0, true);
        const wordLast = digestView.getInt32(digestBuf.byteLength - 4, true);

        rollingHash =
          (Math.imul(rollingHash ^ word0, 0x01000193) + wordLast + r) | 0;

        // Zpětný zápis části digestu do workBufferu, aby každé další kolo záviselo na předchozím
        const targetOffset = ((r * 512) & (payloadBytes - 64));
        workBuffer.set(new Uint8Array(digestBuf), targetOffset);
      }

      if (rollingHash === 0) rollingHash = 1;
      consumeBlackhole(rollingHash);
      return rollingHash;
    },
  };
}

/**
 * ============================================================================
 * VARIANTA B: Polymorfní JSON transformace, filtrace a řazení
 * ============================================================================
 * Testuje práci JIT kompilátoru s polymorfními objekty (4 odlišné Hidden Classes / Shapes),
 * správu paměti (alokace objektů na haldě), vlastní komparátor v `Array.prototype.sort`
 * a nativní C++/Rust/Zig parsery `JSON.stringify()` a `JSON.parse()`.
 */
export function createJsonTransformScenario({
  recordCount = 10000,
  transformPasses = 8,
} = {}) {
  const CATEGORIES = ["COMMERCE", "SECURITY", "TELEMETRY", "ACCOUNT"];
  const REGIONS = ["EU-CENTRAL", "US-EAST", "AP-SOUTH", "EU-WEST"];
  const TAGS = ["critical", "verified", "batch", "realtime", "archived", "priority"];

  let baseRecords = [];

  function buildPolymorphicRecords() {
    const prng = createSeededPrng(0x2b3c4d5e);
    const records = new Array(recordCount);

    for (let i = 0; i < recordCount; i++) {
      const id = i + 1;
      const shapeType = i & 3; // 4 odlišné tvary objektů (Hidden Classes) pro polymorfní Inline Cache
      const region = REGIONS[prng() % REGIONS.length];
      const baseValue = ((prng() % 100000) / 16); // Dyadický zlomek (k / 16) pro bitově exaktní float

      if (shapeType === 0) {
        // Tvar 1: Objednávka (Commerce)
        records[i] = {
          kind: "order",
          id,
          region,
          active: (prng() & 3) !== 0,
          baseValue,
          items: [
            { sku: `SKU-${id & 255}`, qty: (prng() % 5) + 1, price: ((prng() % 2000) / 4) },
            { sku: `SKU-${(id + 7) & 255}`, qty: (prng() % 3) + 1, price: ((prng() % 1000) / 4) },
          ],
          discountCode: (i & 1) === 0 ? `DISC_${id % 50}` : null,
        };
      } else if (shapeType === 1) {
        // Tvar 2: Bezpečnostní auditní záznam (Security)
        records[i] = {
          id,
          kind: "audit",
          severity: (prng() % 5) + 1,
          active: (prng() & 3) !== 1,
          region,
          baseValue,
          tags: [
            TAGS[prng() % TAGS.length],
            TAGS[(prng() >>> 4) % TAGS.length],
          ],
          actor: {
            uid: `usr_${id % 500}`,
            mfa: (i & 2) === 0,
          },
        };
      } else if (shapeType === 2) {
        // Tvar 3: Telemetrie senzoru (Telemetry)
        records[i] = {
          kind: "telemetry",
          sensorId: `SNS-${String(id).padStart(5, "0")}`,
          id,
          active: (prng() & 3) !== 2,
          baseValue,
          region,
          readings: [
            ((prng() % 4096) / 8),
            ((prng() % 4096) / 8),
            ((prng() % 4096) / 8),
          ],
          calibrated: true,
        };
      } else {
        // Tvar 4: Uživatelský účet (Account)
        records[i] = {
          id,
          region,
          kind: "account",
          active: (prng() & 3) !== 3,
          baseValue,
          quotaMB: ((prng() % 64) + 1) * 128,
          permissions: {
            read: true,
            write: (i & 1) === 0,
            admin: (i % 12) === 0,
          },
          notes: (i & 4) === 0 ? `Note-${id}` : undefined,
        };
      }
    }

    return records;
  }

  return {
    id: "cpu-json-polymorphic",
    name: "Varianta B: Polymorfní JSON transformace a řazení (10 000 záznamů)",
    description: `Hluboká filtrace, polymorfní transformace, řazení (Array.prototype.sort), JSON.stringify() a JSON.parse() nad ${recordCount.toLocaleString("cs-CZ")} polymorfními objekty (${transformPasses} průchodů).`,
    config: {
      recordCount,
      transformPasses,
      polymorphicShapes: 4,
    },

    setup() {
      baseRecords = buildPolymorphicRecords();
    },

    /**
     * Deterministická mutace záznamů před měřeným časem iterace `stepIndex`.
     */
    prepareIteration(stepIndex) {
      const stride = 13;
      const offset = stepIndex % stride;
      for (let i = offset; i < recordCount; i += stride) {
        const rec = baseRecords[i];
        rec.baseValue = ((i * 31 + stepIndex * 17) % 65536) / 16;
        rec.active = ((i + stepIndex) & 3) !== 0;
      }
    },

    /**
     * Hlavní měřený výpočet Varianty B.
     *
     * @param {number} stepIndex
     * @returns {number} 32bitový deterministický kontrolní součet
     */
    runIteration(stepIndex) {
      let checksum = (stepIndex * 2654435761) | 0;

      for (let pass = 0; pass < transformPasses; pass++) {
        const passSeed = stepIndex + pass;

        // 1. Hluboká filtrace a polymorfní transformace
        const transformed = [];
        for (let i = 0; i < baseRecords.length; i++) {
          const r = baseRecords[i];
          if (!r.active && ((i + pass) & 3) === 0) continue;

          let metricScore = r.baseValue + pass * 4.5;
          let badgeCount = 0;

          if (r.kind === "order") {
            const items = r.items;
            for (let j = 0; j < items.length; j++) {
              metricScore += items[j].qty * items[j].price;
            }
            badgeCount = r.discountCode ? 2 : 1;
          } else if (r.kind === "audit") {
            metricScore += r.severity * 128.5;
            badgeCount = r.tags.length + (r.actor.mfa ? 1 : 0);
          } else if (r.kind === "telemetry") {
            const rd = r.readings;
            metricScore += (rd[0] + rd[1] + rd[2]) / 4;
            badgeCount = r.calibrated ? 3 : 0;
          } else {
            metricScore += r.quotaMB / 8;
            badgeCount =
              (r.permissions.read ? 1 : 0) +
              (r.permissions.write ? 1 : 0) +
              (r.permissions.admin ? 2 : 0);
          }

          const catIndex = (r.id + passSeed) & 3;
          transformed.push({
            id: r.id,
            kind: r.kind,
            category: CATEGORIES[catIndex],
            region: r.region,
            score: metricScore,
            badges: badgeCount,
            code: `${r.region}:${r.kind}:${r.id}`,
          });
        }

        // 2. Řazení s vlastním víceúrovňovým komparátorem
        transformed.sort((a, b) => {
          if (a.category !== b.category) {
            return a.category < b.category ? -1 : 1;
          }
          if (b.score !== a.score) {
            return b.score - a.score;
          }
          return a.id - b.id;
        });

        // 3. Serializace do JSON řetězce a zpětné parsování
        const jsonString = JSON.stringify(transformed);
        const parsed = JSON.parse(jsonString);

        // 4. Akumulace deterministického kontrolního součtu z naparsovaných objektů
        checksum = (checksum ^ jsonString.length) | 0;
        const step = Math.max(1, Math.floor(parsed.length / 128));
        for (let i = 0; i < parsed.length; i += step) {
          const item = parsed[i];
          const scoreInt = Math.round(item.score * 16) | 0;
          checksum =
            (Math.imul(checksum, 31) + item.id + scoreInt + item.badges) | 0;
        }
      }

      if (checksum === 0) checksum = 1;
      consumeBlackhole(checksum);
      return checksum;
    },
  };
}

/**
 * ============================================================================
 * VARIANTA C: Numerické a maticové výpočty (Husté matice 250x250 Float64Array)
 * ============================================================================
 * Testuje optimalizaci vnořených numerických smyček v JIT kompilátorech
 * (V8 TurboFan vs. JavaScriptCore DFG/FTL), práci s typovanými poli `Float64Array`,
 * bounds-check elimination a propustnost FPU při násobení hustých matic.
 * Využívá dyadické zlomky (k / 16) pro 100% bitově exaktní IEEE-754 součty napříč enginy.
 */
export function createMatrixMultiplyScenario({
  matrixSize = 250,
  passes = 4,
} = {}) {
  const n = matrixSize;
  const totalElements = n * n;

  const baseA = new Float64Array(totalElements);
  const baseB = new Float64Array(totalElements);
  const matA = new Float64Array(totalElements);
  const matB = new Float64Array(totalElements);
  const matC = new Float64Array(totalElements);

  function initMatrices() {
    const prng = createSeededPrng(0x3c4d5e6f);
    for (let i = 0; i < totalElements; i++) {
      // Dyadické zlomky v rozsahu [-2.0, +1.9375] s krokem 1/16 (exaktní v IEEE-754 Float64)
      baseA[i] = ((prng() & 63) - 32) / 16.0;
      baseB[i] = ((prng() & 63) - 32) / 16.0;
    }
  }

  return {
    id: "cpu-matrix-multiply",
    name: `Varianta C: Numerické a maticové výpočty (${matrixSize}×${matrixSize} Float64Array)`,
    description: `Vícenásobné násobení hustých matic ${matrixSize}×${matrixSize} (${passes} průchody, Float64Array) – testuje JIT optimalizaci vnořených smyček a bounds-check elimination.`,
    config: {
      matrixSize,
      passes,
      operationsPerIteration: 2 * n * n * n * passes,
    },

    setup() {
      initMatrices();
    },

    /**
     * Deterministická mutace matic před měřeným časem iterace `stepIndex`.
     */
    prepareIteration(stepIndex) {
      matA.set(baseA);
      matB.set(baseB);

      for (let i = 0; i < n; i++) {
        const diagIdx = i * n + i;
        const mutVal = (((stepIndex * 29 + i * 7) & 31) - 16) / 16.0;
        matA[diagIdx] = baseA[diagIdx] + mutVal;
        matB[diagIdx] = baseB[diagIdx] - mutVal;
      }
    },

    /**
     * Hlavní měřený výpočet Varianty C (cache-friendly i-k-j maticové násobení).
     *
     * @param {number} stepIndex
     * @returns {number} 32bitový deterministický kontrolní součet
     */
    runIteration(stepIndex) {
      for (let p = 0; p < passes; p++) {
        matC.fill(0.0);

        for (let i = 0; i < n; i++) {
          const rowAOffset = i * n;
          const rowCOffset = i * n;

          for (let k = 0; k < n; k++) {
            const aik = matA[rowAOffset + k];
            const rowBOffset = k * n;

            for (let j = 0; j < n; j++) {
              matC[rowCOffset + j] += aik * matB[rowBOffset + j];
            }
          }
        }

        // Mezi průchody deterministicky zredukujeme výslednou matici C do matA pro další průchod
        if (p < passes - 1) {
          for (let idx = 0; idx < totalElements; idx++) {
            // Bitově exaktní redukce do dyadického rozsahu [-2.0, +2.0]
            const scaled = Math.trunc(matC[idx]) & 63;
            matA[idx] = (scaled - 32) / 16.0;
          }
        }
      }

      // Výpočet deterministického kontrolního součtu z výsledné matice C
      // Protože jsou vstupy celočíselné násobky 1/16, je matC[idx] * 256 vždy exaktní celé číslo!
      let checksum = (stepIndex * 0x9e3779b9) | 0;
      const stride = 17;
      for (let idx = 0; idx < totalElements; idx += stride) {
        const exactInt = Math.round(matC[idx] * 256) | 0;
        checksum = (Math.imul(checksum, 31) + exactInt) | 0;
      }

      if (checksum === 0) checksum = 1;
      consumeBlackhole(checksum);
      return checksum;
    },
  };
}
