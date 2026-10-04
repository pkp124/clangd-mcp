import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { LspClient } from "../src/clangd/client.js";
import { encodeMessage, MessageReader } from "../src/clangd/framing.js";

test("LspClient request/response and diagnostics", async () => {
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const reader = new MessageReader();
  toServer.on("data", (chunk: Buffer) => {
    for (const message of reader.push(chunk)) {
      if (message.method === "workspace/symbol") {
        toClient.write(
          encodeMessage({
            jsonrpc: "2.0",
            id: message.id,
            result: [{ name: "Foo", kind: 5, location: { uri: "file:///proj/foo.h", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } } } }],
          }),
        );
      }
    }
  });

  const client = new LspClient(toServer, toClient);
  toClient.write(
    encodeMessage({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: "file:///proj/foo.cpp",
        diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: "unused" }],
      },
    }),
  );

  const symbols = await client.request<unknown[]>("workspace/symbol", { query: "Foo" });
  assert.equal((symbols[0] as { name: string }).name, "Foo");
  assert.equal(client.getDiagnostics("file:///proj/foo.cpp")[0]?.message, "unused");
  client.dispose();
});
