/**
 * Hlavní lokální orchestrátor pro spuštění všech 3 prostředí (Node.js, Deno, Bun).
 *
 * Postup:
 * 1. Zjistí dostupnost a cesty k binárkám Node.js, Deno a Bun (s fallbackem na výchozí uživatelské složky ~/.deno/bin a ~/.bun/bin na Windows).
 * 2. Sekvenčně (postupně za sebou) spustí benchmarky pro:
 *    - Node.js (runner.js)
 *    - Deno (scenarios/02-file-io/deno.ts)
 *    - Bun (scenarios/02-file-io/bun.ts)
 * 3. Po dokončení automaticky spustí compare.js pro vykreslení křížové srovnávací tabulky a uložení file_io_comparison.json.
 *
 * Podporuje předání parametrů:
 *   --warmup=N --iterations=N --scenario=large|small --quick
 */

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logInfo, logSection } from './core/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveBinary(cmdName, fallbackRelativePath) {
  // 1. Zkusíme přímý název v PATH
  const canRunInPath = await new Promise((resolve) => {
    const p = spawn(cmdName, ['--version'], { stdio: 'ignore', shell: true });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });

  if (canRunInPath) {
    return cmdName;
  }

  // 2. Fallback na domovskou složku uživatele (~/.deno/bin/deno.exe apod.)
  if (fallbackRelativePath) {
    const fullPath = path.join(os.homedir(), fallbackRelativePath);
    if (await fileExists(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

function runProcess(command, args, cwd = __dirname) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: false
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const err = new Error(`Proces "${command} ${args.join(' ')}" selhal s kódem ${code}.`);
        err.code = code;
        reject(err);
      }
    });
  });
}

async function main() {
  logSection('LOKÁLNÍ ORCHESTRÁTOR – KATEGORIE 2: SOUBOROVÉ I/O OPERACE');
  logInfo('Detekuji dostupná běhová prostředí (Node.js, Deno, Bun)...');

  const nodeBin = process.execPath;
  const denoBin = await resolveBinary(
    'deno',
    os.platform() === 'win32' ? '.deno/bin/deno.exe' : '.deno/bin/deno'
  );
  const bunBin = await resolveBinary(
    'bun',
    os.platform() === 'win32' ? '.bun/bin/bun.exe' : '.bun/bin/bun'
  );

  logInfo(`Node.js : ${nodeBin}`);
  logInfo(`Deno    : ${denoBin ? denoBin : 'NENALEZENO'}`);
  logInfo(`Bun     : ${bunBin ? bunBin : 'NENALEZENO'}`);

  if (!denoBin || !bunBin) {
    const missing = [];
    if (!denoBin) missing.push('Deno');
    if (!bunBin) missing.push('Bun');
    throw new Error(
      `Chybí nainstalované prostředí: ${missing.join(', ')}. Nainstalujte je prosím dle dokumentace.`
    );
  }

  // Zpracování předaných CLI argumentů
  let passthroughArgs = process.argv.slice(2);
  if (passthroughArgs.includes('--quick')) {
    passthroughArgs = passthroughArgs.filter((a) => a !== '--quick');
    if (!passthroughArgs.some((a) => a.startsWith('--warmup='))) {
      passthroughArgs.push('--warmup=2');
    }
    if (!passthroughArgs.some((a) => a.startsWith('--iterations='))) {
      passthroughArgs.push('--iterations=5');
    }
  }

  if (passthroughArgs.length > 0) {
    logInfo(`Předávané parametry: ${passthroughArgs.join(' ')}`);
  }

  // 1. Spuštění Node.js
  logSection('1/3 SPUŠTĚNÍ PROSTŘEDÍ: NODE.JS');
  await runProcess(nodeBin, [path.join(__dirname, 'runner.js'), ...passthroughArgs]);

  // 2. Spuštění Deno
  logSection('2/3 SPUŠTĚNÍ PROSTŘEDÍ: DENO');
  const denoArgs = [
    'run',
    '--allow-read',
    '--allow-write',
    '--allow-sys',
    path.join(__dirname, 'scenarios', '02-file-io', 'deno.ts'),
    ...passthroughArgs
  ];
  await runProcess(denoBin, denoArgs);

  // 3. Spuštění Bun
  logSection('3/3 SPUŠTĚNÍ PROSTŘEDÍ: BUN');
  const bunArgs = [
    'run',
    path.join(__dirname, 'scenarios', '02-file-io', 'bun.ts'),
    ...passthroughArgs
  ];
  await runProcess(bunBin, bunArgs);

  // 4. Křížové porovnání
  logSection('KŘÍŽOVÉ POROVNÁNÍ VÝSLEDKŮ (compare.js)');
  await runProcess(nodeBin, [path.join(__dirname, 'compare.js')]);
}

main().catch((err) => {
  console.error('\n[CHYBA ORCHESTRÁTORU]:', err.message);
  process.exitCode = 1;
});

