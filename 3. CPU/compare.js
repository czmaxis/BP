/**
 * Porovnávací a verifikační skript pro Kategorii 3: CPU-náročné úlohy (03-cpu).
 *
 * 1. Načte souhrnné výsledky (cpu_summary_node.json, cpu_summary_deno.json, cpu_summary_bun.json).
 * 2. Zkontroluje metodickou konzistenci a EXAKTNÍ SHODU KONTROLNÍCH SOUČTŮ (checksum)
 *    mezi Node.js, Deno a Bun pro každou výpočetní variantu (A, B, C).
 * 3. Vykreslí přehlednou srovnávací tabulku (Medián p50, IQR, p95, p99, Průměr ± σ)
 *    a uloží sjednocený výstup do results/cpu_comparison.json.
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
  { key: "node", label: "Node.js", file: "cpu_summary_node.json" },
  { key: "deno", label: "Deno", file: "cpu_summary_deno.json" },
  { key: "bun", label: "Bun", file: "cpu_summary_bun.json" },
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
 * Zkontroluje metodickou konzistenci a bitovou shodu kontrolních součtů (checksum)
 * napříč všemi načtenými prostředími (Node.js, Deno, Bun).
 */
function validateMethodologyAndChecksums(loadedRuntimes) {
  if (loadedRuntimes.length < 2) return { allChecksumsMatch: true };

  const warnings = [];
  const checksumMismatches = [];
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
        `Nekonzistentní počet iterací: ${base.label} (N=${baseN}, Warmup=${baseWarmup}) vs. ${rt.label} (N=${rtN}, Warmup=${rtWarmup}).`,
      );
    }

    const scenarioIds = Object.keys(base.data?.scenarios ?? {});
    for (const scId of scenarioIds) {
      const baseSc = base.data?.scenarios?.[scId];
      const rtSc = rt.data?.scenarios?.[scId];
      if (!baseSc || !rtSc) continue;

      const baseCfg = JSON.stringify(baseSc.config);
      const rtCfg = JSON.stringify(rtSc.config);
      if (baseCfg !== rtCfg) {
        warnings.push(
          `Odlišná konfigurace scénáře "${scId}" mezi ${base.label} a ${rt.label}.`,
        );
      }

      if (baseSc.checksum !== rtSc.checksum) {
        checksumMismatches.push(
          `Neshoda kontrolního součtu (checksum) u scénáře "${scId}": ${base.label}=${baseSc.checksumHex} (${baseSc.checksum}) vs. ${rt.label}=${rtSc.checksumHex} (${rtSc.checksum})!`,
        );
      }
    }
  }

  console.log("\n  Verifikace deterministických kontrolních součtů (Anti-DCE Checksum):");
  const allScenarioIds = Object.keys(base.data?.scenarios ?? {});
  for (const scId of allScenarioIds) {
    const parts = loadedRuntimes
      .map((rt) => {
        const sc = rt.data?.scenarios?.[scId];
        return sc ? `${rt.label}: ${sc.checksumHex}` : null;
      })
      .filter(Boolean);
    const allEqual = loadedRuntimes.every(
      (rt) =>
        rt.data?.scenarios?.[scId]?.checksum ===
        base.data?.scenarios?.[scId]?.checksum,
    );
    const status = allEqual ? "✓ SHODNÉ" : "✗ NESHODA";
    console.log(`    • ${padRight(scId, 24)} -> [${status}] (${parts.join(" | ")})`);
  }

  if (warnings.length > 0) {
    console.warn(
      "\n  [VAROVÁNÍ METODIKY] Zjištěna nekonzistence mezi porovnávanými výsledky:",
    );
    for (const w of warnings) {
      console.warn(`    ! ${w}`);
    }
  }

  if (checksumMismatches.length > 0) {
    for (const m of checksumMismatches) {
      console.error(`  [CHYBA INTEGRITY CHECKSUMU]: ${m}`);
    }
    throw new Error(
      "Kontrolní součty mezi běhovými prostředími se neshodují!",
    );
  }

  return { allChecksumsMatch: true };
}

/**
 * Vykreslí porovnávací tabulku jednoho CPU scénáře napříč dostupnými běhovými prostředími.
 */
function printScenarioComparison(scenarioId, scenarioTitle, loadedRuntimes) {
  const line = "═".repeat(118);
  const thinLine = "─".repeat(118);

  console.log(`\n${line}`);
  console.log(`  SROVNÁNÍ BĚHOVÝCH PROSTŘEDÍ – ${scenarioTitle}`);
  console.log(line);

  console.log(
    `  ${padRight("Metrika", 24)} | ` +
      `${padRight("Běhové prostředí", 16)} | ` +
      `${padLeft("Medián (p50)", 13)} | ` +
      `${padLeft("IQR", 9)} | ` +
      `${padLeft("p95", 10)} | ` +
      `${padLeft("Tail (p99)", 11)} | ` +
      `${padLeft("Průměr ± σ", 19)}`,
  );
  console.log(`  ${thinLine}`);

  const metricRows = [
    {
      key: "durationMs",
      label: "Doba výpočtu (ms)",
      unit: "ms",
      lowerIsBetter: true,
    },
    {
      key: "opsPerSec",
      label: "Výkon (op/s)",
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
        idx === 0 ? padRight(metricDef.label, 24) : padRight("", 24);

      if (!m) {
        console.log(
          `  ${metricCell} | ${padRight(rt.label, 16)} | ${padLeft("N/A", 13)} | ${padLeft("N/A", 9)} | ${padLeft("N/A", 10)} | ${padLeft("N/A", 11)} | ${padLeft("N/A", 19)}`,
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
          `${padLeft(formatNum(m.iqr, 2), 9)} | ` +
          `${padLeft(formatNum(m.p95, 2), 10)} | ` +
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
    console.error("Nebyla nalezena žádná CPU summary data ve složce results/.");
    process.exitCode = 1;
    return;
  }

  console.log(
    "\n╔════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║              KŘÍŽOVÉ POROVNÁNÍ: KATEGORIE 3 – CPU-NÁROČNÉ ÚLOHY (NODE.JS vs. DENO vs. BUN)                         ║",
  );
  console.log(
    "╚════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝",
  );

  for (const rt of loadedRuntimes) {
    const globalHex = rt.data.globalChecksum?.hex ?? "N/A";
    console.log(
      `  • ${padRight(rt.label, 10)} : ${rt.version} (N = ${rt.data.benchmarkConfig?.measuredIterations ?? 30}, Warmup = ${rt.data.benchmarkConfig?.warmupIterations ?? 50}, Global Checksum = ${globalHex})`,
    );
  }
  console.log("  (★ označuje nejlepší medián p50 v dané disciplíně)");

  const { allChecksumsMatch } = validateMethodologyAndChecksums(loadedRuntimes);

  const scenarioDefs = [
    {
      id: "cpu-crypto-webcrypto",
      title: "Varianta A: Kryptografické hashování (WebCrypto PBKDF2 + SHA-512)",
    },
    {
      id: "cpu-json-polymorphic",
      title: "Varianta B: Polymorfní JSON transformace a řazení (10 000 záznamů)",
    },
    {
      id: "cpu-matrix-multiply",
      title: "Varianta C: Numerické a maticové výpočty (250×250 Float64Array)",
    },
  ];

  const unifiedComparison = {
    category: "03-cpu",
    generatedAt: new Date().toISOString(),
    allChecksumsVerified: allChecksumsMatch,
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
      checksumHex:
        loadedRuntimes[0]?.data?.scenarios?.[sc.id]?.checksumHex ?? null,
      runtimes: {},
    };

    for (const rt of loadedRuntimes) {
      const scData = rt.data?.scenarios?.[sc.id];
      if (scData) {
        unifiedComparison.scenarios[sc.id].runtimes[rt.key] = {
          checksum: scData.checksum,
          checksumHex: scData.checksumHex,
          p50DurationMs: scData.metrics.durationMs.p50,
          iqrDurationMs: scData.metrics.durationMs.iqr,
          p95DurationMs: scData.metrics.durationMs.p95,
          p99DurationMs: scData.metrics.durationMs.p99,
          meanDurationMs: scData.metrics.durationMs.mean,
          stdDevDurationMs: scData.metrics.durationMs.stdDev,
          p50OpsPerSec: scData.metrics.opsPerSec.p50,
          meanOpsPerSec: scData.metrics.opsPerSec.mean,
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
    "cpu_comparison.json",
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
