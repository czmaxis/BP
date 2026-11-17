/**
 * Docker orchestrátor pro Kategorii 6: Paralelní zpracování / Worker Threads (Node.js, Deno, Bun).
 *
 * Automatizuje:
 * 1. Kontrolu dostupnosti Docker daemonu (docker info).
 * 2. Sestavení izolovaných Docker obrazů (benchmark-workers-node, benchmark-workers-deno, benchmark-workers-bun).
 * 3. Sekvenční spuštění kontejnerů s pevnými limity zdrojů (--cpus=4, --memory=2g, --memory-swap=2g).
 * 4. Kontrolu vygenerovaných JSON souborů v ./results/.
 * 5. Spuštění finálního porovnávacího skriptu (compare.js) včetně verifikace shody checksumů.
 */

import { access, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBinary, runExternalCommand } from "./core/process.js";
import { logInfo, logSection } from "./core/worker-runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCKER_TARGETS = [
  {
    key: "node",
    label: "Node.js",
    image: "benchmark-workers-node",
    dockerfile: "docker/Dockerfile.node",
    baseCmd: ["node", "scenarios/06-workers/node.mjs"],
    expectedRaw: "workers_raw_node.json",
    expectedSummary: "workers_summary_node.json",
  },
  {
    key: "deno",
    label: "Deno",
    image: "benchmark-workers-deno",
    dockerfile: "docker/Dockerfile.deno",
    baseCmd: [
      "deno",
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-sys",
      "scenarios/06-workers/deno.ts",
    ],
    expectedRaw: "workers_raw_deno.json",
    expectedSummary: "workers_summary_deno.json",
  },
  {
    key: "bun",
    label: "Bun",
    image: "benchmark-workers-bun",
    dockerfile: "docker/Dockerfile.bun",
    baseCmd: ["bun", "run", "scenarios/06-workers/bun.ts"],
    expectedRaw: "workers_raw_bun.json",
    expectedSummary: "workers_summary_bun.json",
  },
];

async function parseOptions() {
  const configRaw = await readFile(
    path.join(__dirname, "config.json"),
    "utf-8",
  );
  const config = JSON.parse(configRaw);

  const options = {
    cpus: config.docker?.cpus ?? "4",
    memory: config.docker?.memory ?? "2g",
    memorySwap: config.docker?.memorySwap ?? "2g",
    runtimeFilter: null,
    skipBuild: false,
    passthroughArgs: [],
  };

  const cliArgs = process.argv.slice(2);
  const isQuick = cliArgs.includes("--quick");

  for (const arg of cliArgs) {
    if (arg === "--quick") {
      continue;
    } else if (arg.startsWith("--cpus=")) {
      options.cpus = arg.split("=")[1];
    } else if (arg.startsWith("--memory=")) {
      options.memory = arg.split("=")[1];
      options.memorySwap = arg.split("=")[1];
    } else if (arg.startsWith("--memory-swap=")) {
      options.memorySwap = arg.split("=")[1];
    } else if (arg.startsWith("--runtime=")) {
      options.runtimeFilter = arg.split("=")[1].toLowerCase();
    } else if (arg === "--skip-build") {
      options.skipBuild = true;
    } else if (
      arg.startsWith("--warmup=") ||
      arg.startsWith("--iterations=") ||
      arg.startsWith("--workers=") ||
      arg.startsWith("--scenario=")
    ) {
      options.passthroughArgs.push(arg);
    }
  }

  if (isQuick) {
    if (!options.passthroughArgs.some((a) => a.startsWith("--warmup="))) {
      options.passthroughArgs.push("--warmup=2");
    }
    if (!options.passthroughArgs.some((a) => a.startsWith("--iterations="))) {
      options.passthroughArgs.push("--iterations=5");
    }
  }

  return options;
}

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

async function verifyResultFile(filePath) {
  await access(filePath);
  const fileStat = await stat(filePath);
  if (fileStat.size === 0) {
    throw new Error(`Výsledkový soubor ${filePath} je prázdný.`);
  }
  return fileStat.size;
}

async function main() {
  const options = await parseOptions();
  const resultsDir = path.resolve(__dirname, "results");
  await mkdir(resultsDir, { recursive: true });

  logSection("DOCKER ORCHESTRÁTOR – KATEGORIE 6: PARALELNÍ ZPRACOVÁNÍ (WORKERS)");
  const dockerBin = await verifyDockerRunning();

  const targets = options.runtimeFilter
    ? DOCKER_TARGETS.filter((t) => t.key === options.runtimeFilter)
    : DOCKER_TARGETS;

  if (targets.length === 0) {
    throw new Error(
      `Neznámé běhové prostředí "${options.runtimeFilter}". Povolené hodnoty: node, deno, bun.`,
    );
  }

  logInfo(
    `Limity kontejneru: --cpus=${options.cpus} --memory=${options.memory} --memory-swap=${options.memorySwap}`,
  );

  if (!options.skipBuild) {
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

  for (let idx = 0; idx < targets.length; idx++) {
    const target = targets[idx];
    logSection(`2. SPUŠTĚNÍ KONTEJNERU: ${target.label} (${target.image})`);

    const containerName = `benchmark-workers-${target.key}`;
    const runArgs = [
      "run",
      "--rm",
      "--name",
      containerName,
      `--cpus=${options.cpus}`,
      `--memory=${options.memory}`,
      `--memory-swap=${options.memorySwap}`,
      "-v",
      `${resultsDir}:/app/results`,
      target.image,
      ...target.baseCmd,
      ...options.passthroughArgs,
    ];

    logInfo(`Spouštím: docker ${runArgs.join(" ")}`);
    await runExternalCommand(dockerBin, runArgs, { cwd: __dirname });

    const rawPath = path.join(resultsDir, target.expectedRaw);
    const summaryPath = path.join(resultsDir, target.expectedSummary);

    const rawSize = await verifyResultFile(rawPath);
    const summarySize = await verifyResultFile(summaryPath);

    logInfo(
      `Kontrola výstupů OK: ${target.expectedRaw} (${rawSize} B), ${target.expectedSummary} (${summarySize} B)`,
    );

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
