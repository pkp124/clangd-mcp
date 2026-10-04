import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { assertNever } from "../src/assert-never.js";

const EXPECTED_TOOLS = [
  "clangd_status",
  "search_symbols",
  "get_symbol_info",
  "get_hover",
  "get_definition",
  "get_declaration",
  "get_type_definition",
  "find_references",
  "find_implementations",
  "get_callers",
  "get_callees",
  "get_type_hierarchy",
  "get_file_symbols",
  "get_diagnostics",
  "switch_source_header",
  "get_ast",
] as const;

const TOOL_TIMEOUT_MS = 60_000;

type IndexMode =
  | { kind: "file"; path: string }
  | { kind: "remote"; address: string };

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env ${name}`);
  }
  return value;
}

function serveArgs(workspace: string, mode: IndexMode): string[] {
  const args = ["serve", "--workspace", workspace, "--compile-commands-dir", workspace];
  switch (mode.kind) {
    case "file":
      args.push("--index-file", mode.path);
      break;
    case "remote":
      args.push("--remote-index", mode.address, "--mount-point", workspace);
      break;
    default:
      return assertNever(mode, "unknown index mode");
  }
  return args;
}

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [
    "PATH",
    "HOME",
    "TMPDIR",
    "CLANGD",
    "CLANGD_INDEXER",
    "CLANGD_INDEX_SERVER",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
  ]) {
    const value = process.env[key];
    if (value) {
      env[key] = value;
    }
  }
  return env;
}

function transportCommand(workspace: string, mode: IndexMode): { command: string; args: string[] } {
  const image = process.env.CLANGD_MCP_IMAGE;
  if (!image) {
    const entry = process.env.CLANGD_MCP_SERVE_ENTRY ?? "dist/src/main.js";
    return { command: "node", args: [entry, ...serveArgs(workspace, mode)] };
  }
  const mount = resolve(process.env.CLANGD_MCP_MOUNT ?? process.cwd());
  const args = ["run", "-i", "--rm"];
  const network = process.env.CLANGD_MCP_DOCKER_NETWORK;
  if (network) {
    args.push("--network", network);
  }
  args.push("-v", `${mount}:${mount}`, image, ...serveArgs(workspace, mode));
  return { command: "docker", args };
}

function parseToolJson(result: unknown): unknown {
  const record = result as {
    isError?: boolean;
    content?: { type?: string; text?: string }[];
  };
  if (record.isError) {
    throw new Error(`tool returned an error: ${JSON.stringify(result)}`);
  }
  const textItem = record.content?.find((item) => item.type === "text" && typeof item.text === "string");
  if (!textItem?.text) {
    throw new Error(`tool result had no text content: ${JSON.stringify(result)}`);
  }
  return JSON.parse(textItem.text);
}

async function callJson(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: TOOL_TIMEOUT_MS,
  });
  return parseToolJson(result);
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.ok(value);
  return value as Record<string, unknown>;
}

async function exerciseTools(client: Client, workspace: string): Promise<void> {
  const header = `${workspace}/include/widget.h`;
  const source = `${workspace}/src/widget.cpp`;
  const mainFile = `${workspace}/src/main.cpp`;
  const compute = { path: header, line: 12, character: 4 };
  const virtualValue = { path: header, line: 4, character: 14 };
  const widgetType = { path: header, line: 2, character: 6 };
  const mainFn = { path: mainFile, line: 2, character: 4 };

  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  for (const expected of EXPECTED_TOOLS) {
    assert.ok(names.includes(expected), `missing tool ${expected}; have ${names.join(", ")}`);
  }

  const status = asRecord(await callJson(client, "clangd_status"));
  assert.equal(status.ready, true);
  assert.equal(status.workspaceRoot, workspace);

  const symbols = await callJson(client, "search_symbols", { query: "compute" });
  assert.ok(Array.isArray(symbols));
  assert.ok(
    (symbols as { name?: string }[]).some((symbol) => symbol.name === "compute"),
    `search_symbols missed compute: ${JSON.stringify(symbols)}`,
  );

  const hover = asRecord(await callJson(client, "get_hover", compute));
  assert.match(String(hover.hover), /compute/);

  const definition = asRecord(await callJson(client, "get_definition", compute));
  assert.ok(Array.isArray(definition.locations));
  assert.ok((definition.locations as unknown[]).length >= 1);

  const declaration = asRecord(await callJson(client, "get_declaration", compute));
  assert.ok(Array.isArray(declaration.locations));

  const typeDef = asRecord(await callJson(client, "get_type_definition", compute));
  assert.ok(Array.isArray(typeDef.locations));

  const info = await callJson(client, "get_symbol_info", compute);
  assert.ok(Array.isArray(info));
  assert.ok((info as { name?: string }[]).some((symbol) => symbol.name === "compute"));

  const refs = asRecord(await callJson(client, "find_references", compute));
  assert.ok(Array.isArray(refs.locations));
  assert.ok((refs.locations as unknown[]).length >= 2);

  const impls = asRecord(await callJson(client, "find_implementations", virtualValue));
  assert.ok(Array.isArray(impls.locations));
  assert.ok((impls.locations as unknown[]).length >= 1);

  const callers = asRecord(await callJson(client, "get_callers", compute));
  assert.ok(Array.isArray(callers.callers));
  assert.ok((callers.callers as unknown[]).length >= 1);

  const callees = asRecord(await callJson(client, "get_callees", mainFn));
  assert.ok(Array.isArray(callees.callees));

  const hierarchy = asRecord(await callJson(client, "get_type_hierarchy", widgetType));
  assert.ok(Array.isArray(hierarchy.items));

  const fileSymbols = await callJson(client, "get_file_symbols", { path: header });
  assert.ok(Array.isArray(fileSymbols));
  assert.ok((fileSymbols as { name?: string }[]).some((symbol) => symbol.name === "Widget"));

  const diagnostics = await callJson(client, "get_diagnostics", { path: source });
  assert.equal(typeof diagnostics, "object");

  const swapped = asRecord(await callJson(client, "switch_source_header", { path: source }));
  assert.match(String(swapped.path), /widget\.h$/);

  const ast = asRecord(
    await callJson(client, "get_ast", {
      ...compute,
      end_line: 12,
      end_character: 11,
      max_depth: 2,
    }),
  );
  assert.ok(typeof ast.kind === "string" || typeof ast.role === "string");
}

async function main(): Promise<void> {
  const workspace = resolve(process.env.CLANGD_MCP_SAMPLE ?? "test/fixture");
  const remote = process.env.CLANGD_MCP_REMOTE_INDEX;
  const mode: IndexMode = remote
    ? { kind: "remote", address: remote }
    : { kind: "file", path: resolve(requiredEnv("CLANGD_MCP_INDEX_FILE")) };

  const { command, args } = transportCommand(workspace, mode);
  process.stderr.write(`mcp-e2e: ${command} ${args.join(" ")}\n`);

  const transport = new StdioClientTransport({
    command,
    args,
    stderr: "inherit",
    env: childEnv(),
  });
  const client = new Client({ name: "clangd-mcp-e2e", version: "0.1.0" });
  await client.connect(transport);
  try {
    await exerciseTools(client, workspace);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
