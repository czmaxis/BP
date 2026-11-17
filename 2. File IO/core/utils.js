/**
 * ============================================================================
 * Centrální rozcestník (Barrel Export) pro pomocné moduly v core/
 * ============================================================================
 * Pro zpětnou kompatibilitu a přehledný import re-exportuje funkce z tematicky
 * rozdělených modulů:
 *   - ./runtime.js            (detekce prostředí, RSS paměť, CLI argumenty, HW/OS metadata)
 *   - ./stats.js              (matematika, percentily, p50/p95/p99, metrika iterací)
 *   - ./fs-helper.js          (souborový systém, temp složky, generování dat, JSON I/O)
 *   - ./process.js            (spouštění externích procesů a hledání binárek)
 *   - ./scenario-templates.js (univerzální šablony pro File I/O scénáře)
 * ============================================================================
 */

export * from "./runtime.js";
export * from "./stats.js";
export * from "./fs-helper.js";
export * from "./process.js";
export * from "./scenario-templates.js";
