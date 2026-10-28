/**
 * Detekce běhového prostředí (Node.js, Deno, Bun), čtení RSS paměti,
 * CLI argumentů a informací o hardwaru / OS.
 */

import os from "node:os";
import { bytesToMB, round } from "./stats.js";

/**
 * Detekuje název aktuálního běhového prostředí ('node' | 'deno' | 'bun').
 *
 * @returns {'node' | 'deno' | 'bun'}
 */
export function detectRuntime() {
  if (typeof globalThis.Bun !== "undefined") {
    return "bun";
  }
  if (typeof globalThis.Deno !== "undefined") {
    return "deno";
  }
  return "node";
}

/**
 * Vrátí aktuální velikost Resident Set Size (RSS) paměti procesu v bajtech
 * napříč prostředími Node.js, Deno a Bun.
 *
 * @returns {number}
 */
export function getRssBytes() {
  if (
    typeof globalThis.Deno !== "undefined" &&
    typeof globalThis.Deno.memoryUsage === "function"
  ) {
    return globalThis.Deno.memoryUsage().rss;
  }
  return process.memoryUsage().rss;
}

/**
 * Vrátí pole CLI argumentů předaných skriptu v aktuálním běhovém prostředí (Node.js, Deno, Bun).
 *
 * @returns {string[]}
 */
export function getCliArgs() {
  const runtime = detectRuntime();
  if (runtime === "deno") {
    return globalThis.Deno.args ?? [];
  }
  if (runtime === "bun") {
    return globalThis.Bun.argv.slice(2);
  }
  return process.argv.slice(2);
}

/**
 * Detekuje aktuální běhové prostředí (Node.js, Deno, Bun) a informace o hardwaru a OS.
 */
export function getEnvironmentMetadata() {
  const runtime = detectRuntime();
  let version = process.version;

  if (runtime === "bun") {
    const rev = globalThis.Bun.revision
      ? ` (${globalThis.Bun.revision.slice(0, 8)})`
      : "";
    version = `v${globalThis.Bun.version}${rev}`;
  } else if (runtime === "deno") {
    const v = globalThis.Deno.version;
    version = `v${v.deno} (V8 ${v.v8}, TS ${v.typescript})`;
  }

  const cpus = os.cpus();
  return {
    runtime,
    version,
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model?.replace(/\0/g, "").trim() ?? "unknown",
    cpuCores: cpus.length || navigator.hardwareConcurrency || 1,
    totalMemoryMB: round(bytesToMB(os.totalmem()), 0),
    freeMemoryMB: round(bytesToMB(os.freemem()), 0),
    timestamp: new Date().toISOString(),
  };
}

