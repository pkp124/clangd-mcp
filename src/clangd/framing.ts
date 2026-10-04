export type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export function encodeMessage(body: unknown): Buffer {
  const json = JSON.stringify(body);
  const header = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n`;
  return Buffer.concat([Buffer.from(header, "utf8"), Buffer.from(json, "utf8")]);
}

export class MessageReader {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): JsonRpcMessage[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: JsonRpcMessage[] = [];
    for (;;) {
      const parsed = this.takeOne();
      if (parsed === undefined) {
        break;
      }
      messages.push(parsed);
    }
    return messages;
  }

  private takeOne(): JsonRpcMessage | undefined {
    const headerEnd = this.buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      return undefined;
    }
    const header = this.buffer.subarray(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      throw new Error(`LSP message missing Content-Length: ${header}`);
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (this.buffer.length < bodyStart + length) {
      return undefined;
    }
    const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
    this.buffer = this.buffer.subarray(bodyStart + length);
    return JSON.parse(body) as JsonRpcMessage;
  }
}
