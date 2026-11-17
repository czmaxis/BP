/**
 * Sdílený TypeScript modul č. 1 pro Variantu B (Reálný modulární start – 05-startup).
 * Obsahuje typové definice (interfaces), regulární výrazy a normalizační funkce.
 * Kompatibilní s nativním TypeScriptem v Node.js 22+ (--experimental-strip-types), Deno i Bun.
 */

export interface RouteRule {
  path: string;
  methods: string[];
  rateLimitRps: number;
  authRequired: boolean;
}

export interface ServerlessManifest {
  serviceName: string;
  version: string;
  region: string;
  maintainerEmail: string;
  bindAddress: string;
  timeoutMs: number;
  routes: RouteRule[];
}

export interface ValidationReport {
  valid: boolean;
  service: string;
  routeCount: number;
  totalRateLimit: number;
  checksumHex: string;
}

export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
export const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/;
export const IPV4_REGEX = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
export const PATH_REGEX = /^\/[a-zA-Z0-9/_-]*$/;

export function normalizeRoutePath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed.startsWith("/")) {
    return `/${trimmed}`;
  }
  return trimmed.length > 1 && trimmed.endsWith("/")
    ? trimmed.slice(0, -1)
    : trimmed;
}

export function computeStringHash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
