import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ClangdSession } from "../src/clangd/session.js";

const clangd = process.env.CLANGD;
const indexer = process.env.CLANGD_INDEXER;
const fixture = join(process.cwd(), "test/fixture");

function maybeSkip(): boolean {
  return !clangd || !indexer;
}

test("index + search + references against the fixture", { skip: maybeSkip() }, async () => {
  if (!clangd || !indexer) {
    throw new Error("CLANGD and CLANGD_INDEXER are required");
  }
  const cxx = spawnSync("clang++", ["--version"], { encoding: "utf8" });
  assert.equal(cxx.status, 0);
  const compileCommands = [
    {
      directory: fixture,
      command: `clang++ -std=c++17 -I${fixture}/include -c ${fixture}/src/widget.cpp -o ${fixture}/src/widget.o`,
      file: `${fixture}/src/widget.cpp`,
    },
    {
      directory: fixture,
      command: `clang++ -std=c++17 -I${fixture}/include -c ${fixture}/src/main.cpp -o ${fixture}/src/main.o`,
      file: `${fixture}/src/main.cpp`,
    },
  ];
  writeFileSync(join(fixture, "compile_commands.json"), JSON.stringify(compileCommands, null, 2));
  const indexFile = join(tmpdir(), `clangd-mcp-fixture-${process.pid}.idx`);
  const indexed = spawnSync(indexer, ["--executor=all-TUs", join(fixture, "compile_commands.json")]);
  assert.equal(indexed.status, 0, indexed.stderr.toString());
  writeFileSync(indexFile, indexed.stdout);

  const session = new ClangdSession({
    workspaceRoot: fixture,
    clangdPath: clangd,
    indexSource: { kind: "file", path: indexFile },
    compileCommandsDir: fixture,
  });
  await session.start();
  try {
    const symbols = await session.searchSymbols("compute");
    assert.ok(symbols.some((symbol) => symbol.name === "compute"));
    const refs = await session.findReferences({
      path: join(fixture, "include/widget.h"),
      line: 12,
      character: 4,
    });
    assert.ok(refs.locations.length >= 2);
    assert.ok(refs.symbol?.some((symbol) => symbol.name === "compute"));
  } finally {
    await session.stop();
  }
});
