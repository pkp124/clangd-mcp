import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { IndexOptions } from "../cli.js";
import { log } from "../log.js";

export async function runIndex(options: IndexOptions): Promise<number> {
  const compileCommands = resolve(options.compileCommands);
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  const args = ["--executor=all-TUs", ...options.extraArgs, compileCommands];
  log("running", options.indexerPath, args.join(" "));

  const out = createWriteStream(output);
  await new Promise<void>((resolveReady, reject) => {
    out.once("open", () => resolveReady());
    out.once("error", reject);
  });

  const child = spawn(options.indexerPath, args, {
    stdio: ["ignore", "pipe", "inherit"],
  });
  child.stdout.pipe(out);
  return await new Promise<number>((resolveExit, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      out.end();
      resolveExit(code ?? 1);
    });
  });
}
