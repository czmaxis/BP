/**
 * Externí vícevláknový HTTP/1.1 keep-alive zátěžový generátor (Load Generator).
 *
 * Spouští se jako samostatný OS proces (mimo proces testovaného HTTP serveru),
 * aby nikdy nesoutěžil s měřeným serverem o Event Loop ani Garbage Collector.
 * Využívá `node:worker_threads` a nízkoúrovňové TCP sockety (`node:net`) s předalokovanými
 * HTTP/1.1 buffery a `TCP_NODELAY`, čímž dosahuje minimální klientské režie a přesného
 * měření rozdělení latencí (p50, p95, p99, průměr, směrodatná odchylka).
 *
 * Použití:
 *   node core/http-load-client.js --url=http://127.0.0.1:3000/plaintext --method=GET --connections=50 --duration=10 --json
 */

import net from "node:net";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from "node:worker_threads";
import { bytesToMB, calculatePercentile, round } from "./stats.js";

const CRLF_CRLF = Buffer.from("\r\n\r\n");
const CONTENT_LENGTH_MATCH = /content-length:\s*(\d+)/i;

/**
 * Sestaví surový HTTP/1.1 požadavek do Bufferu před spuštěním měření.
 */
function buildHttpRequestBuffer({ host, port, method, path, body }) {
  const bodyBuf = body ? Buffer.from(body, "utf-8") : null;
  const headers = [
    `${method} ${path} HTTP/1.1`,
    `Host: ${host}:${port}`,
    "Connection: keep-alive",
  ];

  if (bodyBuf && bodyBuf.byteLength > 0) {
    headers.push("Content-Type: application/json");
    headers.push(`Content-Length: ${bodyBuf.byteLength}`);
  }

  const headerBuf = Buffer.from(`${headers.join("\r\n")}\r\n\r\n`, "utf-8");
  return bodyBuf ? Buffer.concat([headerBuf, bodyBuf]) : headerBuf;
}

/**
 * Logika jednoho klientského worker vlákna – spravuje přidělenou sadu TCP keep-alive spojení.
 */
function runWorkerThread(cfg) {
  const {
    host,
    port,
    method,
    path,
    body,
    connections,
    durationMs,
    maxSamplesPerWorker = 250000,
  } = cfg;

  const requestBuffer = buildHttpRequestBuffer({
    host,
    port,
    method,
    path,
    body,
  });

  // Předalokované typované pole pro vzorky latencí (zabraňuje GC pauzám z dynamického zvětšování pole)
  const latencies = new Float64Array(maxSamplesPerWorker);
  let sampleCount = 0;
  let totalRequests = 0;
  let totalBytes = 0;
  let errors = 0;
  let active = true;

  const sockets = [];
  let closedSockets = 0;
  let finished = false;

  const startTime = performance.now();
  const deadline = startTime + durationMs;

  function finishWorker() {
    if (finished) return;
    finished = true;
    active = false;
    for (const s of sockets) {
      try {
        s.destroy();
      } catch {
        // Ignorujeme chybu při zavírání socketu
      }
    }
    const elapsedMs = performance.now() - startTime;
    const validSamples = latencies.slice(0, sampleCount);
    parentPort.postMessage(
      {
        totalRequests,
        totalBytes,
        errors,
        elapsedMs,
        samplesBuffer: validSamples.buffer,
        sampleCount,
      },
      [validSamples.buffer],
    );
  }

  const timer = setTimeout(() => {
    finishWorker();
  }, durationMs);

  for (let c = 0; c < connections; c++) {
    let reqStart = 0;
    let awaitingHeader = true;
    let expectedTotalLen = 0;
    let statusOk = true;
    let accBuf = Buffer.alloc(0);

    const socket = new net.Socket();
    socket.setNoDelay(true);
    sockets.push(socket);

    const sendNext = () => {
      if (!active || performance.now() >= deadline) {
        socket.end();
        return;
      }
      awaitingHeader = true;
      expectedTotalLen = 0;
      reqStart = performance.now();
      socket.write(requestBuffer);
    };

    socket.connect(port, host, () => {
      sendNext();
    });

    socket.on("data", (chunk) => {
      if (!active) return;

      accBuf =
        accBuf.byteLength === 0 ? chunk : Buffer.concat([accBuf, chunk]);

      while (accBuf.byteLength > 0) {
        if (awaitingHeader) {
          const headerEndIdx = accBuf.indexOf(CRLF_CRLF);
          if (headerEndIdx === -1) {
            break;
          }

          const headerStr = accBuf.subarray(0, headerEndIdx).toString("latin1");
          // Kontrola stavového kódu "HTTP/1.1 200"
          statusOk = headerStr.startsWith("HTTP/1.1 200");

          const clMatch = CONTENT_LENGTH_MATCH.exec(headerStr);
          const contentLen = clMatch ? Number.parseInt(clMatch[1], 10) : 0;
          expectedTotalLen = headerEndIdx + 4 + contentLen;
          awaitingHeader = false;
        }

        if (accBuf.byteLength < expectedTotalLen) {
          break;
        }

        const latencyMs = performance.now() - reqStart;
        totalBytes += expectedTotalLen;

        if (statusOk) {
          totalRequests++;
          if (sampleCount < maxSamplesPerWorker) {
            latencies[sampleCount++] = latencyMs;
          } else {
            // Deterministický reservoir sampling při překročení kapacity bufferu
            const replaceIdx = totalRequests % maxSamplesPerWorker;
            latencies[replaceIdx] = latencyMs;
          }
        } else {
          errors++;
        }

        if (accBuf.byteLength === expectedTotalLen) {
          accBuf = Buffer.alloc(0);
        } else {
          accBuf = accBuf.subarray(expectedTotalLen);
        }

        sendNext();
      }
    });

    socket.on("error", () => {
      if (!active) return;
      errors++;
    });

    socket.on("close", () => {
      closedSockets++;
      if (closedSockets >= connections && !active) {
        clearTimeout(timer);
        finishWorker();
      }
    });
  }
}

/**
 * Spustí vícevláknový HTTP zátěžový test a vrátí souhrnné metriky (RPS, MB/s, p50, p95, p99).
 */
export async function runBuiltinHttpLoad({
  url,
  method = "GET",
  body = null,
  connections = 50,
  durationSec = 10,
  workers = Math.min(4, Math.max(1, os.cpus().length - 1)),
}) {
  const parsedUrl = new URL(url);
  const host = parsedUrl.hostname;
  const port = Number.parseInt(parsedUrl.port || "80", 10);
  const path = `${parsedUrl.pathname}${parsedUrl.search}`;
  const durationMs = durationSec * 1000;

  const actualWorkers = Math.min(workers, connections);
  const baseConns = Math.floor(connections / actualWorkers);
  const extraConns = connections % actualWorkers;

  const workerFile = fileURLToPath(import.meta.url);
  const startWall = performance.now();

  const workerPromises = Array.from({ length: actualWorkers }, (_, idx) => {
    const workerConns = baseConns + (idx < extraConns ? 1 : 0);
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerFile, {
        workerData: {
          host,
          port,
          method,
          path,
          body,
          connections: workerConns,
          durationMs,
        },
      });
      worker.on("message", resolve);
      worker.on("error", reject);
    });
  });

  const results = await Promise.all(workerPromises);
  const elapsedSec = (performance.now() - startWall) / 1000;

  let totalRequests = 0;
  let totalBytes = 0;
  let totalErrors = 0;
  let totalSamples = 0;

  for (const r of results) {
    totalRequests += r.totalRequests;
    totalBytes += r.totalBytes;
    totalErrors += r.errors;
    totalSamples += r.sampleCount;
  }

  // Sloučení a seřazení všech vzorků latence v typovaném Float64Array
  const mergedLatencies = new Float64Array(totalSamples);
  let offset = 0;
  for (const r of results) {
    const view = new Float64Array(r.samplesBuffer, 0, r.sampleCount);
    mergedLatencies.set(view, offset);
    offset += r.sampleCount;
  }
  mergedLatencies.sort();

  let sumLatency = 0;
  for (let i = 0; i < totalSamples; i++) {
    sumLatency += mergedLatencies[i];
  }
  const meanLatency = totalSamples > 0 ? sumLatency / totalSamples : 0;

  let varianceSum = 0;
  if (totalSamples > 1) {
    for (let i = 0; i < totalSamples; i++) {
      const diff = mergedLatencies[i] - meanLatency;
      varianceSum += diff * diff;
    }
  }
  const stdDevLatency =
    totalSamples > 1 ? Math.sqrt(varianceSum / (totalSamples - 1)) : 0;

  return {
    tool: "builtin-net-keepalive",
    durationSec: round(elapsedSec, 3),
    connections,
    workers: actualWorkers,
    totalRequests,
    rps: round(totalRequests / elapsedSec, 2),
    totalBytes,
    throughputMBps: round(bytesToMB(totalBytes) / elapsedSec, 3),
    errors: totalErrors,
    latency: {
      min: totalSamples > 0 ? round(mergedLatencies[0], 3) : 0,
      p50: round(calculatePercentile(mergedLatencies, 50), 3),
      p95: round(calculatePercentile(mergedLatencies, 95), 3),
      p99: round(calculatePercentile(mergedLatencies, 99), 3),
      max:
        totalSamples > 0 ? round(mergedLatencies[totalSamples - 1], 3) : 0,
      mean: round(meanLatency, 3),
      stdDev: round(stdDevLatency, 3),
    },
  };
}

// Pokud je skript spuštěn jako worker vlákno
if (!isMainThread && workerData) {
  runWorkerThread(workerData);
}

// Pokud je skript spuštěn přímo z příkazové řádky jako samostatný proces
if (
  isMainThread &&
  process.argv[1] &&
  pathEndsWithLoadClient(process.argv[1])
) {
  const args = process.argv.slice(2);
  const getArg = (prefix, fallback) => {
    const found = args.find((a) => a.startsWith(`${prefix}=`));
    return found ? found.slice(prefix.length + 1) : fallback;
  };

  const url = getArg("--url", "http://127.0.0.1:3000/plaintext");
  const method = getArg("--method", "GET").toUpperCase();
  const connections = Number.parseInt(getArg("--connections", "50"), 10);
  const durationSec = Number.parseFloat(getArg("--duration", "10"));
  const body = getArg("--body", null);

  runBuiltinHttpLoad({
    url,
    method,
    body,
    connections,
    durationSec,
  })
    .then((result) => {
      console.log(JSON.stringify(result));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

function pathEndsWithLoadClient(p) {
  return p.replace(/\\/g, "/").endsWith("core/http-load-client.js");
}
