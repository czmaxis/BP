/**
 * Porovnávací a agregační skript pro Kategorii 1: Výkon HTTP serveru (01-http).
 *
 * Načte souhrnné výsledky (http_summary_node.json, http_summary_deno.json, http_summary_bun.json)
 * ze složky results/, zkontroluje metodickou konzistenci, vykreslí přehlednou srovnávací tabulku
 * do konzole pro všechny tři endpointy (GET /plaintext, GET /json, POST /echo)
 * a uloží sjednocený výstup do results/http_comparison.json.
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
  { key: "node", label: "Node.js", file: "http_summary_node.json" },
  { key: "deno", label: "Deno", file: "http_summary_deno.json" },
  { key: "bun", label: "Bun", file: "http_summary_bun.json" },
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
 * Zkontroluje, zda všechna načtená prostředí běžela na stejné platformě a se stejnou konfigurací
 * (počet měřených iterací N, doba trvání běhu, počet spojení).
 */
function validateMethodologyConsistency(loadedRuntimes) {
  if (loadedRuntimes.length < 2) return;

  const warnings = [];
  const base = loadedRuntimes[0];
  const baseCfg = base.data?.benchmarkConfig;
  const basePlatform = base.data?.environment?.platform;
  const baseArch = base.data?.environment?.arch;

  for (const rt of loadedRuntimes.slice(1)) {
    const rtCfg = rt.data?.benchmarkConfig;
    const rtPlatform = rt.data?.environment?.platform;
    const rtArch = rt.data?.environment?.arch;

    if (
      (basePlatform && rtPlatform && basePlatform !== rtPlatform) ||
      (baseArch && rtArch && baseArch !== rtArch)
    ) {
      warnings.push(
        `Nekonzistentní platforma/architektura: ${base.label} (${basePlatform}/${baseArch}) vs. ${rt.label} (${rtPlatform}/${rtArch}).`,
      );
    }

    if (
      rtCfg?.measuredIterations !== baseCfg?.measuredIterations ||
      rtCfg?.durationSec !== baseCfg?.durationSec ||
      rtCfg?.connections !== baseCfg?.connections
    ) {
      warnings.push(
        `Odlišné parametry zátěže: ${base.label} (N=${baseCfg?.measuredIterations}, ${baseCfg?.durationSec}s, ${baseCfg?.connections} conn) vs. ${rt.label} (N=${rtCfg?.measuredIterations}, ${rtCfg?.durationSec}s, ${rtCfg?.connections} conn).`,
      );
    }
  }

  if (warnings.length > 0) {
    console.warn(
      "\n  [VAROVÁNÍ METODIKY] Zjištěna nekonzistence mezi porovnávanými výsledky:",
    );
    for (const w of warnings) {
      console.warn(`    ! ${w}`);
    }
  }
}

/**
 * Vykreslí porovnávací tabulku jednoho HTTP endpointu napříč dostupnými běhovými prostředími.
 */
function printScenarioComparison(scenarioId, scenarioTitle, loadedRuntimes) {
  const line = "═".repeat(108);
  const thinLine = "─".repeat(108);

  console.log(`\n${line}`);
  console.log(`  SROVNÁNÍ BĚHOVÝCH PROSTŘEDÍ – ${scenarioTitle}`);
  console.log(line);

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
      key: "rps",
      label: "Propustnost (req/s)",
      unit: "req/s",
      lowerIsBetter: false,
    },
    {
      key: "throughputMBps",
      label: "Datový tok (MB/s)",
      unit: "MB/s",
      lowerIsBetter: false,
    },
    {
      key: "latencyP50Ms",
      label: "Latence p50 (ms)",
      unit: "ms",
      lowerIsBetter: true,
    },
    {
      key: "latencyP95Ms",
      label: "Latence p95 (ms)",
      unit: "ms",
      lowerIsBetter: true,
    },
    {
      key: "latencyP99Ms",
      label: "Latence p99 / Tail (ms)",
      unit: "ms",
      lowerIsBetter: true,
    },
    {
      key: "latencyMeanMs",
      label: "Průměrná latence (ms)",
      unit: "ms",
      lowerIsBetter: true,
    },
    {
      key: "rssAfterMB",
      label: "Paměť RSS po běhu (MB)",
      unit: "MB",
      lowerIsBetter: true,
      showMaxInP99: true,
    },
    {
      key: "rssPeakMB",
      label: "Paměť RSS špička (MB)",
      unit: "MB",
      lowerIsBetter: true,
      showMaxInP99: true,
    },
  ];

  for (const metricDef of metricRows) {
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
    console.error("Nebyla nalezena žádná HTTP summary data ve složce results/.");
    process.exitCode = 1;
    return;
  }

  console.log(
    "\n╔══════════════════════════════════════════════════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║          KŘÍŽOVÉ POROVNÁNÍ: KATEGORIE 1 – VÝKON HTTP SERVERU (NODE.JS vs. DENO vs. BUN)                  ║",
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════════════════════════════════════════════════╝",
  );

  for (const rt of loadedRuntimes) {
    const cfg = rt.data.benchmarkConfig ?? {};
    console.log(
      `  • ${padRight(rt.label, 10)} : ${rt.version} (N = ${cfg.measuredIterations ?? 10} × ${cfg.durationSec ?? 30}s, Warmup = ${cfg.warmupDurationSec ?? 10}s, Spojení = ${cfg.connections ?? 50})`,
    );
  }
  console.log("  (★ označuje nejlepší medián p50 v dané disciplíně)");

  validateMethodologyConsistency(loadedRuntimes);

  const scenarioDefs = [
    {
      id: "http-get-plaintext",
      title: "Varianta A: GET /plaintext (Hrubá propustnost HTTP a Event Loopu)",
    },
    {
      id: "http-get-json",
      title: "Varianta B: GET /json (Serializace polymorfního JSON – 50 záznamů)",
    },
    {
      id: "http-post-echo",
      title: "Varianta C: POST /echo (Čtení streamu těla, JSON.parse a JSON.stringify)",
    },
  ];

  const unifiedComparison = {
    category: "01-http",
    generatedAt: new Date().toISOString(),
    environments: {},
    scenarios: {},
  };

  for (const rt of loadedRuntimes) {
    unifiedComparison.environments[rt.key] = rt.data.environment;
  }

  for (const sc of scenarioDefs) {
    const hasAnyData = loadedRuntimes.some(
      (rt) => rt.data?.scenarios?.[sc.id] !== undefined,
    );
    if (!hasAnyData) continue;

    printScenarioComparison(sc.id, sc.title, loadedRuntimes);

    unifiedComparison.scenarios[sc.id] = {
      title: sc.title,
      runtimes: {},
    };

    for (const rt of loadedRuntimes) {
      const scData = rt.data?.scenarios?.[sc.id];
      if (scData) {
        unifiedComparison.scenarios[sc.id].runtimes[rt.key] = {
          p50Rps: scData.metrics.rps.p50,
          meanRps: scData.metrics.rps.mean,
          p50ThroughputMBps: scData.metrics.throughputMBps.p50,
          p50LatencyP50Ms: scData.metrics.latencyP50Ms.p50,
          p50LatencyP95Ms: scData.metrics.latencyP95Ms.p50,
          p50LatencyP99Ms: scData.metrics.latencyP99Ms.p50,
          p99LatencyP99Ms: scData.metrics.latencyP99Ms.p99,
          p50RssAfterMB: scData.metrics.rssAfterMB.p50,
          maxRssAfterMB: scData.metrics.rssAfterMB.max,
          maxRssPeakMB:
            scData.metrics.rssPeakMB?.max ?? scData.metrics.rssAfterMB.max,
          fullMetrics: scData.metrics,
        };
      }
    }
  }

  const comparisonPath = await saveJsonResult(
    resultsDir,
    "http_comparison.json",
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
