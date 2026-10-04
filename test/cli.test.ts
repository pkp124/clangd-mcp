import assert from "node:assert/strict";
import { test } from "node:test";
import { CliError, parseCli } from "../src/cli.js";

test("parseCli serve requires exactly one index source", () => {
  assert.throws(
    () => parseCli(["serve", "--workspace", "/proj"]),
    (error: unknown) => error instanceof CliError,
  );
  assert.throws(
    () =>
      parseCli([
        "serve",
        "--workspace",
        "/proj",
        "--index-file",
        "/proj/a.idx",
        "--remote-index",
        "localhost:50051",
      ]),
    (error: unknown) => error instanceof CliError,
  );
});

test("parseCli serve with index file", () => {
  const previous = process.env.CLANGD;
  delete process.env.CLANGD;
  try {
    const options = parseCli(["serve", "--workspace", "/proj", "--index-file", "/proj/a.idx"]);
    assert.equal(options.command, "serve");
    if (options.command !== "serve") {
      throw new Error("expected serve");
    }
    assert.equal(options.workspace, "/proj");
    assert.equal(options.indexFile, "/proj/a.idx");
    assert.equal(options.clangdPath, "clangd");
  } finally {
    if (previous === undefined) {
      delete process.env.CLANGD;
    } else {
      process.env.CLANGD = previous;
    }
  }
});

test("parseCli serve with remote index", () => {
  const options = parseCli([
    "serve",
    "--workspace",
    "/llvm",
    "--remote-index",
    "clangd-index.llvm.org:5900",
  ]);
  assert.equal(options.command, "serve");
  if (options.command !== "serve") {
    throw new Error("expected serve");
  }
  assert.equal(options.remoteIndex, "clangd-index.llvm.org:5900");
});

test("parseCli index and host", () => {
  const index = parseCli([
    "index",
    "--compile-commands",
    "/proj/compile_commands.json",
    "--output",
    "/proj/index.idx",
  ]);
  assert.deepEqual(index.command === "index" && index.output, "/proj/index.idx");

  const host = parseCli([
    "host",
    "--index-file",
    "/proj/index.idx",
    "--project-root",
    "/proj",
    "--port",
    "5900",
  ]);
  assert.equal(host.command, "host");
  if (host.command !== "host") {
    throw new Error("expected host");
  }
  assert.equal(host.serverAddress, "0.0.0.0:5900");
});
