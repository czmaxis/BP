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
 * Vyhledá spustitelnou binárku nejprve v systémové PATH a případně v záložních cestách.
 */
export async function resolveBinary(cmdName, fallbackPaths = []) {
  try {
    await runExternalCommand(cmdName, ["--version"], {
      silent: true,
      shell: true,
    });
    return cmdName;
  } catch {
    for (const candidate of fallbackPaths) {
      if (await fileExists(candidate)) {
        return candidate;
      }
    }
    return null;
  }
}

