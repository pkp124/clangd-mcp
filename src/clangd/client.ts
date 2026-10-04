import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";
import { log } from "../log.js";
import { encodeMessage, MessageReader, type JsonRpcMessage } from "./framing.js";
import type { Diagnostic, FileStatus } from "./types.js";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class LspError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(code: number, message: string, data: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

export class LspClient extends EventEmitter {
  private readonly reader = new MessageReader();
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private closed = false;
  private readonly diagnostics = new Map<string, Diagnostic[]>();
  private readonly fileStatus = new Map<string, string>();

  constructor(
    private readonly input: Writable,
    output: Readable,
  ) {
    super();
    output.on("data", (chunk: Buffer) => {
      try {
        for (const message of this.reader.push(chunk)) {
          this.dispatch(message);
        }
      } catch (error) {
        log("failed to parse LSP message", error);
      }
    });
    output.on("end", () => this.failAll(new Error("clangd stdout closed")));
    output.on("error", (error) => this.failAll(error));
    input.on("error", (error) => this.failAll(error));
  }

  getDiagnostics(uri: string): Diagnostic[] {
    return this.diagnostics.get(uri) ?? [];
  }

  getAllDiagnostics(): Record<string, Diagnostic[]> {
    return Object.fromEntries(this.diagnostics.entries());
  }

  getFileStatus(uri: string): string | undefined {
    return this.fileStatus.get(uri);
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    if (this.closed) {
      throw new Error("LSP client is closed");
    }
    const id = this.nextId;
    this.nextId += 1;
    const result = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
    });
    this.write({ jsonrpc: "2.0", id, method, params });
    return result;
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  dispose(): void {
    this.closed = true;
    this.failAll(new Error("LSP client disposed"));
  }

  private write(message: JsonRpcMessage): void {
    this.input.write(encodeMessage(message));
  }

  private dispatch(message: JsonRpcMessage): void {
    if (message.id !== undefined && message.method === undefined) {
      const id = typeof message.id === "number" ? message.id : Number(message.id);
      const pending = this.pending.get(id);
      if (!pending) {
        return;
      }
      this.pending.delete(id);
      if (message.error) {
        pending.reject(new LspError(message.error.code, message.error.message, message.error.data));
        return;
      }
      pending.resolve(message.result);
      return;
    }
    if (message.method === "textDocument/publishDiagnostics") {
      const params = message.params as { uri: string; diagnostics: Diagnostic[] };
      this.diagnostics.set(params.uri, params.diagnostics);
      this.emit("diagnostics", params.uri, params.diagnostics);
      return;
    }
    if (message.method === "textDocument/clangd.fileStatus") {
      const params = message.params as FileStatus;
      this.fileStatus.set(params.uri, params.state);
      this.emit("fileStatus", params);
      return;
    }
    if (message.method === "window/logMessage") {
      const params = message.params as { type?: number; message?: string };
      log("clangd:", params.message ?? "");
    }
  }

  private failAll(error: Error): void {
    this.closed = true;
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
