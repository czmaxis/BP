/**
 * Porovnávací a agregační skript pro Kategorii 2: Souborové I/O operace.
 *
 * Načte souhrnné výsledky (file_io_summary_node.json, file_io_summary_deno.json, file_io_summary_bun.json)
 * ze složky results/, vykreslí přehlednou srovnávací tabulku do konzole (p50, p95, p99, MB/s, op/s, max RSS)
 * a uloží sjednocený výstup do results/file_io_comparison.json.
 *
 * Spuštění:
 *   node compare.js
 *   npm run compare
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { saveJsonResult } from "./core/fs-helper.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RUNTIMES = [
  { key: "node", label: "Node.js", file: "file_io_summary_node.json" },
  { key: "deno", label: "Deno", file: "file_io_summary_deno.json" },
  { key: "bun", label: "Bun", file: "file_io_summary_bun.json" },
];

async function loadSummaryIfExists(resultsDir, fileName) {
  const fullPath = path.join(resultsDir, fileName);
  try {
    const raw = await readFile(fullPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function padLeft(str, len) {
  return String(str).padStart(len, " ");
}

function padRight(str, len) {
  return String(str).padEnd(len, " ");
}

function formatNum(val, decimals = 2) {
  if (typeof val !== "number" || Number.isNaN(val)) return "N/A";
  return val.toFixed(decimals);
}

/**
 * Vykreslí porovnávací tabulku jednoho scénáře napříč dostupnými běhovými prostředími.
 */
function printScenarioComparison(scenarioId, scenarioTitle, loadedRuntimes) {
  const line = "═".repeat(108);
  const thinLine = "─".repeat(108);

  console.log(`\n${line}`);
  console.log(`  SROVNÁNÍ BĚHOVÝCH PROSTŘEDÍ – ${scenarioTitle}`);
  console.log(line);

  // Hlavička tabulky
  console.log(
    `  ${padRight("Metrika", 26)} | ` +
      `${padRight("Běhové prostředí", 16)} | ` +
      `${padLeft("Medián (p50)", 13)} | ` +
      `${padLeft("p95", 11)} | ` +
      `${padLeft("Tail (p99)", 11)} | ` +
      `${padLeft("Průměr ± σ", 19)}`,
  );
  console.log(`  ${thinLine}`);

  const metricRows = [
    {
      key: "writeMs",
      label: "Doba zápisu (ms)",
      unit: "ms",
      lowerIsBetter: true,
    },
    {
      key: "readMs",
      label: "Doba čtení (ms)",
      unit: "ms",
      lowerIsBetter: true,
    },
    {
      key: "totalMs",
      label: "Celková doba (ms)",
      unit: "ms",
      lowerIsBetter: true,
    },
    {
      key: "writeThroughputMBps",
      label: "Propustnost zápisu (MB/s)",
      unit: "MB/s",
      lowerIsBetter: false,
    },
    {
      key: "readThroughputMBps",
      label: "Propustnost čtení (MB/s)",
      unit: "MB/s",
      lowerIsBetter: false,
    },
    {
      key: "totalThroughputMBps",
      label: "Celková propustnost (MB/s)",
      unit: "MB/s",
      lowerIsBetter: false,
    },
    {
      key: "totalOpsPerSec",
      label: "Operace za sekundu (op/s)",
      unit: "op/s",
      lowerIsBetter: false,
    },
    {
      key: "rssAfterMB",
      label: "Paměť RSS po běhu (MB)",
      unit: "MB",
      lowerIsBetter: true,
      showMaxInP99: true,
    },
  ];

  for (const metricDef of metricRows) {
    // Najdeme nejlepší hodnotu p50 pro zvýraznění vítěze
    const p50Values = loadedRuntimes
      .map(
        (rt) => rt.data?.scenarios?.[scenarioId]?.metrics?.[metricDef.key]?.p50,
      )
      .filter((v) => typeof v === "number");

    const bestP50 =
      p50Values.length > 0
        ? metricDef.lowerIsBetter
          ? Math.min(...p50Values)
          : Math.max(...p50Values)
        : null;

    loadedRuntimes.forEach((rt, idx) => {
      const m = rt.data?.scenarios?.[scenarioId]?.metrics?.[metricDef.key];
      const metricCell =
        idx === 0 ? padRight(metricDef.label, 26) : padRight("", 26);

      if (!m) {
        console.log(
          `  ${metricCell} | ${padRight(rt.label, 16)} | ${padLeft("N/A", 13)} | ${padLeft("N/A", 11)} | ${padLeft("N/A", 11)} | ${padLeft("N/A", 19)}`,
        );
        return;
      }

      const isBest = bestP50 !== null && m.p50 === bestP50;
      const rtName = isBest ? `★ ${rt.label}` : `  ${rt.label}`;
      const meanStd = `${formatNum(m.mean, 2)} ± ${formatNum(m.stdDev, 2)}`;
      const tailValue = metricDef.showMaxInP99
        ? `${formatNum(m.max, 2)} (max)`
        : formatNum(m.p99, 2);

      console.log(
        `  ${metricCell} | ` +
          `${padRight(rtName, 16)} | ` +
          `${padLeft(formatNum(m.p50, 2), 13)} | ` +
          `${padLeft(formatNum(m.p95, 2), 11)} | ` +
          `${padLeft(tailValue, 11)} | ` +
          `${padLeft(meanStd, 19)}`,
      );
    });

    console.log(`  ${thinLine}`);
  }
}

async function main() {
  const resultsDir = path.resolve(__dirname, "results");
  const loadedRuntimes = [];

  for (const rt of RUNTIMES) {
    const data = await loadSummaryIfExists(resultsDir, rt.file);
    if (data) {
      loadedRuntimes.push({
        ...rt,
        version: data.environment?.version ?? "unknown",
        data,
      });
    }
  }

  if (loadedRuntimes.length === 0) {
    console.error("Nebyla nalezena žádná summary data ve složce results/.");
    process.exitCode = 1;
    return;
  }

  console.log(
    "\n╔══════════════════════════════════════════════════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║          KŘÍŽOVÉ POROVNÁNÍ: KATEGORIE 2 – SOUBOROVÉ I/O OPERACE (NODE.JS vs. DENO vs. BUN)               ║",
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════════════════════════════════════════════════╝",
  );

  for (const rt of loadedRuntimes) {
    console.log(
      `  • ${padRight(rt.label, 10)} : ${rt.version} (N = ${rt.data.benchmarkConfig?.measuredIterations ?? 30}, Warmup = ${rt.data.benchmarkConfig?.warmupIterations ?? 10})`,
    );
  }
  console.log("  (★ označuje nejlepší medián p50 v dané disciplíně)");

  const scenarioDefs = [
    {
      id: "large-file-100mb",
      title: "Varianta A: Sekvenční streamování – Velký soubor (1× 100 MB)",
    },
    {
      id: "small-files-1000x4kb",
      title: "Varianta B: Systémová režie – Malé soubory (1 000× 4 KB)",
    },
  ];

  const unifiedComparison = {
    category: "02-file-io",
    generatedAt: new Date().toISOString(),
    environments: {},
    scenarios: {},
  };

  for (const rt of loadedRuntimes) {
    unifiedComparison.environments[rt.key] = rt.data.environment;
  }

  for (const sc of scenarioDefs) {
    printScenarioComparison(sc.id, sc.title, loadedRuntimes);

    unifiedComparison.scenarios[sc.id] = {
      title: sc.title,
      runtimes: {},
    };

    for (const rt of loadedRuntimes) {
      const scData = rt.data?.scenarios?.[sc.id];
      if (scData) {
        unifiedComparison.scenarios[sc.id].runtimes[rt.key] = {
          p50WriteMs: scData.metrics.writeMs.p50,
          p99WriteMs: scData.metrics.writeMs.p99,
          p50ReadMs: scData.metrics.readMs.p50,
          p99ReadMs: scData.metrics.readMs.p99,
          p50TotalMs: scData.metrics.totalMs.p50,
          p99TotalMs: scData.metrics.totalMs.p99,
          p50WriteThroughputMBps: scData.metrics.writeThroughputMBps.p50,
          p50ReadThroughputMBps: scData.metrics.readThroughputMBps.p50,
          p50TotalThroughputMBps: scData.metrics.totalThroughputMBps.p50,
          p50TotalOpsPerSec: scData.metrics.totalOpsPerSec.p50,
          p50RssAfterMB: scData.metrics.rssAfterMB.p50,
          maxRssAfterMB: scData.metrics.rssAfterMB.max,
          fullMetrics: scData.metrics,
        };
      }
    }
  }

  const comparisonPath = await saveJsonResult(
    resultsDir,
    "file_io_comparison.json",
    unifiedComparison,
  );
  console.log(
    `\n  [INFO] Sjednocený porovnávací JSON uložen do: ${comparisonPath}\n`,
  );
}

main().catch((err) => {
  console.error("\n[CHYBA POROVNÁNÍ]:", err);
  process.exitCode = 1;
});
