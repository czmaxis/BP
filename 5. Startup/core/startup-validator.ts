/**
 * Sdílený TypeScript modul č. 2 pro Variantu B (Reálný modulární start – 05-startup).
 * Importuje typové definice a regulární výrazy ze `startup-schema.ts`, parsuje a validuje
 * konfigurační manifest Serverless/CLI služby a vrací deterministický výstupní řetězec.
 */

import {
  computeStringHash32,
  EMAIL_REGEX,
  IPV4_REGEX,
  normalizeRoutePath,
  PATH_REGEX,
  SEMVER_REGEX,
  type ServerlessManifest,
  type ValidationReport,
} from "./startup-schema.ts";

export const DEFAULT_SERVERLESS_PAYLOAD: string = JSON.stringify({
  serviceName: "edge-gateway-benchmark",
  version: "2.4.1-rc.1",
  region: "eu-central-1",
  maintainerEmail: "devops@benchmark-bp.cz",
  bindAddress: "127.0.0.1",
  timeoutMs: 15000,
  routes: [
    { path: "/api/v1/health", methods: ["GET"], rateLimitRps: 500, authRequired: false },
    { path: "/api/v1/users/", methods: ["GET", "POST"], rateLimitRps: 250, authRequired: true },
    { path: "/api/v1/orders", methods: ["POST", "PUT"], rateLimitRps: 150, authRequired: true },
    { path: "/api/v1/metrics", methods: ["GET"], rateLimitRps: 100, authRequired: true },
    { path: "/webhooks/events", methods: ["POST"], rateLimitRps: 400, authRequired: false },
  ],
});

export function validateServerlessManifest(
  rawJson: string = DEFAULT_SERVERLESS_PAYLOAD,
): ValidationReport {
  const manifest = JSON.parse(rawJson) as ServerlessManifest;

  if (!SEMVER_REGEX.test(manifest.version)) {
    throw new Error(`Invalid semver: ${manifest.version}`);
  }
  if (!EMAIL_REGEX.test(manifest.maintainerEmail)) {
    throw new Error(`Invalid email: ${manifest.maintainerEmail}`);
  }
  if (!IPV4_REGEX.test(manifest.bindAddress)) {
    throw new Error(`Invalid IPv4: ${manifest.bindAddress}`);
  }

  let totalRateLimit = 0;
  let accHash = computeStringHash32(`${manifest.serviceName}@${manifest.version}`);

  for (let i = 0; i < manifest.routes.length; i++) {
    const route = manifest.routes[i];
    const cleanPath = normalizeRoutePath(route.path);
    if (!PATH_REGEX.test(cleanPath)) {
      throw new Error(`Invalid route path: ${cleanPath}`);
    }
    totalRateLimit += route.rateLimitRps;
    const routeKey = `${cleanPath}:${route.methods.join(",")}:${route.rateLimitRps}:${route.authRequired}`;
    accHash = (Math.imul(accHash, 31) ^ computeStringHash32(routeKey)) >>> 0;
  }

  return {
    valid: true,
    service: manifest.serviceName,
    routeCount: manifest.routes.length,
    totalRateLimit,
    checksumHex: `0x${accHash.toString(16).padStart(8, "0")}`,
  };
}

export function runRealisticStartupTask(): string {
  const report = validateServerlessManifest(DEFAULT_SERVERLESS_PAYLOAD);
  return `ready:${report.service}:routes=${report.routeCount}:limit=${report.totalRateLimit}:checksum=${report.checksumHex}`;
}

export const EXPECTED_REALISTIC_OUTPUT =
  "ready:edge-gateway-benchmark:routes=5:limit=1400:checksum=0x081c2c15";
