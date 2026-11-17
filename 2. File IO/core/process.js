/**
 * Spouštění externích podprocesů (spawn) a vyhledávání spustitelných binárek
 * (node, deno, bun, docker) pro orchestrátory runner-all.js a runner-docker.js.
 */

import { spawn } from "node:child_process";
import { fileExists } from "./fs-helper.js";

/**
 * Spustí externí proces a volitelně streamuje jeho výstup do konzole nebo jej zachytí.
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
      child.stdout?.on("data", (d) => {
        stdout += d.toString();
      });
      child.stderr?.on("data", (d) => {
        stderr += d.toString();
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
 * Vyhledá spustitelnou binárku nejprve v systémové PATH (se stejným režimem shell: false,
 * jaký používá samotný běh) a případně v záložních cestách.
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
      return candidate;
    }
  }
  return null;
}

