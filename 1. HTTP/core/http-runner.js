/**
 * Orchestrátor a metodika měření pro Kategorii 1: Výkon HTTP serveru (01-http).
 *
 * Zajišťuje:
 * 1. Spuštění testovaného HTTP serveru (Node.js, Deno, Bun) v samostatném OS podprocesu.
 * 2. Generování HTTP zátěže z odděleného klientského procesu (autocannon / wrk / builtin-net-keepalive).
 * 3. Sběr RSS paměti mimo měřenou zátěž přes endpoint /metrics (prevence Observer Effectu).
 * 4. Výpočet souhrnných statistik (medián p50, p95, p99, průměr, směrodatná odchylka, IQR, min, max)
 *    z N nezávislých běhů a export do results/http_raw_<runtime>.json a results/http_summary_<runtime>.json.
 */

import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportBenchmarkResults, fileExists } from "./fs-helper.js";
import { ECHO_REQUEST_BODY } from "./http-data.js";
import { logInfo, logSection } from "./logger.js";
import { resolveBinary, runExternalCommand } from "./process.js";
import { bytesToMB, calculateStats, round } from "./stats.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Dotáže se na interní endpoint GET /metrics běžícího HTTP serveru (mimo měřenou zátěž).
 */
export function fetchServerMetrics(host, port, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: host,
        port,
        path: "/metrics",
        timeout: timeoutMs,
        agent: false,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Endpoint /metrics vrátil stav ${res.statusCode}`));
          return;
        }
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("Timeout při dotazu na /metrics"));
    });
    req.on("error", reject);
  });
}

/**
 * Spustí HTTP server daného prostředí jako samostatný podproces a vyčká, dokud nezačne odpovídat na /metrics.
 */
export async function startHttpServerProcess({
  runtimeKey,
  command,
  args,
  cwd,
  host,
  port,
  startupTimeoutMs = 15000,
}) {
  const child = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: host,
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  let stderrLog = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    stderrLog += chunk;
  });

  let exitedEarly = false;
  let exitCode = null;
  child.on("exit", (code) => {
    exitedEarly = true;
    exitCode = code;
  });

  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (exitedEarly) {
      throw new Error(
        `HTTP server (${runtimeKey}) předčasně skončil s kódem ${exitCode}.\n${stderrLog}`,
      );
    }
    try {
      const metrics = await fetchServerMetrics(host, port, 1000);
      return { child, initialMetrics: metrics };
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  await stopHttpServerProcess(child);
  throw new Error(
    `Timeout (${startupTimeoutMs} ms) při čekání na start HTTP serveru (${runtimeKey}) na http://${host}:${port}.\n${stderrLog}`,
  );
}

/**
 * Korektně ukončí proces HTTP serveru (SIGTERM -> SIGKILL) a vyčká na uvolnění prostředků.
 */
export async function stopHttpServerProcess(child) {
  if (!child || child.exitCode !== null || child.killed) {
    return;
  }

  await new Promise((resolve) => {
    const forceTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Proces již skončil
      }
      resolve();
    }, 2000);

    child.once("exit", () => {
      clearTimeout(forceTimer);
      resolve();
    });

    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(forceTimer);
      resolve();
    }
  });
}

/**
 * Detekuje dostupný zátěžový nástroj (autocannon -> wrk -> builtin-net-keepalive).
 */
export async function detectHttpLoadTool(preferredTool = "auto", projectRoot) {
  if (preferredTool === "builtin") {
    return { type: "builtin", bin: process.execPath };
  }

  if (preferredTool === "autocannon" || preferredTool === "auto") {
    const localAutocannon = path.join(
      projectRoot,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "autocannon.cmd" : "autocannon",
    );
    if (await fileExists(localAutocannon)) {
      return { type: "autocannon", bin: localAutocannon };
    }
    const pathAutocannon = await resolveBinary("autocannon");
    if (pathAutocannon) {
      return { type: "autocannon", bin: pathAutocannon };
    }
    if (preferredTool === "autocannon") {
      logInfo(
        'Nástroj "autocannon" nebyl v systému nalezen, přepínám na izolovaný proces builtin-net-keepalive.',
      );
    }
  }

  if (preferredTool === "wrk" || preferredTool === "auto") {
    const wrkBin = await resolveBinary("wrk");
    if (wrkBin) {
      return { type: "wrk", bin: wrkBin };
    }
    if (preferredTool === "wrk") {
      logInfo(
        'Nástroj "wrk" nebyl v systému nalezen, přepínám na izolovaný proces builtin-net-keepalive.',
      );
    }
  }

  return { type: "builtin", bin: process.execPath };
}

/**
 * Spustí zátěžový test v samostatném externím procesu a vrátí sjednocený výsledek.
 */
export async function executeExternalLoadRun({
  loadTool,
  url,
  method = "GET",
  body = null,
  connections = 50,
  durationSec = 30,
  pipelining = 1,
  projectRoot,
}) {
  if (loadTool.type === "autocannon") {
    const args = [
      "--json",
      "-c",
      String(connections),
      "-d",
      String(durationSec),
      "-p",
      String(pipelining),
      "-m",
      method,
    ];
    if (body) {
      args.push("-H", "Content-Type: application/json", "-b", body);
    }
    args.push(url);

    const { stdout } = await runExternalCommand(loadTool.bin, args, {
      silent: true,
      cwd: projectRoot,
      shell: loadTool.bin.endsWith(".cmd"),
    });
    const ac = JSON.parse(stdout.trim());

    return {
      tool: "autocannon",
      durationSec: round(ac.duration || durationSec, 3),
      connections,
      totalRequests: ac.requests?.total ?? ac["2xx"] ?? 0,
      rps: round(ac.requests?.average ?? ac.requests?.mean ?? 0, 2),
      totalBytes: ac.throughput?.total ?? 0,
      throughputMBps: round(bytesToMB(ac.throughput?.average ?? 0), 3),
      errors: (ac.errors ?? 0) + (ac.timeouts ?? 0) + (ac.non2xx ?? 0),
      latency: {
        min: round(ac.latency?.min ?? 0, 3),
        p50: round(ac.latency?.p50 ?? 0, 3),
        p95: round(ac.latency?.p97_5 ?? ac.latency?.p90 ?? 0, 3),
        p99: round(ac.latency?.p99 ?? 0, 3),
        max: round(ac.latency?.max ?? 0, 3),
        mean: round(ac.latency?.average ?? ac.latency?.mean ?? 0, 3),
        stdDev: round(ac.latency?.stddev ?? 0, 3),
      },
    };
  }

  if (loadTool.type === "wrk") {
    const args = [
      "-t4",
      `-c${connections}`,
      `-d${durationSec}s`,
      "--latency",
      url,
    ];
    const { stdout } = await runExternalCommand(loadTool.bin, args, {
      silent: true,
      cwd: projectRoot,
      shell: false,
    });

    const parseTimeMs = (str) => {
      if (!str) return 0;
      const m = /([\d.]+)\s*(us|ms|s)/.exec(str.trim());
      if (!m) return 0;
      const val = Number.parseFloat(m[1]);
      if (m[2] === "us") return val / 1000;
      if (m[2] === "s") return val * 1000;
      return val;
    };

    const rpsMatch = /Requests\/sec:\s*([\d.]+)/i.exec(stdout);
    const rps = rpsMatch ? Number.parseFloat(rpsMatch[1]) : 0;
    const latMatch = /Latency\s+([\d.]+\w+)\s+([\d.]+\w+)\s+([\d.]+\w+)/i.exec(
      stdout,
    );
    const p50Match = /50%\s+([\d.]+\w+)/i.exec(stdout);
    const p90Match = /90%\s+([\d.]+\w+)/i.exec(stdout);
    const p99Match = /99%\s+([\d.]+\w+)/i.exec(stdout);
    const totalReq = Math.round(rps * durationSec);

    return {
      tool: "wrk",
      durationSec,
      connections,
      totalRequests: totalReq,
      rps: round(rps, 2),
      totalBytes: 0,
      throughputMBps: 0,
      errors: 0,
      latency: {
        min: 0,
        p50: round(parseTimeMs(p50Match?.[1]), 3),
        p95: round(parseTimeMs(p90Match?.[1]), 3),
        p99: round(parseTimeMs(p99Match?.[1]), 3),
        max: round(parseTimeMs(latMatch?.[3]), 3),
        mean: round(parseTimeMs(latMatch?.[1]), 3),
        stdDev: round(parseTimeMs(latMatch?.[2]), 3),
      },
    };
  }

  // Samostatný externí proces core/http-load-client.js
  const loadClientScript = path.join(__dirname, "http-load-client.js");
  const args = [
    loadClientScript,
    `--url=${url}`,
    `--method=${method}`,
    `--connections=${connections}`,
    `--duration=${durationSec}`,
  ];
  if (body) {
    args.push(`--body=${body}`);
  }

  const { stdout } = await runExternalCommand(process.execPath, args, {
    silent: true,
    cwd: projectRoot,
    shell: false,
  });

  return JSON.parse(stdout.trim());
}

/**
 * Vypočítá standardizovaný objekt metrik pro jeden měřený běh HTTP benchmarku.
 */
export function computeHttpIterationMetrics({
  iterationIndex,
  loadResult,
  rssBeforeBytes,
  rssAfterBytes,
}) {
  const rssPeakBytes = Math.max(rssBeforeBytes, rssAfterBytes);

  return {
    iteration: iterationIndex,
    durationSec: loadResult.durationSec,
    connections: loadResult.connections,
    totalRequests: loadResult.totalRequests,
    rps: round(loadResult.rps, 2),
    throughputMBps: round(loadResult.throughputMBps, 3),
    latencyP50Ms: round(loadResult.latency.p50, 3),
    latencyP95Ms: round(loadResult.latency.p95, 3),
    latencyP99Ms: round(loadResult.latency.p99, 3),
    latencyMeanMs: round(loadResult.latency.mean, 3),
    latencyStdDevMs: round(loadResult.latency.stdDev, 3),
    latencyMinMs: round(loadResult.latency.min, 3),
    latencyMaxMs: round(loadResult.latency.max, 3),
    errors: loadResult.errors,
    rssBeforeBytes,
    rssAfterBytes,
    rssPeakBytes,
    rssBeforeMB: round(bytesToMB(rssBeforeBytes), 3),
    rssAfterMB: round(bytesToMB(rssAfterBytes), 3),
    rssPeakMB: round(bytesToMB(rssPeakBytes), 3),
    rssDeltaMB: round(bytesToMB(rssAfterBytes - rssBeforeBytes), 3),
  };
}

/**
 * Sestaví souhrnné statistiky z N měřených běhů pro daný HTTP endpoint.
 */
export function buildHttpScenarioSummary(
  endpointDef,
  rawIterations,
  httpConfig,
) {
  const metricDefs = [
    { key: "rps", lowerIsBetter: false, useHarmonicMean: false },
    { key: "throughputMBps", lowerIsBetter: false, useHarmonicMean: false },
    { key: "totalRequests", lowerIsBetter: false, useHarmonicMean: false },
    { key: "latencyP50Ms", lowerIsBetter: true, useHarmonicMean: false },
    { key: "latencyP95Ms", lowerIsBetter: true, useHarmonicMean: false },
    { key: "latencyP99Ms", lowerIsBetter: true, useHarmonicMean: false },
    { key: "latencyMeanMs", lowerIsBetter: true, useHarmonicMean: false },
    { key: "latencyMaxMs", lowerIsBetter: true, useHarmonicMean: false },
    { key: "rssBeforeMB", lowerIsBetter: true, useHarmonicMean: false },
    { key: "rssAfterMB", lowerIsBetter: true, useHarmonicMean: false },
    { key: "rssPeakMB", lowerIsBetter: true, useHarmonicMean: false },
    { key: "rssDeltaMB", lowerIsBetter: true, useHarmonicMean: false },
  ];

  const metricsSummary = {};
  for (const { key, lowerIsBetter, useHarmonicMean } of metricDefs) {
    const values = rawIterations.map((item) => Number(item[key]));
    metricsSummary[key] = calculateStats(values, 3, {
      lowerIsBetter,
      useHarmonicMean,
    });
  }

  return {
    scenarioId: endpointDef.id,
    name: endpointDef.name,
    description: endpointDef.description,
    config: {
      method: endpointDef.method,
      path: endpointDef.path,
      connections: httpConfig.connections,
      durationSec: httpConfig.durationSec,
      warmupDurationSec: httpConfig.warmupDurationSec,
    },
    warmupDurationSec: httpConfig.warmupDurationSec,
    iterations: rawIterations.length,
    metrics: metricsSummary,
  };
}

/**
 * Vypíše průběh jednoho HTTP běhu (Warmup nebo Měření) do konzole.
 */
export function logHttpIteration(phase, current, total, metrics) {
  const indexStr = `${String(current).padStart(2, " ")}/${String(total).padStart(2, " ")}`;
  const tag = phase === "WARMUP" ? "WARMUP" : "MĚŘENÍ";
  console.log(
    `  [${tag} ${indexStr}] ` +
      `RPS: ${metrics.rps.toFixed(1).padStart(9, " ")} req/s | ` +
      `Tok: ${metrics.throughputMBps.toFixed(2).padStart(6, " ")} MB/s | ` +
      `p50: ${metrics.latencyP50Ms.toFixed(2).padStart(6, " ")} ms | ` +
      `p95: ${metrics.latencyP95Ms.toFixed(2).padStart(6, " ")} ms | ` +
      `p99: ${metrics.latencyP99Ms.toFixed(2).padStart(6, " ")} ms | ` +
      `RSS po: ${metrics.rssAfterMB.toFixed(1)} MB`,
  );
}

/**
 * Vypíše souhrnnou statistickou tabulku pro jeden HTTP endpoint do konzole.
 */
export function logHttpScenarioSummary(scenarioTitle, summary) {
  console.log(
    `\n  Souhrnné výsledky – ${scenarioTitle} (N = ${summary.iterations}):`,
  );
  console.log(
    "  ──────────────────────────────────────────────────────────────────────",
  );

  const formatRow = (label, stats, unit) =>
    `  ${label.padEnd(20, " ")} | ` +
    `p50: ${String(stats.p50.toFixed(2)).padStart(9, " ")} ${unit} | ` +
    `p95: ${String(stats.p95.toFixed(2)).padStart(9, " ")} ${unit} | ` +
    `p99: ${String(stats.p99.toFixed(2)).padStart(9, " ")} ${unit} | ` +
    `Ø: ${String(stats.mean.toFixed(2)).padStart(9, " ")} ± ${String(stats.stdDev.toFixed(2)).padStart(7, " ")} ${unit}`;

  console.log(formatRow("Propustnost (RPS)", summary.metrics.rps, "req/s"));
  console.log(
    formatRow("Datový tok", summary.metrics.throughputMBps, "MB/s "),
  );
  console.log(formatRow("Latence p50", summary.metrics.latencyP50Ms, "ms   "));
  console.log(formatRow("Latence p95", summary.metrics.latencyP95Ms, "ms   "));
  console.log(formatRow("Latence p99 (Tail)", summary.metrics.latencyP99Ms, "ms   "));
  console.log(
    formatRow("Průměrná latence", summary.metrics.latencyMeanMs, "ms   "),
  );
  console.log(formatRow("Paměť RSS (po)", summary.metrics.rssAfterMB, "MB   "));
  console.log(
    formatRow("Paměť RSS (špička)", summary.metrics.rssPeakMB, "MB   "),
  );
  console.log(
    "  ──────────────────────────────────────────────────────────────────────",
  );
}

/**
 * Spustí kompletní HTTP benchmark (všechny povolené endpointy) pro jedno běhové prostředí.
 */
export async function runHttpBenchmarkForRuntime({
  runtimeTarget,
  httpConfig,
  loadTool,
  projectRoot,
  resultsDir,
}) {
  const { host, port } = httpConfig;

  logSection(
    `BENCHMARK KATEGORIE 1: VÝKON HTTP SERVERU (${runtimeTarget.label.toUpperCase()})`,
  );
  logInfo(`Spouštím server podproces: ${runtimeTarget.command} ${runtimeTarget.args.join(" ")}`);

  const { child, initialMetrics } = await startHttpServerProcess({
    runtimeKey: runtimeTarget.key,
    command: runtimeTarget.command,
    args: runtimeTarget.args,
    cwd: projectRoot,
    host,
    port,
  });

  const environment = initialMetrics.environment;
  logInfo(
    `Server naslouchá na http://${host}:${port} (PID: ${initialMetrics.pid}, Verze: ${environment.version}, Počáteční RSS: ${initialMetrics.rssMB} MB)`,
  );
  logInfo(
    `Konfigurace zátěže: Nástroj = ${loadTool.type}, Spojení = ${httpConfig.connections}, Doba běhu = ${httpConfig.durationSec}s, Iterace N = ${httpConfig.measuredIterations}, Warmup = ${httpConfig.warmupDurationSec}s`,
  );

  const allRawScenarios = {};
  const allSummaryScenarios = {};

  try {
    const endpointKeys = Object.keys(httpConfig.endpoints);
    for (let eIdx = 0; eIdx < endpointKeys.length; eIdx++) {
      const epKey = endpointKeys[eIdx];
      const epDef = httpConfig.endpoints[epKey];
      if (!epDef.enabled) continue;

      const targetUrl = `http://${host}:${port}${epDef.path}`;
      const bodyPayload = epDef.method === "POST" ? ECHO_REQUEST_BODY : null;

      logSection(epDef.name);
      logInfo(`Endpoint: ${epDef.method} ${targetUrl}`);
      logInfo(
        `Zahřívací fáze (Warmup): ${httpConfig.warmupDurationSec} s (${httpConfig.warmupConnections} spojení) | Měřené běhy: N = ${httpConfig.measuredIterations} × ${httpConfig.durationSec} s (${httpConfig.connections} spojení)`,
      );

      // 1. Zahřívací fáze (Warmup) – souvislá zátěž, výsledky se zahazují
      if (httpConfig.warmupDurationSec > 0) {
        const rssBeforeWarmup = (await fetchServerMetrics(host, port)).rssBytes;
        const warmupLoad = await executeExternalLoadRun({
          loadTool,
          url: targetUrl,
          method: epDef.method,
          body: bodyPayload,
          connections: httpConfig.warmupConnections,
          durationSec: httpConfig.warmupDurationSec,
          pipelining: httpConfig.pipelining,
          projectRoot,
        });
        const rssAfterWarmup = (await fetchServerMetrics(host, port)).rssBytes;
        const warmupMetrics = computeHttpIterationMetrics({
          iterationIndex: 1,
          loadResult: warmupLoad,
          rssBeforeBytes: rssBeforeWarmup,
          rssAfterBytes: rssAfterWarmup,
        });
        logHttpIteration("WARMUP", 1, 1, warmupMetrics);

        // Krátká stabilizační pauza po warmupu
        await new Promise((r) => setTimeout(r, httpConfig.cooldownMs));
      }

      console.log(
        "  ----------------------------------------------------------------------",
      );

      // 2. Měřená fáze (N nezávislých zátěžových běhů)
      const rawResults = [];
      for (let i = 1; i <= httpConfig.measuredIterations; i++) {
        // Snímání RSS těsně před zátěží mimo měřené okno (nulový Observer Effect)
        const beforeMetrics = await fetchServerMetrics(host, port);

        const loadResult = await executeExternalLoadRun({
          loadTool,
          url: targetUrl,
          method: epDef.method,
          body: bodyPayload,
          connections: httpConfig.connections,
          durationSec: httpConfig.durationSec,
          pipelining: httpConfig.pipelining,
          projectRoot,
        });

        // Snímání RSS těsně po skončení zátěže mimo měřené okno
        const afterMetrics = await fetchServerMetrics(host, port);

        const iterMetrics = computeHttpIterationMetrics({
          iterationIndex: i,
          loadResult,
          rssBeforeBytes: beforeMetrics.rssBytes,
          rssAfterBytes: afterMetrics.rssBytes,
        });

        rawResults.push(iterMetrics);
        logHttpIteration("RUN", i, httpConfig.measuredIterations, iterMetrics);

        if (i < httpConfig.measuredIterations) {
          await new Promise((r) => setTimeout(r, httpConfig.cooldownMs));
        }
      }

      const summary = buildHttpScenarioSummary(epDef, rawResults, httpConfig);
      logHttpScenarioSummary(epDef.name, summary);

      allRawScenarios[epDef.id] = {
        scenarioId: epDef.id,
        name: epDef.name,
        config: summary.config,
        warmupDurationSec: httpConfig.warmupDurationSec,
        measuredIterations: httpConfig.measuredIterations,
        iterations: rawResults,
      };
      allSummaryScenarios[epDef.id] = summary;

      if (eIdx < endpointKeys.length - 1) {
        await new Promise((r) => setTimeout(r, httpConfig.cooldownMs));
      }
    }
  } finally {
    logInfo(`Ukončuji HTTP server (${runtimeTarget.label}, PID: ${initialMetrics.pid})...`);
    await stopHttpServerProcess(child);
  }

  const benchmarkConfigSummary = {
    warmupIterations: 1,
    warmupDurationSec: httpConfig.warmupDurationSec,
    warmupConnections: httpConfig.warmupConnections,
    measuredIterations: httpConfig.measuredIterations,
    durationSec: httpConfig.durationSec,
    connections: httpConfig.connections,
    loadTool: loadTool.type,
  };

  const { savedRawPath, savedSummaryPath } = await exportBenchmarkResults({
    resultsDir,
    category: "01-http",
    environment,
    benchmarkConfig: benchmarkConfigSummary,
    allRawScenarios,
    allSummaryScenarios,
    filePrefix: "http",
  });

  logSection(`HTTP BENCHMARK ${runtimeTarget.label.toUpperCase()} DOKONČEN`);
  logInfo(
    `Surová data (N = ${httpConfig.measuredIterations}) uložena do: ${savedRawPath}`,
  );
  logInfo(
    `Agregované statistiky (p50, p95, p99, Ø, σ) uloženy do: ${savedSummaryPath}`,
  );
}
