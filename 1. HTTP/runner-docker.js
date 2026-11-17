/**
 * Docker orchestrátor pro Kategorii 1: Výkon HTTP serveru (Node.js, Deno, Bun).
 *
 * Metodika izolace:
 * 1. Každý testovaný HTTP server (Node.js, Deno, Bun) běží ve vlastním Docker kontejneru
 *    s pevně omezenými zdroji (--cpus=2, --memory=2g, --memory-swap=2g) a publikovaným portem.
 * 2. Zátěžový generátor (autocannon / wrk / builtin-net-keepalive) běží MIMO kontejner serveru,
 *    takže nikdy nespotřebovává přidělenou kvótu CPU ani RAM měřeného HTTP serveru.
 * 3. Výsledky se ukládají do ./results/http_raw_<runtime>.json a ./results/http_summary_<runtime>.json
 *    a na závěr se spouští compare.js.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./core/fs-helper.js";
import {
  detectHttpLoadTool,
  runHttpBenchmarkForRuntime,
} from "./core/http-runner.js";
import { logInfo, logSection } from "./core/logger.js";
import { resolveBinary, runExternalCommand } from "./core/process.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCKER_TARGETS = [
  {
    key: "node",
    label: "Node.js",
    image: "benchmark-http-node",
    dockerfile: "docker/Dockerfile.node",
    serverCmd: [
      "node",
      "scenarios/01-http/node.mjs",
      "--host=0.0.0.0",
      "--port=3000",
    ],
  },
  {
    key: "deno",
    label: "Deno",
    image: "benchmark-http-deno",
    dockerfile: "docker/Dockerfile.deno",
    serverCmd: [
      "deno",
      "run",
      "--allow-net",
      "--allow-env",
      "--allow-read",
      "--allow-sys",
      "scenarios/01-http/deno.ts",
      "--host=0.0.0.0",
      "--port=3000",
    ],
  },
  {
    key: "bun",
    label: "Bun",
    image: "benchmark-http-bun",
    dockerfile: "docker/Dockerfile.bun",
    serverCmd: [
      "bun",
      "run",
      "scenarios/01-http/bun.ts",
      "--host=0.0.0.0",
      "--port=3000",
    ],
  },
];

async function verifyDockerRunning() {
  const dockerBin = await resolveBinary("docker", [
    "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
  ]);

  if (!dockerBin) {
    throw new Error(
      'Příkaz "docker" nebyl nalezen. Ujistěte se, že je nainstalován Docker Desktop a je v systémové PATH.',
    );
  }

  const versionRes = await runExternalCommand(dockerBin, ["--version"], {
    silent: true,
    cwd: __dirname,
  });
  logInfo(`Nalezen Docker: ${versionRes.stdout.trim()}`);

  try {
    await runExternalCommand(dockerBin, ["info"], {
      silent: true,
      cwd: __dirname,
    });
    logInfo("Docker daemon běží a je připraven.");
  } catch {
    throw new Error(
      "Docker daemon neběží nebo není dostupný. Spusťte prosím aplikaci Docker Desktop.",
    );
  }

  return dockerBin;
}

async function main() {
  const config = await loadConfig(__dirname);
  const resultsDir = path.resolve(__dirname, config.resultsDir);
  await mkdir(resultsDir, { recursive: true });

  let cpus = config.docker?.cpus ?? "2";
  let memory = config.docker?.memory ?? "2g";
  let memorySwap = config.docker?.memorySwap ?? "2g";
  let runtimeFilter = null;
  let skipBuild = false;

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--cpus=")) {
      cpus = arg.split("=")[1];
    } else if (arg.startsWith("--memory=")) {
      memory = arg.split("=")[1];
      memorySwap = arg.split("=")[1];
    } else if (arg.startsWith("--memory-swap=")) {
      memorySwap = arg.split("=")[1];
    } else if (arg.startsWith("--runtime=")) {
      runtimeFilter = arg.split("=")[1].toLowerCase();
    } else if (arg === "--skip-build") {
      skipBuild = true;
    }
  }

  logSection("DOCKER ORCHESTRÁTOR – KATEGORIE 1: VÝKON HTTP SERVERU");
  const dockerBin = await verifyDockerRunning();
  const loadTool = await detectHttpLoadTool(config.http.loadTool, __dirname);

  const targets = runtimeFilter
    ? DOCKER_TARGETS.filter((t) => t.key === runtimeFilter)
    : DOCKER_TARGETS;

  if (targets.length === 0) {
    throw new Error(
      `Neznámé běhové prostředí "${runtimeFilter}". Povolené hodnoty: node, deno, bun.`,
    );
  }

  logInfo(
    `Limity kontejneru serveru: --cpus=${cpus} --memory=${memory} --memory-swap=${memorySwap}`,
  );

  if (!skipBuild) {
    for (const target of targets) {
      logSection(`1. SESTAVENÍ OBRAZU: ${target.image} (${target.label})`);
      await runExternalCommand(
        dockerBin,
        ["build", "-t", target.image, "-f", target.dockerfile, "."],
        { cwd: __dirname },
      );
      logInfo(`Obraz ${target.image} úspěšně sestaven.`);
    }
  }

  const hostPort = config.http.port;

  for (let idx = 0; idx < targets.length; idx++) {
    const target = targets[idx];
    const containerName = `benchmark-http-${target.key}`;

    // Odstranění případného visícího kontejneru z předchozího běhu
    try {
      await runExternalCommand(dockerBin, ["rm", "-f", containerName], {
        silent: true,
        cwd: __dirname,
      });
    } catch {
      // Kontejner neexistoval
    }

    const dockerRuntimeTarget = {
      key: target.key,
      label: target.label,
      command: dockerBin,
      args: [
        "run",
        "--rm",
        "--name",
        containerName,
        `--cpus=${cpus}`,
        `--memory=${memory}`,
        `--memory-swap=${memorySwap}`,
        "-p",
        `127.0.0.1:${hostPort}:3000`,
        target.image,
        ...target.serverCmd,
      ],
    };

    try {
      await runHttpBenchmarkForRuntime({
        runtimeTarget: dockerRuntimeTarget,
        httpConfig: {
          ...config.http,
          host: "127.0.0.1",
          port: hostPort,
        },
        loadTool,
        projectRoot: __dirname,
        resultsDir,
      });
    } finally {
      try {
        await runExternalCommand(dockerBin, ["rm", "-f", containerName], {
          silent: true,
          cwd: __dirname,
        });
      } catch {
        // Již ukončen
      }
    }

    if (idx < targets.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  logSection("3. VYHODNOCENÍ A KŘÍŽOVÉ POROVNÁNÍ VÝSLEDKŮ");
  await runExternalCommand(process.execPath, ["compare.js"], { cwd: __dirname });
}

main().catch((err) => {
  console.error(`\n[CHYBA DOCKER ORCHESTRÁTORU]: ${err.message}`);
  process.exitCode = 1;
});
