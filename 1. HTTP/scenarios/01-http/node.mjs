/**
 * Benchmark Kategorie 1: Výkon HTTP serveru – Nativní implementace pro Node.js (node:http)
 *
 * Využívá výhradně nativní modul `node:http` (`http.createServer`) bez externích frameworků.
 * Testované endpointy:
 * - GET  /plaintext : Statická odpověď "Hello, World!" (text/plain; charset=utf-8)
 * - GET  /json      : Serializace 50 polymorfních uživatelských záznamů přes JSON.stringify()
 * - POST /echo      : Načtení těla ze streamu, JSON.parse(), doplnění "processed": true a JSON.stringify()
 * - GET  /metrics   : Interní telemetrický endpoint (RSS paměť a metadata mimo měřenou zátěž)
 *
 * Spuštění:
 *   node scenarios/01-http/node.mjs --port=3000
 */

import http from "node:http";
import {
  extractPathname,
  PLAINTEXT_BODY,
  processEchoPayload,
  serializeUsersDataset,
} from "../../core/http-data.js";
import {
  getCliArgs,
  getEnvironmentMetadata,
  getRssBytes,
} from "../../core/runtime.js";
import { bytesToMB, round } from "../../core/stats.js";

function resolveServerAddress() {
  let port = Number.parseInt(process.env.PORT || "3000", 10);
  let host = process.env.HOST || "127.0.0.1";

  for (const arg of getCliArgs()) {
    if (arg.startsWith("--port=")) {
      port = Number.parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--host=")) {
      host = arg.split("=")[1];
    }
  }
  return { host, port };
}

const { host, port } = resolveServerAddress();
const PLAINTEXT_BUFFER = Buffer.from(PLAINTEXT_BODY, "utf-8");
const PLAINTEXT_LENGTH = PLAINTEXT_BUFFER.byteLength;
const ENV_METADATA = getEnvironmentMetadata();

const server = http.createServer((req, res) => {
  const method = req.method;
  const pathname = extractPathname(req.url);

  if (method === "GET") {
    if (pathname === "/plaintext") {
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": PLAINTEXT_LENGTH,
      });
      res.end(PLAINTEXT_BUFFER);
      return;
    }

    if (pathname === "/json") {
      const jsonBody = serializeUsersDataset();
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(jsonBody, "utf-8"),
      });
      res.end(jsonBody);
      return;
    }

    if (pathname === "/metrics") {
      const rssBytes = getRssBytes();
      const payload = JSON.stringify({
        runtime: "node",
        pid: process.pid,
        rssBytes,
        rssMB: round(bytesToMB(rssBytes), 3),
        environment: ENV_METADATA,
      });
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload, "utf-8"),
      });
      res.end(payload);
      return;
    }
  } else if (method === "POST" && pathname === "/echo") {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const rawBody =
          chunks.length === 1
            ? chunks[0].toString("utf-8")
            : Buffer.concat(chunks).toString("utf-8");
        const responseJson = processEchoPayload(rawBody);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(responseJson, "utf-8"),
        });
        res.end(responseJson);
      } catch (err) {
        const errBody = JSON.stringify({
          error: "Invalid JSON payload",
          message: err.message,
        });
        res.writeHead(400, {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(errBody, "utf-8"),
        });
        res.end(errBody);
      }
    });
    req.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      }
    });
    return;
  }

  res.writeHead(404, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": 9,
  });
  res.end("Not Found");
});

server.listen(port, host, () => {
  console.log(`HTTP_SERVER_LISTENING http://${host}:${port}`);
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
