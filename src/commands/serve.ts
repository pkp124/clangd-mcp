import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ServeOptions } from "../cli.js";
import { ClangdSession } from "../clangd/session.js";
import type { IndexSource } from "../clangd/types.js";
import { log } from "../log.js";
import { startMcpServer } from "../mcp/server.js";
import { resolveExisting } from "../paths.js";

function indexSource(options: ServeOptions, workspaceRoot: string): IndexSource {
  if (options.indexFile) {
    return { kind: "file", path: resolveExisting(options.indexFile) };
  }
  if (options.remoteIndex) {
    return {
      kind: "remote",
      address: options.remoteIndex,
      mountPoint: resolve(options.mountPoint ?? workspaceRoot),
    };
  }
  throw new Error("serve requires --index-file or --remote-index");
}

export async function runServe(options: ServeOptions): Promise<void> {
  const workspaceRoot = resolveExisting(options.workspace);
  const session = new ClangdSession({
    workspaceRoot,
    clangdPath: options.clangdPath,
    indexSource: indexSource(options, workspaceRoot),
    compileCommandsDir: options.compileCommandsDir
      ? resolve(options.compileCommandsDir)
      : undefined,
    extraArgs: options.extraArgs,
  });
  await session.start();
  log(`workspace ${workspaceRoot} rootUri=${pathToFileURL(workspaceRoot).href}`);

  const shutdown = async () => {
    await session.stop();
  };
  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  await startMcpServer(session);
}
