/**
 * Externí orchestrátor a metodika měření pro Kategorii 5: Doba spuštění (05-startup).
 *
 * Zajišťuje:
 * 1. Externí měření celkového wall-clock času od vyvolání podprocesu v OS (`spawnSync` se `shell: false`)
 *    až po jeho kompletní ukončení (`exitCode === 0`) pomocí `process.hrtime.bigint()`.
 * 2. Ověření očekávaného výstupu na `stdout` u každého jednotlivého startu.
 * 3. Metodiku "Warm disk cache, Cold runtime":
 *    - 3 zahřívací starty nanečisto (výsledky se zahazují) pro načtení binárky a skriptů do OS page cache.
 *    - N = 100 měřených studených startů nového procesu s krátkým cooldownem (12 ms) mezi starty.
 * 4. Výpočet statistik (p50, IQR, p95, p99, průměr, směrodatná odchylka, min, max) a uložení
 *    do `results/startup_raw_<runtime>.json` a `results/startup_summary_<runtime>.json`.
 */

import path from "node:path";
import { exportBenchmarkResults } from "./fs-helper.js";
import { measureProcessStartupSync, runExternalCommand } from "./process.js";
import { getEnvironmentMetadata } from "./runtime.js";
import {
  buildStartupScenarioSummary,
  computeStartupIterationMetrics,
} from "./stats.js";

export const EXPECTED_MINIMAL_OUTPUT = "ready";
export const EXPECTED_REALISTIC_OUTPUT =
  "ready:edge-gateway-benchmark:routes=5:limit=1400:checksum=0x081c2c15";

/**
 * Vypíše formátovanou hlavičku do konzole.
 */
export function logSection(title) {
  const line = "═".repeat(72);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(`${line}`);
}

/**
 * Vypíše informační zprávu s časovým razítkem.
 */
export function logInfo(message) {
  const now = new Date().toISOString().slice(11, 23);
  console.log(`[${now}] ${message}`);
}

/**
 * Vypíše průběh spuštění (Warmup nebo Měření).
 */
export function logStartupIteration(phase, current, total, metrics) {
  const indexStr = `${String(current).padStart(3, " ")}/${String(total).padStart(3, " ")}`;
  const tag = phase === "WARMUP" ? "WARMUP" : "MĚŘENÍ";
  console.log(
    `  [${tag} ${indexStr}] ` +
      `Doba startu: ${metrics.startupMs.toFixed(2).padStart(7, " ")} ms | ` +
      `Frekvence: ${metrics.startsPerSec.toFixed(2).padStart(7, " ")} startů/s | ` +
      `Výstup: "${metrics.output}"`,
  );
}

/**
 * Vypíše souhrnnou statistickou tabulku pro danou variantu spuštění.
 */
export function logStartupScenarioSummary(scenarioTitle, summary) {
  console.log(
    `\n  Souhrnné výsledky – ${scenarioTitle} (N = ${summary.iterations}):`,
  );
  console.log(
    "  ──────────────────────────────────────────────────────────────────────",
  );

  const formatRow = (label, stats, unit) =>
    `  ${label.padEnd(20, " ")} | ` +
    `p50: ${String(stats.p50.toFixed(2)).padStart(7, " ")} ${unit} | ` +
    `IQR: ${String(stats.iqr.toFixed(2)).padStart(6, " ")} ${unit} | ` +
    `p95: ${String(stats.p95.toFixed(2)).padStart(7, " ")} ${unit} | ` +
    `p99: ${String(stats.p99.toFixed(2)).padStart(7, " ")} ${unit} | ` +
    `min: ${String(stats.min.toFixed(2)).padStart(6, " ")} | ` +
    `max: ${String(stats.max.toFixed(2)).padStart(7, " ")} | ` +
    `Ø: ${String(stats.mean.toFixed(2)).padStart(7, " ")} ± ${String(stats.stdDev.toFixed(2)).padStart(6, " ")} ${unit}`;

  console.log(formatRow("Doba spuštění", summary.metrics.startupMs, "ms"));
  console.log(formatRow("Spuštění za sekundu", summary.metrics.startsPerSec, "/s"));
  console.log(
    "  ──────────────────────────────────────────────────────────────────────",
  );
}

/**
 * Získá sanitizovaná metadata cílového běhového prostředí (Node.js, Deno, Bun)
 * jednorázovým dotazem před zahájením měření.
 */
export async function probeTargetRuntimeMetadata(runtimeKey, binaryPath, projectRoot) {
  const baseEnv = getEnvironmentMetadata();
  if (runtimeKey === "node") {
    return {
      ...baseEnv,
      runtime: "node",
    };
  }

  try {
    if (runtimeKey === "deno") {
      const { stdout } = await runExternalCommand(
        binaryPath,
        [
          "eval",
          "console.log(JSON.stringify({ deno: Deno.version.deno, v8: Deno.version.v8, ts: Deno.version.typescript }))",
        ],
        { silent: true, cwd: projectRoot },
      );
      const v = JSON.parse(stdout.trim());
      return {
        ...baseEnv,
        runtime: "deno",
        version: `v${v.deno} (V8 ${v.v8}, TS ${v.ts})`,
      };
    }

    if (runtimeKey === "bun") {
      const { stdout } = await runExternalCommand(
        binaryPath,
        [
          "-e",
          "console.log(JSON.stringify({ version: Bun.version, rev: Bun.revision ? Bun.revision.slice(0, 8) : '' }))",
        ],
        { silent: true, cwd: projectRoot },
      );
      const v = JSON.parse(stdout.trim());
      return {
        ...baseEnv,
        runtime: "bun",
        version: `v${v.version}${v.rev ? ` (${v.rev})` : ""}`,
      };
    }
  } catch {
    // Fallback při nedostupnosti eval
  }

  return {
    ...baseEnv,
    runtime: runtimeKey,
  };
}

/**
 * Sestaví definice obou scénářů (Varianta A: minimal, Varianta B: realistic) pro daný runtime.
 */
export function buildRuntimeStartupScenarios(runtimeKey, binaryPath, projectRoot) {
  const scenariosDir = path.join(projectRoot, "scenarios", "05-startup");

  if (runtimeKey === "node") {
    const minimalScript = path.join(scenariosDir, "node-minimal.mjs");
    const realisticScript = path.join(scenariosDir, "node-realistic.ts");
    return {
      minimal: {
        id: "startup-minimal",
        name: "Varianta A: Minimální studený start (minimal)",
        description:
          "Čistý studený start procesu (node scenarios/05-startup/node-minimal.mjs) s výpisem 'ready' a okamžitým ukončením.",
        binary: binaryPath,
        args: [minimalScript],
        expectedOutput: EXPECTED_MINIMAL_OUTPUT,
        config: {
          variant: "minimal",
          command: `node scenarios/05-startup/node-minimal.mjs`,
        },
      },
      realistic: {
        id: "startup-realistic",
        name: "Varianta B: Reálný modulární start s TypeScriptem (realistic)",
        description:
          "Start s nativním TypeScriptem (node --experimental-strip-types --no-warnings scenarios/05-startup/node-realistic.ts), importem modulů z core/ a validací manifestu.",
        binary: binaryPath,
        args: [
          "--experimental-strip-types",
          "--no-warnings",
          realisticScript,
        ],
        expectedOutput: EXPECTED_REALISTIC_OUTPUT,
        config: {
          variant: "realistic",
          command: `node --experimental-strip-types --no-warnings scenarios/05-startup/node-realistic.ts`,
        },
      },
    };
  }

  if (runtimeKey === "deno") {
    const minimalScript = path.join(scenariosDir, "deno-minimal.ts");
    const realisticScript = path.join(scenariosDir, "deno-realistic.ts");
    return {
      minimal: {
        id: "startup-minimal",
        name: "Varianta A: Minimální studený start (minimal)",
        description:
          "Čistý studený start procesu (deno run scenarios/05-startup/deno-minimal.ts) s výpisem 'ready' a okamžitým ukončením.",
        binary: binaryPath,
        args: ["run", minimalScript],
        expectedOutput: EXPECTED_MINIMAL_OUTPUT,
        config: {
          variant: "minimal",
          command: `deno run scenarios/05-startup/deno-minimal.ts`,
        },
      },
      realistic: {
        id: "startup-realistic",
        name: "Varianta B: Reálný modulární start s TypeScriptem (realistic)",
        description:
          "Start s nativním TypeScriptem (deno run scenarios/05-startup/deno-realistic.ts), importem modulů z core/ a validací manifestu.",
        binary: binaryPath,
        args: ["run", realisticScript],
        expectedOutput: EXPECTED_REALISTIC_OUTPUT,
        config: {
          variant: "realistic",
          command: `deno run scenarios/05-startup/deno-realistic.ts`,
        },
      },
    };
  }

  if (runtimeKey === "bun") {
    const minimalScript = path.join(scenariosDir, "bun-minimal.ts");
    const realisticScript = path.join(scenariosDir, "bun-realistic.ts");
    return {
      minimal: {
        id: "startup-minimal",
        name: "Varianta A: Minimální studený start (minimal)",
        description:
          "Čistý studený start procesu (bun run scenarios/05-startup/bun-minimal.ts) s výpisem 'ready' a okamžitým ukončením.",
        binary: binaryPath,
        args: ["run", minimalScript],
        expectedOutput: EXPECTED_MINIMAL_OUTPUT,
        config: {
          variant: "minimal",
          command: `bun run scenarios/05-startup/bun-minimal.ts`,
        },
      },
      realistic: {
        id: "startup-realistic",
        name: "Varianta B: Reálný modulární start s TypeScriptem (realistic)",
        description:
          "Start s nativním TypeScriptem (bun run scenarios/05-startup/bun-realistic.ts), importem modulů z core/ a validací manifestu.",
        binary: binaryPath,
        args: ["run", realisticScript],
        expectedOutput: EXPECTED_REALISTIC_OUTPUT,
        config: {
          variant: "realistic",
          command: `bun run scenarios/05-startup/bun-realistic.ts`,
        },
      },
    };
  }

  throw new Error(`Neznámé běhové prostředí: ${runtimeKey}`);
}

/**
 * Spustí měření jednoho scénáře spuštění (Warmup = 3, Měření N = 100 s cooldownem).
 */
export async function executeStartupScenario({
  scenarioDef,
  warmupCount,
  iterationCount,
  cooldownMs,
  projectRoot,
}) {
  logSection(scenarioDef.name);
  logInfo(`Popis: ${scenarioDef.description}`);
  logInfo(`Příkaz: ${scenarioDef.config.command}`);
  logInfo(
    `Metodika (Warm disk cache, Cold runtime): Warmup = ${warmupCount} startů | Měřené starty: N = ${iterationCount} | Cooldown = ${cooldownMs} ms`,
  );

  // 1. Zahřívací fáze (Warm disk cache) – výsledky se zahazují
  for (let w = 1; w <= warmupCount; w++) {
    const { startupMs, stdout } = measureProcessStartupSync(
      scenarioDef.binary,
      scenarioDef.args,
      {
        cwd: projectRoot,
        expectedOutput: scenarioDef.expectedOutput,
      },
    );
    const warmupMetrics = computeStartupIterationMetrics({
      iterationIndex: w,
      startupMs,
      output: stdout,
    });
    logStartupIteration("WARMUP", w, warmupCount, warmupMetrics);

    if (cooldownMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, cooldownMs));
    }
  }

  console.log(
    "  ----------------------------------------------------------------------",
  );

  // 2. Měřená fáze (N = 100 nezávislých studených startů procesu)
  const rawResults = [];
  const logStep = iterationCount > 20 ? Math.max(1, Math.floor(iterationCount / 10)) : 1;

  for (let i = 1; i <= iterationCount; i++) {
    const { startupMs, stdout } = measureProcessStartupSync(
      scenarioDef.binary,
      scenarioDef.args,
      {
        cwd: projectRoot,
        expectedOutput: scenarioDef.expectedOutput,
      },
    );

    const metrics = computeStartupIterationMetrics({
      iterationIndex: i,
      startupMs,
      output: stdout,
    });

    rawResults.push(metrics);

    if (i === 1 || i === iterationCount || i % logStep === 0) {
      logStartupIteration("RUN", i, iterationCount, metrics);
    }

    if (cooldownMs > 0 && i < iterationCount) {
      await new Promise((resolve) => setTimeout(resolve, cooldownMs));
    }
  }

  const summary = buildStartupScenarioSummary(
    scenarioDef,
    rawResults,
    warmupCount,
  );
  logStartupScenarioSummary(scenarioDef.name, summary);

  return {
    raw: {
      scenarioId: scenarioDef.id,
      name: scenarioDef.name,
      config: scenarioDef.config,
      warmupIterations: warmupCount,
      measuredIterations: iterationCount,
      expectedOutput: scenarioDef.expectedOutput,
      iterations: rawResults,
    },
    summary,
  };
}

/**
 * Spustí kompletní sadu Startup testů (Varianta A: minimal, Varianta B: realistic)
 * pro jedno vybrané běhové prostředí a uloží výsledky do `results/`.
 */
export async function runStartupBenchmarkForRuntime({
  runtimeKey,
  runtimeLabel,
  binaryPath,
  config,
  projectRoot,
  resultsDir,
}) {
  const environment = await probeTargetRuntimeMetadata(
    runtimeKey,
    binaryPath,
    projectRoot,
  );
  const warmupCount = config.benchmark.warmupIterations;
  const iterationCount = config.benchmark.startupIterations;
  const cooldownMs = config.benchmark.cooldownMs ?? 12;

  logSection(
    `BENCHMARK KATEGORIE 5: DOBA SPUŠTĚNÍ (${runtimeLabel.toUpperCase()} ${environment.version})`,
  );
  logInfo(
    `Platforma: ${environment.platform} (${environment.arch}) | CPU: ${environment.cpuModel} (${environment.cpuCores} jader) | RAM: ${environment.totalMemoryMB} MB`,
  );
  logInfo(
    `Konfigurace: Warmup = ${warmupCount}, Měřené starty N = ${iterationCount}, Cooldown = ${cooldownMs} ms`,
  );

  const scenarioMap = buildRuntimeStartupScenarios(
    runtimeKey,
    binaryPath,
    projectRoot,
  );

  const allRawScenarios = {};
  const allSummaryScenarios = {};

  const variantKeys = ["minimal", "realistic"];
  for (let idx = 0; idx < variantKeys.length; idx++) {
    const vKey = variantKeys[idx];
    if (!config.scenarios[vKey]?.enabled) continue;

    const scenarioDef = scenarioMap[vKey];
    const { raw, summary } = await executeStartupScenario({
      scenarioDef,
      warmupCount,
      iterationCount,
      cooldownMs,
      projectRoot,
    });

    allRawScenarios[scenarioDef.id] = raw;
    allSummaryScenarios[scenarioDef.id] = summary;

    if (idx < variantKeys.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  const benchmarkConfigSummary = {
    warmupIterations: warmupCount,
    measuredIterations: iterationCount,
    startupIterations: iterationCount,
    cooldownMs,
  };

  const { savedRawPath, savedSummaryPath } = await exportBenchmarkResults({
    resultsDir,
    category: config.category,
    environment,
    benchmarkConfig: benchmarkConfigSummary,
    allRawScenarios,
    allSummaryScenarios,
    filePrefix: "startup",
  });

  logSection(`STARTUP BENCHMARK ${runtimeLabel.toUpperCase()} DOKONČEN`);
  logInfo(
    `Surová data (N = ${iterationCount}) uložena do: ${savedRawPath}`,
  );
  logInfo(
    `Agregované statistiky (p50, IQR, p95, p99, min, max, Ø, σ) uloženy do: ${savedSummaryPath}`,
  );
}
