import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { HostOptions } from "../cli.js";
import { log } from "../log.js";

export async function runHost(options: HostOptions): Promise<number> {
  const indexFile = resolve(options.indexFile);
  const projectRoot = resolve(options.projectRoot);
  const args = [`--server-address=${options.serverAddress}`, indexFile, projectRoot];
  log("running", options.indexServerPath, args.join(" "));
  const child = spawn(options.indexServerPath, args, { stdio: "inherit" });
  return await new Promise<number>((resolveExit, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolveExit(code ?? 1));
  });
}
