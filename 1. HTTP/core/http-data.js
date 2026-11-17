/**
 * Sdílená testovací data a aplikační logika pro Kategorii 1: Výkon HTTP serveru (01-http).
 *
 * Zajišťuje 100% identickou aplikační logiku napříč Node.js, Deno a Bun:
 * 1. GET /plaintext : Konstantní text "Hello, World!"
 * 2. GET /json      : Dynamická serializace (JSON.stringify) polymorfního pole 50 uživatelských záznamů
 * 3. POST /echo     : Parsování (JSON.parse), validace, obohacení o "processed": true a serializace (JSON.stringify)
 */

import { consumeBlackhole } from "./stats.js";

export const PLAINTEXT_BODY = "Hello, World!";

const ROLES = ["admin", "developer", "analyst", "manager", "auditor"];
const CITIES = ["Praha", "Brno", "Ostrava", "Plzeň", "Olomouc", "Liberec"];
const TAG_POOL = [
  "javascript",
  "typescript",
  "nodejs",
  "deno",
  "bun",
  "benchmark",
  "http",
  "io",
  "performance",
  "v8",
  "jsc",
];

/**
 * Deterministicky vygeneruje polymorfní sadu 50 uživatelských záznamů.
 * Obsahuje čísla (int i float), řetězce, booleany, vnořené objekty, pole i null hodnoty.
 *
 * @param {number} [count=50]
 * @returns {Array<object>}
 */
export function createUsersDataset(count = 50) {
  return Array.from({ length: count }, (_, idx) => {
    const id = idx + 1;
    const isActive = idx % 3 !== 0;
    const role = ROLES[idx % ROLES.length];
    const city = CITIES[idx % CITIES.length];
    const score = Number(((idx * 17.37 + 42.125) % 100).toFixed(3));

    return {
      id,
      uuid: `usr-2026-${String(id).padStart(4, "0")}-${((id * 2654435761) >>> 0).toString(16).padStart(8, "0")}`,
      username: `user_${id}_${role}`,
      email: `user.${id}@benchmark-bp.cz`,
      role,
      isActive,
      score,
      tags: [
        TAG_POOL[idx % TAG_POOL.length],
        TAG_POOL[(idx + 3) % TAG_POOL.length],
        ...(idx % 2 === 0 ? [TAG_POOL[(idx + 6) % TAG_POOL.length]] : []),
      ],
      profile: {
        age: 20 + (idx % 45),
        city,
        verified: idx % 4 !== 1,
        preferences: {
          theme: idx % 2 === 0 ? "dark" : "light",
          notifications: isActive,
          quotaMB: (idx + 1) * 128,
        },
      },
      lastLoginAt: isActive
        ? `2026-10-${String((idx % 28) + 1).padStart(2, "0")}T12:34:56.000Z`
        : null,
    };
  });
}

/**
 * Sdílená instance 50 polymorfních uživatelských záznamů pro endpoint GET /json.
 */
export const USERS_DATASET = createUsersDataset(50);

/**
 * Výchozí testovací JSON tělo odesílané klientem na endpoint POST /echo.
 */
export const ECHO_REQUEST_OBJECT = {
  requestId: "req-benchmark-01-http-echo",
  category: "01-http",
  action: "echo_validation_test",
  timestamp: 1761670000000,
  user: {
    id: 101,
    name: "Jan Novák",
    roles: ["benchmark", "tester"],
    active: true,
  },
  metrics: {
    attempt: 1,
    values: [12.5, 48.25, 99.125, 0.875],
    unit: "ms",
  },
  metadata: {
    source: "load-generator",
    nested: {
      level: 2,
      verified: true,
    },
  },
};

export const ECHO_REQUEST_BODY = JSON.stringify(ECHO_REQUEST_OBJECT);

/**
 * Serializuje pole 50 uživatelů pro endpoint GET /json a předá délku do Blackhole akumulátoru.
 *
 * @returns {string} JSON řetězec
 */
export function serializeUsersDataset() {
  const json = JSON.stringify(USERS_DATASET);
  consumeBlackhole(json.length);
  return json;
}

/**
 * Zpracuje příchozí textové tělo požadavku POST /echo:
 * 1. Provede JSON.parse()
 * 2. Validuje, že výsledkem je neprázdný JSON objekt
 * 3. Doplní vlastnost "processed": true
 * 4. Vrátí serializovaný JSON řetězec přes JSON.stringify()
 *
 * @param {string} rawBody
 * @returns {string}
 */
export function processEchoPayload(rawBody) {
  if (!rawBody || rawBody.length === 0) {
    throw new Error("Prázdné tělo požadavku POST /echo.");
  }

  const parsed = JSON.parse(rawBody);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Neplatný formát JSON těla: očekáván JSON objekt.");
  }

  parsed.processed = true;
  const serialized = JSON.stringify(parsed);
  consumeBlackhole(serialized.length);
  return serialized;
}

/**
 * Rychlá extrakce cesty (pathname) z URL bez režie alokace objektu `new URL()`
 * při každém požadavku. Funguje identicky pro relativní cestu v Node.js ("/plaintext")
 * i plnou URL v Deno/Bun ("http://127.0.0.1:3000/plaintext").
 *
 * @param {string} url
 * @returns {string}
 */
export function extractPathname(url) {
  if (!url) return "/";
  let start = 0;

  // Pokud nezačíná znakem '/' (kód 47), přeskočíme schéma a hostitele ("http://host:port")
  if (url.charCodeAt(0) !== 47) {
    const schemeIdx = url.indexOf("://");
    if (schemeIdx !== -1) {
      const slashIdx = url.indexOf("/", schemeIdx + 3);
      if (slashIdx === -1) return "/";
      start = slashIdx;
    }
  }

  const queryIdx = url.indexOf("?", start);
  if (queryIdx === -1) {
    return start === 0 ? url : url.slice(start);
  }
  return url.slice(start, queryIdx);
}
