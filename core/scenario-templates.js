/**
 * Sdílené šablony scénářů pro Kategorii 2: Souborové I/O operace.
 * Oddělují společnou metodiku měření (příprava dat, časování performance.now(),
 * měření RSS paměti, kontrola integrity a cleanup) od nativních I/O volání
 * jednotlivých prostředí (Node.js, Deno, Bun).
 */

import path from "node:path";
import {
  ensureCleanDir,
  generateRandomBuffer,
  removeSafe,
} from "./fs-helper.js";
import { detectRuntime, getRssBytes } from "./runtime.js";
import { bytesToMB, computeIterationMetrics, round } from "./stats.js";

/**
 * Univerzální šablona pro Variantu A (Sekvenční streamování – Velký soubor 100 MB).
 * Přijímá nativní funkce streamWriteFile a streamReadFile daného běhového prostředí.
 */
export function createLargeFileScenarioTemplate({
  tempDir,
  totalSizeBytes = 100 * 1024 * 1024,
  chunkSizeBytes = 64 * 1024,
  fileName = "large_test_100mb.bin",
  subDir = `large_file_${detectRuntime()}`,
  description,
  streamWriteFile,
  streamReadFile,
}) {
  const scenarioDir = path.resolve(tempDir, subDir);
  const filePath = path.join(scenarioDir, fileName);
  const totalSizeMB = bytesToMB(totalSizeBytes);

  // Předgenerování náhodného 64KB chunku mimo měřenou část
  const chunkBuffer = generateRandomBuffer(chunkSizeBytes);

  return {
    id: "large-file-100mb",
    name: "Varianta A: Sekvenční streamování (1x 100 MB)",
    description,
    config: {
      totalSizeBytes,
      totalSizeMB: round(totalSizeMB, 2),
      chunkSizeBytes,
      fileCount: 1,
    },

    async setup() {
      await ensureCleanDir(scenarioDir);
    },

    async runIteration(iterationIndex) {
      await removeSafe(filePath);

      const rssBeforeBytes = getRssBytes();

      // 1. Měření streamovaného zápisu
      const writeStart = performance.now();
      const bytesWritten = await streamWriteFile(
        filePath,
        chunkBuffer,
        totalSizeBytes,
      );
      const writeEnd = performance.now();
      const rssAfterWriteBytes = getRssBytes();

      // 2. Měření streamovaného čtení
      const readStart = performance.now();
      const bytesRead = await streamReadFile(filePath, chunkSizeBytes);
      const readEnd = performance.now();
      const rssAfterBytes = getRssBytes();

      if (bytesWritten !== totalSizeBytes || bytesRead !== totalSizeBytes) {
        throw new Error(
          `Nekonzistentní velikost přenesených dat: zapsáno=${bytesWritten}, přečteno=${bytesRead}, očekáváno=${totalSizeBytes}`,
        );
      }

      // Úklid po iteraci mimo měřený čas operace
      await removeSafe(filePath);

      return computeIterationMetrics({
        iterationIndex,
        bytesProcessed: totalSizeBytes,
        fileCount: 1,
        writeMs: writeEnd - writeStart,
        readMs: readEnd - readStart,
        rssBeforeBytes,
        rssAfterWriteBytes,
        rssAfterBytes,
        opsDecimals: 3,
      });
    },

    async cleanup() {
      await removeSafe(scenarioDir);
    },
  };
}

/**
 * Univerzální šablona pro Variantu B (Systémová režie – 1 000 malých 4KB souborů).
 * Přijímá nativní funkce writeSingleFile a readSingleFile daného běhového prostředí.
 */
export function createSmallFilesScenarioTemplate({
  tempDir,
  fileCount = 1000,
  fileSizeBytes = 4096,
  subDir = "small_files",
  description,
  writeSingleFile,
  readSingleFile,
}) {
  const runtime = detectRuntime();
  const scenarioDir = path.resolve(tempDir, `${subDir}_${runtime}`);
  const totalSizeBytes = fileCount * fileSizeBytes;
  const totalSizeMB = bytesToMB(totalSizeBytes);

  // Předgenerování 4KB náhodného bufferu a cest k souborům mimo měřený interval
  const fileBuffer = generateRandomBuffer(fileSizeBytes);
  const filePaths = Array.from({ length: fileCount }, (_, i) =>
    path.join(scenarioDir, `small_${String(i).padStart(4, "0")}.bin`),
  );

  return {
    id: "small-files-1000x4kb",
    name: "Varianta B: Systémová režie – Malé soubory (1 000x 4 KB)",
    description,
    config: {
      fileCount,
      fileSizeBytes,
      totalSizeBytes,
      totalSizeMB: round(totalSizeMB, 2),
    },

    async setup() {
      await ensureCleanDir(scenarioDir);
    },

    async runIteration(iterationIndex) {
      await ensureCleanDir(scenarioDir);

      const rssBeforeBytes = getRssBytes();

      // 1. Měření paralelního zápisu 1 000 souborů
      const writeStart = performance.now();
      await Promise.all(
        filePaths.map((filePath) => writeSingleFile(filePath, fileBuffer)),
      );
      const writeEnd = performance.now();
      const rssAfterWriteBytes = getRssBytes();

      // 2. Měření paralelního čtení 1 000 souborů
      const readStart = performance.now();
      const buffers = await Promise.all(
        filePaths.map((filePath) => readSingleFile(filePath)),
      );
      const readEnd = performance.now();
      const rssAfterBytes = getRssBytes();

      let bytesRead = 0;
      for (let i = 0; i < buffers.length; i++) {
        bytesRead += buffers[i].byteLength;
      }

      if (bytesRead !== totalSizeBytes) {
        throw new Error(
          `Nekonzistentní velikost přečtených dat: přečteno=${bytesRead}, očekáváno=${totalSizeBytes}`,
        );
      }

      // Úklid všech 1 000 souborů mimo měřený čas operace
      await removeSafe(scenarioDir);

      return computeIterationMetrics({
        iterationIndex,
        bytesProcessed: totalSizeBytes,
        fileCount,
        writeMs: writeEnd - writeStart,
        readMs: readEnd - readStart,
        rssBeforeBytes,
        rssAfterWriteBytes,
        rssAfterBytes,
        opsDecimals: 2,
      });
    },

    async cleanup() {
      await removeSafe(scenarioDir);
    },
  };
}

