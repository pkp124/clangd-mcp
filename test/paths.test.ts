import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isPathInside, requireWorkspaceFile, toFileUri } from "../src/paths.js";

test("isPathInside accepts the root and descendants", () => {
  assert.equal(isPathInside("/proj", "/proj"), true);
  assert.equal(isPathInside("/proj", "/proj/src/a.cpp"), true);
  assert.equal(isPathInside("/proj", "/other/a.cpp"), false);
  assert.equal(isPathInside("/proj", "/proj-other/a.cpp"), false);
});

test("requireWorkspaceFile rejects files outside the workspace", () => {
  const root = mkdtempSync(join(tmpdir(), "clangd-mcp-"));
  const inside = join(root, "a.cpp");
  writeFileSync(inside, "int a;\n");
  assert.equal(requireWorkspaceFile(root, inside), inside);
  const outside = join(tmpdir(), "clangd-mcp-outside.cpp");
  writeFileSync(outside, "int b;\n");
  assert.throws(() => requireWorkspaceFile(root, outside), /outside the workspace/);
});

test("toFileUri produces a file URL", () => {
  assert.match(toFileUri("/tmp/foo.cpp"), /^file:\/\/.*foo\.cpp$/);
});
