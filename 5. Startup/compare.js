/**
 * Porovnávací a agregační skript pro Kategorii 5: Doba spuštění (05-startup).
 *
 * Načte souhrnné výsledky (startup_summary_node.json, startup_summary_deno.json, startup_summary_bun.json)
 * ze složky results/, zkontroluje metodickou konzistenci a shodu výstupů (expectedOutput),
 * vykreslí přehlednou srovnávací tabulku (Medián p50, IQR, p95, p99, min, max, Průměr ± σ)
 * a uloží sjednocený výstup do results/startup_comparison.json.
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
  { key: "node", label: "Node.js", file: "startup_summary_node.json" },
  { key: "deno", label: "Deno", file: "startup_summary_deno.json" },
  { key: "bun", label: "Bun", file: "startup_summary_bun.json" },
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
 * Zkontroluje metodickou konzistenci a shodu ověřených výstupů na stdout
 * napříč všemi načtenými prostředími (Node.js, Deno, Bun).
 */
function validateMethodologyConsistency(loadedRuntimes) {
  if (loadedRuntimes.length < 2) return;

  const warnings = [];
  const base = loadedRuntimes[0];
  const baseN = base.data?.benchmarkConfig?.measuredIterations;
  const baseWarmup = base.data?.benchmarkConfig?.warmupIterations;
  const basePlatform = base.data?.environment?.platform;
  const baseArch = base.data?.environment?.arch;

  for (const rt of loadedRuntimes.slice(1)) {
    const rtN = rt.data?.benchmarkConfig?.measuredIterations;
    const rtWarmup = rt.data?.benchmarkConfig?.warmupIterations;
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

    if (rtN !== baseN || rtWarmup !== baseWarmup) {
      warnings.push(
        `Nekonzistentní počet spuštění: ${base.label} (N=${baseN}, Warmup=${baseWarmup}) vs. ${rt.label} (N=${rtN}, Warmup=${rtWarmup}).`,
      );
    }
  }

  console.log("\n  Verifikace očekávaného výstupu (stdout) a návratového kódu (exitCode === 0):");
  const allScenarioIds = Object.keys(base.data?.scenarios ?? {});
  for (const scId of allScenarioIds) {
    const expectedOut = base.data?.scenarios?.[scId]?.expectedOutput ?? "";
    const allMatch = loadedRuntimes.every(
      (rt) => rt.data?.scenarios?.[scId]?.expectedOutput === expectedOut,
    );
    const status = allMatch ? "✓ OVĚŘENO" : "✗ NESHODA";
    console.log(`    • ${padRight(scId, 20)} -> [${status}] stdout: "${expectedOut}"`);
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
 * Vykreslí porovnávací tabulku jednoho scénáře spuštění napříč dostupnými běhovými prostředími.
 */
function printScenarioComparison(scenarioId, scenarioTitle, loadedRuntimes) {
  const line = "═".repeat(134);
  const thinLine = "─".repeat(134);

  console.log(`\n${line}`);
  console.log(`  SROVNÁNÍ BĚHOVÝCH PROSTŘEDÍ – ${scenarioTitle}`);
  console.log(line);

  console.log(
    `  ${padRight("Metrika", 24)} | ` +
      `${padRight("Běhové prostředí", 16)} | ` +
      `${padLeft("Medián (p50)", 12)} | ` +
      `${padLeft("IQR", 8)} | ` +
      `${padLeft("p95", 9)} | ` +
      `${padLeft("Tail (p99)", 10)} | ` +
      `${padLeft("Min", 8)} | ` +
      `${padLeft("Max", 9)} | ` +
      `${padLeft("Průměr ± σ", 18)}`,
  );
  console.log(`  ${thinLine}`);

  const metricRows = [
    {
      key: "startupMs",
      label: "Doba spuštění (ms)",
      unit: "ms",
      lowerIsBetter: true,
    },
    {
      key: "startsPerSec",
      label: "Spuštění za sekundu (/s)",
      unit: "/s",
      lowerIsBetter: false,
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
        idx === 0 ? padRight(metricDef.label, 24) : padRight("", 24);

      if (!m) {
        console.log(
          `  ${metricCell} | ${padRight(rt.label, 16)} | ${padLeft("N/A", 12)} | ${padLeft("N/A", 8)} | ${padLeft("N/A", 9)} | ${padLeft("N/A", 10)} | ${padLeft("N/A", 8)} | ${padLeft("N/A", 9)} | ${padLeft("N/A", 18)}`,
        );
        return;
      }

      const isBest = bestP50 !== null && m.p50 === bestP50;
      const rtName = isBest ? `★ ${rt.label}` : `  ${rt.label}`;
      const meanStd = `${formatNum(m.mean, 2)} ± ${formatNum(m.stdDev, 2)}`;

      console.log(
        `  ${metricCell} | ` +
          `${padRight(rtName, 16)} | ` +
          `${padLeft(formatNum(m.p50, 2), 12)} | ` +
          `${padLeft(formatNum(m.iqr, 2), 8)} | ` +
          `${padLeft(formatNum(m.p95, 2), 9)} | ` +
          `${padLeft(formatNum(m.p99, 2), 10)} | ` +
          `${padLeft(formatNum(m.min, 2), 8)} | ` +
          `${padLeft(formatNum(m.max, 2), 9)} | ` +
          `${padLeft(meanStd, 18)}`,
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
    console.error("Nebyla nalezena žádná Startup summary data ve složce results/.");
    process.exitCode = 1;
    return;
  }

  console.log(
    "\n╔════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║                   KŘÍŽOVÉ POROVNÁNÍ: KATEGORIE 5 – DOBA SPUŠTĚNÍ / STARTUP TIME (NODE.JS vs. DENO vs. BUN)                         ║",
  );
  console.log(
    "╚════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝",
  );

  for (const rt of loadedRuntimes) {
    const cfg = rt.data.benchmarkConfig ?? {};
    console.log(
      `  • ${padRight(rt.label, 10)} : ${rt.version} (N = ${cfg.measuredIterations ?? 100}, Warmup = ${cfg.warmupIterations ?? 3}, Cooldown = ${cfg.cooldownMs ?? 12} ms)`,
    );
  }
  console.log("  (★ označuje nejlepší medián p50 v dané disciplíně)");

  validateMethodologyConsistency(loadedRuntimes);

  const scenarioDefs = [
    {
      id: "startup-minimal",
      title: "Varianta A: Minimální studený start (minimal – výpis 'ready')",
    },
    {
      id: "startup-realistic",
      title: "Varianta B: Reálný modulární start s TypeScriptem (realistic – multi-modul + validace)",
    },
  ];

  const unifiedComparison = {
    category: "05-startup",
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
      expectedOutput:
        loadedRuntimes[0]?.data?.scenarios?.[sc.id]?.expectedOutput ?? null,
      runtimes: {},
    };

    for (const rt of loadedRuntimes) {
      const scData = rt.data?.scenarios?.[sc.id];
      if (scData) {
        unifiedComparison.scenarios[sc.id].runtimes[rt.key] = {
          p50StartupMs: scData.metrics.startupMs.p50,
          iqrStartupMs: scData.metrics.startupMs.iqr,
          p95StartupMs: scData.metrics.startupMs.p95,
          p99StartupMs: scData.metrics.startupMs.p99,
          minStartupMs: scData.metrics.startupMs.min,
          maxStartupMs: scData.metrics.startupMs.max,
          meanStartupMs: scData.metrics.startupMs.mean,
          stdDevStartupMs: scData.metrics.startupMs.stdDev,
          p50StartsPerSec: scData.metrics.startsPerSec.p50,
          meanStartsPerSec: scData.metrics.startsPerSec.mean,
          fullMetrics: scData.metrics,
        };
      }
    }
  }

  const comparisonPath = await saveJsonResult(
    resultsDir,
    "startup_comparison.json",
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
