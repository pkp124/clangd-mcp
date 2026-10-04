import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import { assertNever } from "../assert-never.js";
import { log } from "../log.js";
import { fromFileUri, requireWorkspaceFile, toFileUri } from "../paths.js";
import { LspClient } from "./client.js";
import type {
  AstNode,
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
  Diagnostic,
  DocumentSymbol,
  HoverResult,
  IndexSource,
  LspLocation,
  LspPosition,
  SymbolDetails,
  SymbolInformation,
  TypeHierarchyDirection,
  TypeHierarchyItem,
} from "./types.js";

const FILE_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESULTS = 50;

export type ClangdSessionOptions = {
  workspaceRoot: string;
  clangdPath: string;
  indexSource: IndexSource;
  compileCommandsDir?: string;
  extraArgs?: string[];
};

export type PositionArgs = {
  path: string;
  line: number;
  character: number;
};

type OpenFile = {
  version: number;
};

function languageIdFor(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".c":
      return "c";
    case ".h":
    case ".hh":
    case ".hpp":
    case ".hxx":
    case ".inc":
    case ".cc":
    case ".cpp":
    case ".cxx":
    case ".c++":
    case ".ipp":
    case ".ixx":
      return "cpp";
    default:
      return "cpp";
  }
}

function clangdArgs(options: ClangdSessionOptions): string[] {
  const args = [
    "--background-index=false",
    "--offset-encoding=utf-8",
    "--log=error",
    ...indexArgs(options.indexSource),
  ];
  if (options.compileCommandsDir) {
    args.push(`--compile-commands-dir=${options.compileCommandsDir}`);
  }
  if (options.extraArgs) {
    args.push(...options.extraArgs);
  }
  return args;
}

function indexArgs(source: IndexSource): string[] {
  switch (source.kind) {
    case "file":
      return [`--index-file=${source.path}`];
    case "remote":
      return [`--remote-index-address=${source.address}`, `--project-root=${source.mountPoint}`];
    default:
      return assertNever(source, "unknown index source");
  }
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function hoverText(contents: unknown): string {
  if (typeof contents === "string") {
    return contents;
  }
  if (contents && typeof contents === "object") {
    if ("value" in contents && typeof contents.value === "string") {
      return contents.value;
    }
    if (Array.isArray(contents)) {
      return contents.map((item) => hoverText(item)).filter(Boolean).join("\n");
    }
  }
  return "";
}

function capList<T>(items: T[], maxResults: number): T[] {
  return items.slice(0, maxResults);
}

export function trimAst(node: AstNode, depth: number): AstNode {
  if (depth <= 0) {
    const { children: _children, ...rest } = node;
    return rest;
  }
  return {
    ...node,
    children: node.children?.map((child) => trimAst(child, depth - 1)),
  };
}

export class ClangdSession {
  readonly workspaceRoot: string;
  readonly indexSource: IndexSource;
  readonly clangdPath: string;
  private child: ChildProcess | undefined;
  private client: LspClient | undefined;
  private initializeResult: unknown;
  private readonly openFiles = new Map<string, OpenFile>();
  private readonly openLocks = new Map<string, Promise<void>>();

  constructor(private readonly options: ClangdSessionOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.indexSource = options.indexSource;
    this.clangdPath = options.clangdPath;
  }

  async start(): Promise<void> {
    const args = clangdArgs(this.options);
    log("starting clangd", this.options.clangdPath, args.join(" "));
    const child = spawn(this.options.clangdPath, args, {
      stdio: ["pipe", "pipe", "inherit"],
    });
    this.child = child;
    if (!child.stdin || !child.stdout) {
      child.kill();
      throw new Error("failed to open clangd stdio pipes");
    }
    const client = new LspClient(child.stdin, child.stdout);
    this.client = client;
    child.on("exit", (code, signal) => {
      log(`clangd exited code=${code} signal=${signal}`);
      client.dispose();
    });

    this.initializeResult = await client.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(this.workspaceRoot).href,
      capabilities: {
        offsetEncoding: ["utf-8"],
        general: { positionEncodings: ["utf-8"] },
        textDocument: {
          hover: { contentFormat: ["markdown", "plaintext"] },
          publishDiagnostics: { relatedInformation: true },
          references: { container: true },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          callHierarchy: { dynamicRegistration: false },
          typeHierarchy: { dynamicRegistration: false },
        },
        workspace: {
          symbol: { symbolKind: { valueSet: [] } },
        },
      },
      initializationOptions: {
        clangdFileStatus: true,
        compilationDatabasePath: this.options.compileCommandsDir,
      },
    });
    client.notify("initialized", {});
  }

  async stop(): Promise<void> {
    const client = this.client;
    const child = this.child;
    this.client = undefined;
    this.child = undefined;
    if (client) {
      try {
        await client.request("shutdown", null);
        client.notify("exit", null);
      } catch {
        // clangd may already be gone
      }
      client.dispose();
    }
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
    }
  }

  status(): {
    clangdPath: string;
    workspaceRoot: string;
    index: IndexSource;
    ready: boolean;
    openFiles: string[];
    initializeResult: unknown;
  } {
    return {
      clangdPath: this.clangdPath,
      workspaceRoot: this.workspaceRoot,
      index: this.indexSource,
      ready: this.client !== undefined,
      openFiles: [...this.openFiles.keys()],
      initializeResult: this.initializeResult,
    };
  }

  async searchSymbols(query: string, maxResults = DEFAULT_MAX_RESULTS): Promise<SymbolInformation[]> {
    const client = this.requireClient();
    const result = await client.request<SymbolInformation[] | null>("workspace/symbol", {
      query,
    });
    return capList(result ?? [], maxResults);
  }

  async getHover(args: PositionArgs): Promise<{ hover: string; range?: unknown; symbol?: SymbolDetails[] }> {
    return this.withDocument(args.path, async (uri) => {
      const client = this.requireClient();
      const hover = await client.request<HoverResult | null>("textDocument/hover", {
        textDocument: { uri },
        position: this.position(args),
      });
      const symbol = await this.symbolInfo(uri, args);
      return {
        hover: hoverText(hover?.contents).slice(0, 4000),
        range: hover?.range,
        symbol,
      };
    });
  }

  async getDefinition(args: PositionArgs): Promise<{ locations: unknown[]; symbol?: SymbolDetails[] }> {
    return this.locationRequest("textDocument/definition", args);
  }

  async getDeclaration(args: PositionArgs): Promise<{ locations: unknown[]; symbol?: SymbolDetails[] }> {
    return this.locationRequest("textDocument/declaration", args);
  }

  async getTypeDefinition(args: PositionArgs): Promise<{ locations: unknown[]; symbol?: SymbolDetails[] }> {
    return this.locationRequest("textDocument/typeDefinition", args);
  }

  async getSymbolInfo(args: PositionArgs): Promise<SymbolDetails[]> {
    return this.withDocument(args.path, async (uri) => (await this.symbolInfo(uri, args)) ?? []);
  }

  async findReferences(
    args: PositionArgs & { maxResults?: number },
  ): Promise<{ locations: unknown[]; symbol?: SymbolDetails[] }> {
    return this.withDocument(args.path, async (uri) => {
      const client = this.requireClient();
      const result = await client.request<LspLocation[] | null>("textDocument/references", {
        textDocument: { uri },
        position: this.position(args),
        context: { includeDeclaration: true },
      });
      const symbol = await this.symbolInfo(uri, args);
      return {
        locations: this.normalizeLocations(result ?? [], args.maxResults ?? DEFAULT_MAX_RESULTS),
        symbol,
      };
    });
  }

  async findImplementations(args: PositionArgs): Promise<{ locations: unknown[]; symbol?: SymbolDetails[] }> {
    return this.locationRequest("textDocument/implementation", args);
  }

  async getCallers(
    args: PositionArgs & { depth?: number; maxResults?: number },
  ): Promise<{ callers: unknown[]; symbol?: SymbolDetails[] }> {
    return this.withDocument(args.path, async (uri) => {
      const items = await this.prepareCallHierarchy(uri, args);
      const callers = await this.walkIncoming(items, args.depth ?? 1, args.maxResults ?? DEFAULT_MAX_RESULTS);
      return { callers, symbol: await this.symbolInfo(uri, args) };
    });
  }

  async getCallees(
    args: PositionArgs & { depth?: number; maxResults?: number },
  ): Promise<{ callees: unknown[]; symbol?: SymbolDetails[] }> {
    return this.withDocument(args.path, async (uri) => {
      const items = await this.prepareCallHierarchy(uri, args);
      const callees = await this.walkOutgoing(items, args.depth ?? 1, args.maxResults ?? DEFAULT_MAX_RESULTS);
      return { callees, symbol: await this.symbolInfo(uri, args) };
    });
  }

  async getTypeHierarchy(
    args: PositionArgs & { direction?: TypeHierarchyDirection; maxResults?: number },
  ): Promise<{
    items: unknown[];
    parents?: unknown[];
    children?: unknown[];
    symbol?: SymbolDetails[];
  }> {
    const direction = args.direction ?? "both";
    return this.withDocument(args.path, async (uri) => {
      const client = this.requireClient();
      const items =
        (await client.request<TypeHierarchyItem[] | null>("textDocument/prepareTypeHierarchy", {
          textDocument: { uri },
          position: this.position(args),
        })) ?? [];
      const maxResults = args.maxResults ?? DEFAULT_MAX_RESULTS;
      const first = items[0];
      let parents: TypeHierarchyItem[] | undefined;
      let children: TypeHierarchyItem[] | undefined;
      if (first) {
        switch (direction) {
          case "parents":
            parents = await this.supertypes(first, maxResults);
            break;
          case "children":
            children = await this.subtypes(first, maxResults);
            break;
          case "both":
            parents = await this.supertypes(first, maxResults);
            children = await this.subtypes(first, maxResults);
            break;
          default:
            assertNever(direction, "unknown type hierarchy direction");
        }
      }
      return {
        items: items.map((item) => this.normalizeHierarchyItem(item)),
        parents: parents?.map((item) => this.normalizeHierarchyItem(item)),
        children: children?.map((item) => this.normalizeHierarchyItem(item)),
        symbol: await this.symbolInfo(uri, args),
      };
    });
  }

  async getFileSymbols(path: string): Promise<unknown[]> {
    return this.withDocument(path, async (uri) => {
      const client = this.requireClient();
      const result = await client.request<DocumentSymbol[] | SymbolInformation[] | null>(
        "textDocument/documentSymbol",
        { textDocument: { uri } },
      );
      return result ?? [];
    });
  }

  async getDiagnostics(path?: string): Promise<Record<string, unknown[]>> {
    const client = this.requireClient();
    if (path) {
      const resolved = requireWorkspaceFile(this.workspaceRoot, path);
      const uri = toFileUri(resolved);
      await this.ensureOpen(resolved);
      await this.waitForDiagnostics(uri);
      return { [resolved]: this.normalizeDiagnostics(client.getDiagnostics(uri)) };
    }
    const all: Record<string, unknown[]> = {};
    for (const [uri, diagnostics] of Object.entries(client.getAllDiagnostics())) {
      all[fromFileUri(uri)] = this.normalizeDiagnostics(diagnostics);
    }
    return all;
  }

  async switchSourceHeader(path: string): Promise<{ path: string }> {
    return this.withDocument(path, async (uri) => {
      const client = this.requireClient();
      const result = await client.request<string>("textDocument/switchSourceHeader", { uri });
      return { path: result ? fromFileUri(result) : "" };
    });
  }

  async getAst(
    args: PositionArgs & { endLine: number; endCharacter: number; maxDepth?: number },
  ): Promise<AstNode | null> {
    return this.withDocument(args.path, async (uri) => {
      const client = this.requireClient();
      const result = await client.request<AstNode | null>("textDocument/ast", {
        textDocument: { uri },
        range: {
          start: this.position(args),
          end: { line: args.endLine, character: args.endCharacter },
        },
      });
      if (!result) {
        return null;
      }
      return trimAst(result, args.maxDepth ?? 3);
    });
  }

  private async locationRequest(
    method: string,
    args: PositionArgs,
  ): Promise<{ locations: unknown[]; symbol?: SymbolDetails[] }> {
    return this.withDocument(args.path, async (uri) => {
      const client = this.requireClient();
      const result = await client.request<LspLocation | LspLocation[] | { uri: string }[] | null>(method, {
        textDocument: { uri },
        position: this.position(args),
      });
      const symbol = await this.symbolInfo(uri, args);
      return {
        locations: this.normalizeLocations(asArray(result), DEFAULT_MAX_RESULTS),
        symbol,
      };
    });
  }

  private async symbolInfo(uri: string, args: PositionArgs): Promise<SymbolDetails[] | undefined> {
    try {
      const result = await this.requireClient().request<SymbolDetails[] | SymbolDetails | null>(
        "textDocument/symbolInfo",
        {
          textDocument: { uri },
          position: this.position(args),
        },
      );
      const list = asArray(result);
      return list.length > 0 ? list : undefined;
    } catch {
      return undefined;
    }
  }

  private async prepareCallHierarchy(uri: string, args: PositionArgs): Promise<CallHierarchyItem[]> {
    const result = await this.requireClient().request<CallHierarchyItem[] | null>(
      "textDocument/prepareCallHierarchy",
      {
        textDocument: { uri },
        position: this.position(args),
      },
    );
    return result ?? [];
  }

  private async walkIncoming(
    items: CallHierarchyItem[],
    depth: number,
    maxResults: number,
  ): Promise<unknown[]> {
    const client = this.requireClient();
    const out: unknown[] = [];
    let frontier = items;
    for (let level = 0; level < depth && out.length < maxResults; level += 1) {
      const next: CallHierarchyItem[] = [];
      for (const item of frontier) {
        const calls =
          (await client.request<CallHierarchyIncomingCall[] | null>("callHierarchy/incomingCalls", {
            item,
          })) ?? [];
        for (const call of calls) {
          if (out.length >= maxResults) {
            break;
          }
          out.push({
            from: this.normalizeHierarchyItem(call.from),
            fromRanges: call.fromRanges,
            depth: level + 1,
          });
          next.push(call.from);
        }
      }
      frontier = next;
    }
    return out;
  }

  private async walkOutgoing(
    items: CallHierarchyItem[],
    depth: number,
    maxResults: number,
  ): Promise<unknown[]> {
    const client = this.requireClient();
    const out: unknown[] = [];
    let frontier = items;
    for (let level = 0; level < depth && out.length < maxResults; level += 1) {
      const next: CallHierarchyItem[] = [];
      for (const item of frontier) {
        const calls =
          (await client.request<CallHierarchyOutgoingCall[] | null>("callHierarchy/outgoingCalls", {
            item,
          })) ?? [];
        for (const call of calls) {
          if (out.length >= maxResults) {
            break;
          }
          out.push({
            to: this.normalizeHierarchyItem(call.to),
            fromRanges: call.fromRanges,
            depth: level + 1,
          });
          next.push(call.to);
        }
      }
      frontier = next;
    }
    return out;
  }

  private async supertypes(item: TypeHierarchyItem, maxResults: number): Promise<TypeHierarchyItem[]> {
    const result = await this.requireClient().request<TypeHierarchyItem[] | null>(
      "typeHierarchy/supertypes",
      { item },
    );
    return capList(result ?? [], maxResults);
  }

  private async subtypes(item: TypeHierarchyItem, maxResults: number): Promise<TypeHierarchyItem[]> {
    const result = await this.requireClient().request<TypeHierarchyItem[] | null>("typeHierarchy/subtypes", {
      item,
    });
    return capList(result ?? [], maxResults);
  }

  private normalizeHierarchyItem(item: CallHierarchyItem | TypeHierarchyItem): unknown {
    return {
      name: item.name,
      kind: item.kind,
      detail: item.detail,
      path: fromFileUri(item.uri),
      range: item.range,
      selectionRange: item.selectionRange,
    };
  }

  private normalizeLocations(locations: unknown[], maxResults: number): unknown[] {
    return capList(locations, maxResults).map((location) => {
      if (!location || typeof location !== "object") {
        return location;
      }
      const record = location as { uri?: string; targetUri?: string; range?: unknown; targetRange?: unknown; containerName?: string };
      const uri = record.uri ?? record.targetUri;
      return {
        path: uri ? fromFileUri(uri) : undefined,
        range: record.range ?? record.targetRange,
        containerName: record.containerName,
      };
    });
  }

  private normalizeDiagnostics(diagnostics: Diagnostic[]): unknown[] {
    return diagnostics.map((diagnostic) => ({
      range: diagnostic.range,
      severity: diagnostic.severity,
      code: diagnostic.code,
      source: diagnostic.source,
      message: diagnostic.message,
      category: diagnostic.category,
    }));
  }

  private position(args: PositionArgs): LspPosition {
    return { line: args.line, character: args.character };
  }

  private async withDocument<T>(path: string, fn: (uri: string) => Promise<T>): Promise<T> {
    const resolved = requireWorkspaceFile(this.workspaceRoot, path);
    const uri = toFileUri(resolved);
    await this.ensureOpen(resolved);
    return fn(uri);
  }

  private async ensureOpen(resolvedPath: string): Promise<void> {
    const existing = this.openLocks.get(resolvedPath);
    if (existing) {
      await existing;
      return;
    }
    const task = this.openFile(resolvedPath);
    this.openLocks.set(resolvedPath, task);
    try {
      await task;
    } finally {
      this.openLocks.delete(resolvedPath);
    }
  }

  private async openFile(resolvedPath: string): Promise<void> {
    if (this.openFiles.has(resolvedPath)) {
      return;
    }
    const client = this.requireClient();
    const uri = toFileUri(resolvedPath);
    const text = await readFile(resolvedPath, "utf8");
    client.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: languageIdFor(resolvedPath),
        version: 1,
        text,
      },
    });
    this.openFiles.set(resolvedPath, { version: 1 });
    await this.waitForIdle(uri);
  }

  private async waitForIdle(uri: string): Promise<void> {
    const client = this.requireClient();
    const current = client.getFileStatus(uri);
    if (current && /idle/i.test(current)) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, FILE_IDLE_TIMEOUT_MS);
      const onStatus = (status: { uri: string; state: string }) => {
        if (status.uri === uri && /idle/i.test(status.state)) {
          clearTimeout(timer);
          client.off("fileStatus", onStatus);
          resolve();
        }
      };
      client.on("fileStatus", onStatus);
    });
  }

  private async waitForDiagnostics(uri: string): Promise<void> {
    const client = this.requireClient();
    if (client.getDiagnostics(uri).length > 0 || client.getFileStatus(uri)) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      const onDiag = (diagUri: string) => {
        if (diagUri === uri) {
          clearTimeout(timer);
          client.off("diagnostics", onDiag);
          resolve();
        }
      };
      client.on("diagnostics", onDiag);
    });
  }

  private requireClient(): LspClient {
    if (!this.client) {
      throw new Error("clangd is not running");
    }
    return this.client;
  }
}

export { DEFAULT_MAX_RESULTS };
