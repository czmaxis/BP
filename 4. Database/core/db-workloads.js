/**
 * Sdílená SQL schémata, deterministický generátor záznamů a šablony scénářů
 * pro Kategorii 4: Databázové operace (04-database – SQLite).
 *
 * Zajišťuje 100% identické SQL příkazy, PRAGMA konfiguraci, datové sady
 * a kontrolní součty (checksum) napříč Node.js (node:sqlite), Deno (node:sqlite) a Bun (bun:sqlite).
 */

import path from "node:path";
import {
  ensureCleanDir,
  ensureDir,
  removeDatabaseFiles,
  removeSafe,
} from "./fs-helper.js";
import { detectRuntime } from "./runtime.js";
import { consumeBlackhole } from "./stats.js";

/**
 * Deterministický 32bitový pseudonáhodný generátor (Mulberry32).
 */
export function createSeededPrng(seed = 0x20260401) {
  let state = seed >>> 0;
  return function nextUint32() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

export const ROLES = ["admin", "developer", "analyst", "manager", "auditor"];

/**
 * Společná inicializační DDL a PRAGMA konfigurace pro všechny tři runtime.
 */
export const INIT_SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    score REAL NOT NULL,
    created_at INTEGER NOT NULL,
    payload TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
  CREATE INDEX IF NOT EXISTS idx_users_score ON users(score);
`;

export const INSERT_USER_SQL = `
  INSERT INTO users (username, email, role, score, created_at, payload)
  VALUES (?, ?, ?, ?, ?, ?)
`;

export const SELECT_USERS_SQL = `
  SELECT id, username, email, role, score, created_at, payload
  FROM users
  WHERE role = ? AND score > ?
  ORDER BY score DESC, id ASC
  LIMIT ?
`;

export const SELECT_AGG_SQL = `
  SELECT role, COUNT(*) AS total_count, SUM(CAST(score * 16 AS INTEGER)) AS sum_score_int, MAX(created_at) AS max_created
  FROM users
  WHERE score > ?
  GROUP BY role
  ORDER BY role ASC
`;

/**
 * Deterministicky vygeneruje pole uživatelských záznamů pro vložení do databáze.
 * Hodnota `score` využívá dyadické zlomky (k / 16) pro bitově exaktní IEEE-754 reprezentaci.
 *
 * @param {number} count Počet záznamů
 * @param {number} [seed=0x41424344]
 */
export function generateDeterministicUsers(count, seed = 0x41424344) {
  const prng = createSeededPrng(seed);
  const rows = new Array(count);

  for (let i = 0; i < count; i++) {
    const id = i + 1;
    const role = ROLES[prng() % ROLES.length];
    const baseScoreInt = (prng() % 16000) + 16; // 1.0 .. 1001.0 v krocích 1/16
    const score = baseScoreInt / 16.0;
    const createdAt = 1760000000 + ((prng() % 8640000) | 0);
    const payload = JSON.stringify({
      uid: `u-${id}`,
      dept: role,
      tier: (id % 5) + 1,
      active: (id & 3) !== 0,
      tags: [role, `group_${id % 16}`],
    });

    rows[i] = {
      username: `user_${String(id).padStart(5, "0")}_${role}`,
      email: `user.${id}@benchmark-db.cz`,
      role,
      baseScoreInt,
      score,
      baseCreatedAt: createdAt,
      createdAt,
      payload,
    };
  }

  return rows;
}

/**
 * ============================================================================
 * VARIANTA A: Dávkové vkládání (BATCH INSERT 1 000 záznamů v transakci)
 * ============================================================================
 * Testuje rychlost bindingu parametrů z JS do nativního C/C++/Rust/Zig SQLite rozhraní,
 * režii prepared statementu a zápis 1 000 záznamů uvnitř explicitní transakce
 * do fyzického souboru v režimu WAL.
 */
export function createBatchInsertScenarioTemplate({
  tempDir,
  batchSize = 1000,
  openDatabase,
  driverName,
}) {
  const runtime = detectRuntime();
  const scenarioDir = path.resolve(tempDir, `db_insert_${runtime}`);
  const baseRows = generateDeterministicUsers(batchSize, 0x11223344);

  let currentDb = null;
  let currentDbPath = "";
  let runSeq = 0;

  return {
    id: "db-batch-insert",
    name: `Varianta A: Dávkové vkládání – BATCH INSERT (${batchSize.toLocaleString("cs-CZ")} záznamů)`,
    description: `Vložení ${batchSize.toLocaleString("cs-CZ")} záznamů do fyzické SQLite databáze (WAL) v jedné transakci pomocí prepared statementu (${driverName}).`,
    config: {
      batchSize,
      journalMode: "WAL",
      synchronous: "NORMAL",
    },

    async setup() {
      runSeq = 0;
      await ensureCleanDir(scenarioDir);
    },

    /**
     * Příprava čistého databázového souboru, schématu a deterministická mutace dat MIMO měřený čas.
     */
    async prepareIteration(stepIndex) {
      runSeq++;
      await ensureDir(scenarioDir);
      currentDbPath = path.join(scenarioDir, `insert_iter_${runSeq}.sqlite`);
      await removeDatabaseFiles(currentDbPath);

      // Deterministická mutace vstupních záznamů podle stepIndex
      for (let i = 0; i < batchSize; i++) {
        const r = baseRows[i];
        const delta = ((stepIndex * 19 + i * 7) & 255);
        r.score = (r.baseScoreInt + delta) / 16.0;
        r.createdAt = r.baseCreatedAt + stepIndex * 10 + (i & 15);
      }

      currentDb = openDatabase(currentDbPath);
      currentDb.exec(INIT_SCHEMA_SQL);
    },

    /**
     * Měřená operace: Příprava statementu + BEGIN TRANSACTION + 1 000× INSERT + COMMIT.
     */
    runIteration() {
      const insertStmt = currentDb.prepare(INSERT_USER_SQL);
      try {
        currentDb.exec("BEGIN TRANSACTION;");
        for (let i = 0; i < batchSize; i++) {
          const r = baseRows[i];
          insertStmt.run(
            r.username,
            r.email,
            r.role,
            r.score,
            r.createdAt,
            r.payload,
          );
        }
        currentDb.exec("COMMIT;");
      } catch (err) {
        try {
          currentDb.exec("ROLLBACK;");
        } catch {
          // Ignorujeme chybu při rollbacku
        }
        throw err;
      } finally {
        insertStmt.finalize?.();
      }

      return {
        operationsCount: 1,
        rowsProcessed: batchSize,
      };
    },

    /**
     * Ověření integrity vložených dat, výpočet deterministického checksumu a smazání DB souborů MIMO měřený čas.
     */
    async finishIteration(stepIndex) {
      let checksum = 0;
      try {
        const verifyStmt = currentDb.prepare(
          "SELECT COUNT(*) AS cnt, SUM(CAST(score * 16 AS INTEGER)) AS sumScoreInt, SUM(created_at % 10000) AS sumCreated FROM users",
        );
        const row = verifyStmt.all()[0];
        verifyStmt.finalize?.();

        const cnt = Number(row.cnt);
        if (cnt !== batchSize) {
          throw new Error(
            `Nekonzistentní počet vložených řádků: vloženo=${cnt}, očekáváno=${batchSize}`,
          );
        }

        const sumScoreInt = Number(row.sumScoreInt) | 0;
        const sumCreated = Number(row.sumCreated) | 0;
        checksum =
          (Math.imul(cnt ^ stepIndex, 0x01000193) + sumScoreInt + sumCreated) |
          0;
        if (checksum === 0) checksum = 1;
        consumeBlackhole(checksum);
      } finally {
        if (currentDb) {
          currentDb.close();
          currentDb = null;
        }
        await removeDatabaseFiles(currentDbPath);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      return checksum;
    },

    async cleanup() {
      if (currentDb) {
        try {
          currentDb.close();
        } catch {
          // Ignorujeme
        }
        currentDb = null;
      }
      await removeSafe(scenarioDir);
    },
  };
}

/**
 * ============================================================================
 * VARIANTA B: Komplexní čtení a materializace (SELECT nad 10 000 záznamy)
 * ============================================================================
 * Nad fyzickou SQLite databází naplněnou 10 000 záznamy provádí sérii
 * parametrizovaných dotazů s filtrováním (WHERE role = ? AND score > ?),
 * řazením (ORDER BY score DESC LIMIT 500) a agregací (GROUP BY role),
 * přičemž materializuje výsledky do pole JS objektů a počítá kontrolní součet.
 */
export function createComplexSelectScenarioTemplate({
  tempDir,
  seedRowCount = 10000,
  queriesPerIteration = 25,
  queryLimit = 500,
  openDatabase,
  driverName,
}) {
  const runtime = detectRuntime();
  const scenarioDir = path.resolve(tempDir, `db_select_${runtime}`);
  const seedRows = generateDeterministicUsers(seedRowCount, 0x55667788);

  let currentDb = null;
  let currentDbPath = "";
  let runSeq = 0;

  return {
    id: "db-complex-select",
    name: `Varianta B: Komplexní čtení a materializace – SELECT (${seedRowCount.toLocaleString("cs-CZ")} záznamů)`,
    description: `Série ${queriesPerIteration} filtračních, řadicích (LIMIT ${queryLimit}) a agregačních SELECT dotazů nad fyzickou SQLite databází s ${seedRowCount.toLocaleString("cs-CZ")} záznamy (${driverName}).`,
    config: {
      seedRowCount,
      queriesPerIteration,
      queryLimit,
      journalMode: "WAL",
      synchronous: "NORMAL",
    },

    async setup() {
      runSeq = 0;
      await ensureCleanDir(scenarioDir);
    },

    /**
     * Vytvoření fyzické databáze v temp/ a naplnění 10 000 záznamy MIMO měřený čas SELECT dotazů.
     */
    async prepareIteration(stepIndex) {
      runSeq++;
      await ensureDir(scenarioDir);
      currentDbPath = path.join(scenarioDir, `select_iter_${runSeq}.sqlite`);
      await removeDatabaseFiles(currentDbPath);

      currentDb = openDatabase(currentDbPath);
      currentDb.exec(INIT_SCHEMA_SQL);

      const scoreShift = (stepIndex * 13) & 127;
      const insertStmt = currentDb.prepare(INSERT_USER_SQL);
      try {
        currentDb.exec("BEGIN TRANSACTION;");
        for (let i = 0; i < seedRowCount; i++) {
          const r = seedRows[i];
          const score = (r.baseScoreInt + ((i + scoreShift) & 63)) / 16.0;
          const createdAt = r.baseCreatedAt + stepIndex;
          insertStmt.run(
            r.username,
            r.email,
            r.role,
            score,
            createdAt,
            r.payload,
          );
        }
        currentDb.exec("COMMIT;");
      } finally {
        insertStmt.finalize?.();
      }
    },

    /**
     * Měřená operace: Série 20 detailních SELECT dotazů (materializace do JS objektů)
     * + 5 agregačních GROUP BY dotazů a výpočet kontrolního součtu z načtených objektů.
     */
    runIteration(stepIndex) {
      const selectStmt = currentDb.prepare(SELECT_USERS_SQL);
      const aggStmt = currentDb.prepare(SELECT_AGG_SQL);

      let checksum = (stepIndex * 0x9e3779b9) | 0;
      let totalRowsMaterialized = 0;
      const detailQueries = Math.max(1, queriesPerIteration - 5);

      try {
        // 1. Série detailních dotazů s WHERE role = ? AND score > ? ORDER BY score DESC LIMIT 500
        for (let q = 0; q < detailQueries; q++) {
          const role = ROLES[(q + stepIndex) % ROLES.length];
          const minScore = ((q * 37 + stepIndex * 11) % 600) + 50.0;
          const rows = selectStmt.all(role, minScore, queryLimit);

          const len = rows.length;
          totalRowsMaterialized += len;

          if (len > 0) {
            const first = rows[0];
            const middle = rows[len >>> 1];
            const last = rows[len - 1];
            const scoreSumInt =
              (Math.round(first.score * 16) +
                Math.round(middle.score * 16) +
                Math.round(last.score * 16)) |
              0;

            checksum =
              (Math.imul(checksum, 31) +
                len +
                first.id +
                last.id +
                scoreSumInt +
                first.username.length +
                last.payload.length) |
              0;
          }
        }

        // 2. Série 5 agregačních dotazů (GROUP BY role)
        for (let a = 0; a < 5; a++) {
          const minScore = (a * 120 + (stepIndex % 50)) * 1.0;
          const aggRows = aggStmt.all(minScore);
          totalRowsMaterialized += aggRows.length;

          for (let j = 0; j < aggRows.length; j++) {
            const ar = aggRows[j];
            checksum =
              (Math.imul(checksum, 31) +
                Number(ar.total_count) +
                (Number(ar.sum_score_int) | 0)) |
              0;
          }
        }
      } finally {
        selectStmt.finalize?.();
        aggStmt.finalize?.();
      }

      if (checksum === 0) checksum = 1;
      consumeBlackhole(checksum);

      return {
        operationsCount: queriesPerIteration,
        rowsProcessed: totalRowsMaterialized,
        checksum,
      };
    },

    /**
     * Uzavření a kompletní smazání databázového souboru (včetně -wal a -shm) MIMO měřený čas.
     */
    async finishIteration(_stepIndex, runResult) {
      try {
        if (currentDb) {
          currentDb.close();
          currentDb = null;
        }
      } finally {
        await removeDatabaseFiles(currentDbPath);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return runResult.checksum;
    },

    async cleanup() {
      if (currentDb) {
        try {
          currentDb.close();
        } catch {
          // Ignorujeme
        }
        currentDb = null;
      }
      await removeSafe(scenarioDir);
    },
  };
}
