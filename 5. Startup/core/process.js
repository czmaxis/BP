/**
 * Spouštění externích podprocesů (spawn / spawnSync) a vyhledávání spustitelných binárek
 * (node, deno, bun, docker) pro Kategorii 5: Doba spuštění (05-startup).
 */

import { spawn, spawnSync } from "node:child_process";
import { fileExists } from "./fs-helper.js";

/**
 * Spustí cílový proces synchronně bez shellu a změří celkový wall-clock čas
 * od vyvolání podprocesu v OS až po jeho kompletní ukončení (exit code === 0)
 * pomocí vysoko-rozlišovacího časovače `process.hrtime.bigint()`.
 *
 * @param {string} command Cesta k binárce (node, deno, bun)
 * @param {string[]} args Argumenty příkazu
 * @param {{ cwd?: string, expectedOutput?: string }} [options]
 * @returns {{ startupMs: number, stdout: string }}
 */
export function measureProcessStartupSync(
  command,
  args,
  { cwd = process.cwd(), expectedOutput = null } = {},
) {
  const t0 = process.hrtime.bigint();
  const result = spawnSync(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
    shell: false,
    windowsHide: true,
  });
  const t1 = process.hrtime.bigint();

  if (result.error) {
    throw new Error(
      `Chyba při spouštění procesu "${command} ${args.join(" ")}": ${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    throw new Error(
      `Proces "${command} ${args.join(" ")}" skončil s nenulovým kódem ${result.status}.\nStderr: ${result.stderr || ""}`,
    );
  }

  const cleanStdout = (result.stdout || "").trim();
  if (expectedOutput !== null && cleanStdout !== expectedOutput) {
    throw new Error(
      `Neočekávaný výstup procesu "${command} ${args.join(" ")}": očekáváno="${expectedOutput}", získáno="${cleanStdout}"`,
    );
  }

  const startupMs = Number(t1 - t0) / 1e6;
  return {
    startupMs,
    stdout: cleanStdout,
  };
}

/**
 * Spustí externí proces asynchronně a volitelně streamuje jeho výstup do konzole nebo jej zachytí.
 */
export function runExternalCommand(
  command,
  args,
  { silent = false, cwd = process.cwd(), shell = false } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: silent ? "pipe" : "inherit",
      shell,
    });

    let stdout = "";
    let stderr = "";

    if (silent) {
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (d) => {
        stdout += d;
      });
      child.stderr?.on("data", (d) => {
        stderr += d;
      });
    }

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        const err = new Error(
          `Příkaz "${command} ${args.join(" ")}" skončil s chybovým kódem ${code}.${stderr ? `\n${stderr}` : ""}`,
        );
        err.code = code;
        reject(err);
      }
    });
  });
}

/**
 * Vyhledá spustitelnou binárku nejprve v systémové PATH a případně v záložních cestách.
 */
export async function resolveBinary(cmdName, fallbackPaths = []) {
  const candidatesInPath =
    process.platform === "win32" && !cmdName.endsWith(".exe")
      ? [cmdName, `${cmdName}.exe`]
      : [cmdName];

  for (const candidate of candidatesInPath) {
    try {
      await runExternalCommand(candidate, ["--version"], {
        silent: true,
        shell: false,
      });
      return candidate;
    } catch {
      // Pokračujeme na dalšího kandidáta
    }
  }

  for (const candidate of fallbackPaths) {
    if (await fileExists(candidate)) {
      try {
        await runExternalCommand(candidate, ["--version"], {
          silent: true,
          shell: false,
        });
        return candidate;
      } catch {
        // Záložní binárka není spustitelná
      }
    }
  }
  return null;
}
