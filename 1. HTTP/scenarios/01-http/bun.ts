/**
 * Benchmark Kategorie 1: Výkon HTTP serveru – Nativní implementace pro Bun (Bun.serve)
 *
 * Využívá výhradně nativní rozhraní `Bun.serve` bez externích frameworků.
 * Testované endpointy:
 * - GET  /plaintext : Statická odpověď "Hello, World!" (text/plain; charset=utf-8)
 * - GET  /json      : Serializace 50 polymorfních uživatelských záznamů přes JSON.stringify()
 * - POST /echo      : Načtení těla ze streamu, JSON.parse(), doplnění "processed": true a JSON.stringify()
 * - GET  /metrics   : Interní telemetrický endpoint (RSS paměť a metadata mimo měřenou zátěž)
 *
 * Spuštění:
 *   bun run scenarios/01-http/bun.ts --port=3000
 */

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
const ENV_METADATA = getEnvironmentMetadata();

const HEADERS_PLAINTEXT = {
  "content-type": "text/plain; charset=utf-8",
};

const HEADERS_JSON = {
  "content-type": "application/json",
};

const server = Bun.serve({
  hostname: host,
  port,
  async fetch(req: Request): Promise<Response> {
    const method = req.method;
    const pathname = extractPathname(req.url);

    if (method === "GET") {
      if (pathname === "/plaintext") {
        return new Response(PLAINTEXT_BODY, {
          status: 200,
          headers: HEADERS_PLAINTEXT,
        });
      }

      if (pathname === "/json") {
        const jsonBody = serializeUsersDataset();
        return new Response(jsonBody, {
          status: 200,
          headers: HEADERS_JSON,
        });
      }

      if (pathname === "/metrics") {
        const rssBytes = getRssBytes();
        const payload = JSON.stringify({
          runtime: "bun",
          pid: process.pid,
          rssBytes,
          rssMB: round(bytesToMB(rssBytes), 3),
          environment: ENV_METADATA,
        });
        return new Response(payload, {
          status: 200,
          headers: HEADERS_JSON,
        });
      }
    } else if (method === "POST" && pathname === "/echo") {
      try {
        const rawBody = await req.text();
        const responseJson = processEchoPayload(rawBody);
        return new Response(responseJson, {
          status: 200,
          headers: HEADERS_JSON,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return new Response(
          JSON.stringify({ error: "Invalid JSON payload", message }),
          {
            status: 400,
            headers: HEADERS_JSON,
          },
        );
      }
    }

    return new Response("Not Found", {
      status: 404,
      headers: HEADERS_PLAINTEXT,
    });
  },
});

console.log(`HTTP_SERVER_LISTENING http://${server.hostname}:${server.port}`);

function shutdown() {
  server.stop(true);
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
