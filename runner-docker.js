/**
 * Docker orchestrátor pro Kategorii 2: Souborové I/O operace (Node.js, Deno, Bun).
 *
 * Automatizuje:
 * 1. Kontrolu dostupnosti Docker daemonu (docker info).
 * 2. Sestavení (build) izolovaných Docker obrazů (benchmark-node, benchmark-deno, benchmark-bun).
 * 3. Sekvenční spuštění kontejnerů s pevnými limity zdrojů (--cpus=2, --memory=2g, --memory-swap=2g).
 *    - Testovací adresář /app/temp zůstává UVNITŘ kontejneru (žádný bind-mount z Windows!),
 *      aby nedocházelo ke zkreslení I/O překladem mezi hostitelským a kontejnerovým FS.
 *    - Připojen je výhradně svazek s výsledky (-v ./results:/app/results).
 * 4. Kontrolu vygenerovaných JSON souborů v ./results/.
 * 5. Spuštění finálního porovnávacího skriptu (compare.js).
 *
 * Použití:
 *   node runner-docker.js
 *   node runner-docker.js --runtime=node
 *   node runner-docker.js --warmup=2 --iterations=5
 *   node runner-docker.js --cpus=1 --memory=2g
 */

import { spawn } from 'node:child_process';
import { access, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logInfo, logSection } from './core/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCKER_TARGETS = [
  {
    key: 'node',
    label: 'Node.js',
    image: 'benchmark-node',
    dockerfile: 'docker/Dockerfile.node',
    baseCmd: ['node', 'runner.js'],
    expectedRaw: 'file_io_raw_node.json',
    expectedSummary: 'file_io_summary_node.json'
  },
  {
    key: 'deno',
    label: 'Deno',
    image: 'benchmark-deno',
    dockerfile: 'docker/Dockerfile.deno',
    baseCmd: [
      'deno',
      'run',
      '--allow-read',
      '--allow-write',
      '--allow-sys',
      'scenarios/02-file-io/deno.ts'
    ],
    expectedRaw: 'file_io_raw_deno.json',
    expectedSummary: 'file_io_summary_deno.json'
  },
  {
    key: 'bun',
    label: 'Bun',
    image: 'benchmark-bun',
    dockerfile: 'docker/Dockerfile.bun',
    baseCmd: ['bun', 'run', 'scenarios/02-file-io/bun.ts'],
    expectedRaw: 'file_io_raw_bun.json',
    expectedSummary: 'file_io_summary_bun.json'
  }
];

/**
 * Spustí externí proces a streamuje jeho výstup do konzole (nebo jej zachytí v tichém režimu).
 */
function runCommand(command, args, { silent = false, cwd = __dirname } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: silent ? 'pipe' : 'inherit',
      shell: false
    });

    let stdout = '';
    let stderr = '';

    if (silent) {
      child.stdout?.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr?.on('data', (d) => {
        stderr += d.toString();
      });
    }

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        const err = new Error(
          `Příkaz "${command} ${args.join(' ')}" skončil s chybovým kódem ${code}.${stderr ? `\n${stderr}` : ''}`
        );
        err.code = code;
        reject(err);
      }
    });
  });
}

/**
 * Načte výchozí konfiguraci a zpracuje CLI argumenty.
 */
async function parseOptions() {
  const configRaw = await readFile(path.join(__dirname, 'config.json'), 'utf-8');
  const config = JSON.parse(configRaw);

  const options = {
    cpus: config.docker?.cpus ?? '2',
    memory: config.docker?.memory ?? '2g',
    memorySwap: config.docker?.memorySwap ?? '2g',
    runtimeFilter: null,
    skipBuild: false,
    passthroughArgs: []
  };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--cpus=')) {
      options.cpus = arg.split('=')[1];
    } else if (arg.startsWith('--memory=')) {
      options.memory = arg.split('=')[1];
      options.memorySwap = arg.split('=')[1];
    } else if (arg.startsWith('--memory-swap=')) {
      options.memorySwap = arg.split('=')[1];
    } else if (arg.startsWith('--runtime=')) {
      options.runtimeFilter = arg.split('=')[1].toLowerCase();
    } else if (arg === '--skip-build') {
      options.skipBuild = true;
    } else if (
      arg.startsWith('--warmup=') ||
      arg.startsWith('--iterations=') ||
      arg.startsWith('--scenario=')
    ) {
      options.passthroughArgs.push(arg);
    }
  }

  return options;
}

/**
 * Zjistí spustitelný příkaz pro Docker CLI (v systémové PATH nebo ve výchozí cestě Docker Desktopu na Windows).
 */
async function resolveDockerBinary() {
  try {
    await runCommand('docker', ['--version'], { silent: true });
    return 'docker';
  } catch {
    const winDefaultPath = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe';
    try {
      await access(winDefaultPath);
      return winDefaultPath;
    } catch {
      throw new Error(
        'Příkaz "docker" nebyl nalezen. Ujistěte se, že je nainstalován Docker Desktop a je v systémové PATH.'
      );
    }
  }
}

/**
 * Ověří, že Docker CLI i Docker daemon běží.
 */
async function verifyDockerRunning() {
  const dockerBin = await resolveDockerBinary();
  const versionRes = await runCommand(dockerBin, ['--version'], { silent: true });
  logInfo(`Nalezen Docker: ${versionRes.stdout.trim()}`);

  try {
    await runCommand(dockerBin, ['info'], { silent: true });
    logInfo('Docker daemon běží a je připraven.');
  } catch {
    throw new Error(
      'Docker daemon neběží nebo není dostupný. Spusťte prosím aplikaci Docker Desktop a vyčkejte na nastartování enginu.'
    );
  }

  return dockerBin;
}

/**
 * Ověří, že výsledkový JSON soubor existuje a není prázdný.
 */
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
  const resultsDir = path.resolve(__dirname, 'results');
  await mkdir(resultsDir, { recursive: true });

  logSection('DOCKER ORCHESTRÁTOR – KATEGORIE 2: SOUBOROVÉ I/O OPERACE');
  const dockerBin = await verifyDockerRunning();

  const targets = options.runtimeFilter
    ? DOCKER_TARGETS.filter((t) => t.key === options.runtimeFilter)
    : DOCKER_TARGETS;

  if (targets.length === 0) {
    throw new Error(
      `Neznámé běhové prostředí "${options.runtimeFilter}". Povolené hodnoty: node, deno, bun.`
    );
  }

  logInfo(
    `Limity kontejneru: --cpus=${options.cpus} --memory=${options.memory} --memory-swap=${options.memorySwap}`
  );
  logInfo(`Sdílený svazek výsledků: ${resultsDir} -> /app/results`);
  logInfo(
    `Izolace I/O: /app/temp běží striktně uvnitř kontejneru (bez bind-mountu z hostitele).`
  );
  if (options.passthroughArgs.length > 0) {
    logInfo(`Předané parametry měření: ${options.passthroughArgs.join(' ')}`);
  }

  // 1. Sestavení Docker obrazů
  if (!options.skipBuild) {
    for (const target of targets) {
      logSection(`1. SESTAVENÍ OBRAZU: ${target.image} (${target.label})`);
      await runCommand(dockerBin, [
        'build',
        '-t',
        target.image,
        '-f',
        target.dockerfile,
        '.'
      ]);
      logInfo(`Obraz ${target.image} úspěšně sestaven.`);
    }
  } else {
    logInfo('Krok sestavení obrazů přeskočen (--skip-build).');
  }

  // 2. Sekvenční spuštění kontejnerů
  for (const target of targets) {
    logSection(`2. SPUŠTĚNÍ KONTEJNERU: ${target.label} (${target.image})`);

    const containerName = `benchmark-file-io-${target.key}`;
    const runArgs = [
      'run',
      '--rm',
      '--name',
      containerName,
      `--cpus=${options.cpus}`,
      `--memory=${options.memory}`,
      `--memory-swap=${options.memorySwap}`,
      '-v',
      `${resultsDir}:/app/results`,
      target.image,
      ...target.baseCmd,
      ...options.passthroughArgs
    ];

    logInfo(`Spouštím: docker ${runArgs.join(' ')}`);
    await runCommand(dockerBin, runArgs);

    // 3. Kontrola vygenerovaných JSON souborů v ./results/
    const rawPath = path.join(resultsDir, target.expectedRaw);
    const summaryPath = path.join(resultsDir, target.expectedSummary);

    const rawSize = await verifyResultFile(rawPath);
    const summarySize = await verifyResultFile(summaryPath);

    logInfo(
      `Kontrola výstupů OK: ${target.expectedRaw} (${rawSize} B), ${target.expectedSummary} (${summarySize} B)`
    );
  }

  // 4. Finální porovnání výsledků všech prostředí
  logSection('3. VYHODNOCENÍ A KŘÍŽOVÉ POROVNÁNÍ VÝSLEDKŮ');
  await runCommand('node', ['compare.js']);
}

main().catch((err) => {
  console.error(`\n[CHYBA DOCKER ORCHESTRÁTORU]: ${err.message}`);
  process.exitCode = 1;
});
