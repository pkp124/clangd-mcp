#!/usr/bin/env node
import { assertCommand, CliError, parseCli, usage } from "./cli.js";
import { runHost } from "./commands/host.js";
import { runIndex } from "./commands/index-cmd.js";
import { runServe } from "./commands/serve.js";
import { log } from "./log.js";
import { assertNever } from "./assert-never.js";

async function main(): Promise<number> {
  let options;
  try {
    options = assertCommand(parseCli(process.argv.slice(2)));
  } catch (error) {
    const message = error instanceof CliError ? error.message : String(error);
    log(message);
    return error instanceof CliError ? (message === usage() ? 0 : 2) : 2;
  }

  switch (options.command) {
    case "serve":
      await runServe(options);
      return 0;
    case "index":
      return await runIndex(options);
    case "host":
      return await runHost(options);
    default:
      return assertNever(options, "unhandled command");
  }
}

main()
  .then((code) => {
    if (code !== 0) {
      process.exitCode = code;
    }
  })
  .catch((error: unknown) => {
    log(error);
    process.exitCode = 1;
  });
