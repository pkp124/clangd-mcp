import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeMessage, MessageReader } from "../src/clangd/framing.js";

test("encodeMessage writes Content-Length framing", () => {
  const encoded = encodeMessage({ jsonrpc: "2.0", id: 1, method: "ping" });
  const text = encoded.toString("utf8");
  assert.match(text, /^Content-Length: \d+\r\n\r\n{/);
  assert.ok(text.includes('"method":"ping"'));
});

test("MessageReader reassembles split chunks", () => {
  const encoded = encodeMessage({ jsonrpc: "2.0", id: 7, result: { ok: true } });
  const reader = new MessageReader();
  const mid = Math.floor(encoded.length / 2);
  assert.deepEqual(reader.push(encoded.subarray(0, mid)), []);
  const messages = reader.push(encoded.subarray(mid));
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], { jsonrpc: "2.0", id: 7, result: { ok: true } });
});
