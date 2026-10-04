import { parseArgs } from "node:util";
import { assertNever } from "./assert-never.js";

export type ServeOptions = {
  command: "serve";
  workspace: string;
  indexFile?: string;
  remoteIndex?: string;
  mountPoint?: string;
  compileCommandsDir?: string;
  clangdPath: string;
  extraArgs: string[];
};

export type IndexOptions = {
  command: "index";
  compileCommands: string;
  output: string;
  indexerPath: string;
  extraArgs: string[];
};

export type HostOptions = {
  command: "host";
  indexFile: string;
  projectRoot: string;
  serverAddress: string;
  indexServerPath: string;
};

export type CliOptions = ServeOptions | IndexOptions | HostOptions;

export class CliError extends Error {}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export function parseCli(argv: string[]): CliOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      workspace: { type: "string" },
      "index-file": { type: "string" },
      "remote-index": { type: "string" },
      "mount-point": { type: "string" },
      "compile-commands": { type: "string" },
      "compile-commands-dir": { type: "string" },
      output: { type: "string" },
      "project-root": { type: "string" },
      port: { type: "string" },
      "server-address": { type: "string" },
      clangd: { type: "string" },
      indexer: { type: "string" },
      "index-server": { type: "string" },
      "clangd-args": { type: "string", multiple: true },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    throw new CliError(usage());
  }

  const command = positionals[0];
  if (command === undefined) {
    throw new CliError(usage());
  }

  switch (command) {
    case "serve":
      return parseServe(values);
    case "index":
      return parseIndex(values);
    case "host":
      return parseHost(values);
    default:
      throw new CliError(`unknown command: ${command}\n\n${usage()}`);
  }
}

function parseServe(values: ReturnType<typeof parseArgs>["values"]): ServeOptions {
  const workspace = stringValue(values.workspace) ?? env("CLANGD_MCP_WORKSPACE");
  const indexFile = stringValue(values["index-file"]) ?? env("CLANGD_MCP_INDEX_FILE");
  const remoteIndex = stringValue(values["remote-index"]) ?? env("CLANGD_MCP_REMOTE_INDEX");
  if (!workspace) {
    throw new CliError("serve requires --workspace");
  }
  if (Boolean(indexFile) === Boolean(remoteIndex)) {
    throw new CliError("serve requires exactly one of --index-file or --remote-index");
  }
  return {
    command: "serve",
    workspace,
    indexFile,
    remoteIndex,
    mountPoint: stringValue(values["mount-point"]) ?? env("CLANGD_MCP_MOUNT_POINT"),
    compileCommandsDir:
      stringValue(values["compile-commands-dir"]) ?? env("CLANGD_MCP_COMPILE_COMMANDS_DIR"),
    clangdPath: stringValue(values.clangd) ?? env("CLANGD") ?? "clangd",
    extraArgs: (values["clangd-args"] as string[] | undefined) ?? [],
  };
}

function parseIndex(values: ReturnType<typeof parseArgs>["values"]): IndexOptions {
  const compileCommands = stringValue(values["compile-commands"]);
  const output = stringValue(values.output);
  if (!compileCommands || !output) {
    throw new CliError("index requires --compile-commands and --output");
  }
  return {
    command: "index",
    compileCommands,
    output,
    indexerPath: stringValue(values.indexer) ?? env("CLANGD_INDEXER") ?? "clangd-indexer",
    extraArgs: (values["clangd-args"] as string[] | undefined) ?? [],
  };
}

function parseHost(values: ReturnType<typeof parseArgs>["values"]): HostOptions {
  const indexFile = stringValue(values["index-file"]);
  const projectRoot = stringValue(values["project-root"]);
  if (!indexFile || !projectRoot) {
    throw new CliError("host requires --index-file and --project-root");
  }
  const port = stringValue(values.port);
  const serverAddress =
    stringValue(values["server-address"]) ?? (port ? `0.0.0.0:${port}` : "0.0.0.0:50051");
  return {
    command: "host",
    indexFile,
    projectRoot,
    serverAddress,
    indexServerPath: stringValue(values["index-server"]) ?? env("CLANGD_INDEX_SERVER") ?? "clangd-index-server",
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function usage(): string {
  return `Usage:
  clangd-mcp serve --workspace <dir> --index-file <file>
  clangd-mcp serve --workspace <dir> --remote-index <host:port>
  clangd-mcp index --compile-commands <file> --output <file>
  clangd-mcp host --index-file <file> --project-root <dir> [--port 50051]

serve options:
  --compile-commands-dir <dir>
  --mount-point <dir>          defaults to --workspace
  --clangd <path>
  --clangd-args <arg>          repeatable extra clangd flags
`;
}

export function assertCommand(options: CliOptions): CliOptions {
  switch (options.command) {
    case "serve":
    case "index":
    case "host":
      return options;
    default:
      return assertNever(options, "unknown CLI command");
  }
}
