import assert from "node:assert/strict";
import { test } from "node:test";
import { trimAst } from "../src/clangd/session.js";
import type { AstNode } from "../src/clangd/types.js";

test("trimAst drops children at depth 0", () => {
  const node: AstNode = {
    role: "declaration",
    kind: "Function",
    children: [{ role: "statement", kind: "CompoundStmt", children: [{ role: "expression", kind: "Call" }] }],
  };
  const trimmed = trimAst(node, 0);
  assert.equal(trimmed.kind, "Function");
  assert.equal(trimmed.children, undefined);
});

test("trimAst keeps nested nodes up to depth", () => {
  const node: AstNode = {
    role: "declaration",
    kind: "Function",
    children: [{ role: "statement", kind: "CompoundStmt", children: [{ role: "expression", kind: "Call" }] }],
  };
  const trimmed = trimAst(node, 1);
  assert.equal(trimmed.children?.[0]?.kind, "CompoundStmt");
  assert.equal(trimmed.children?.[0]?.children, undefined);
});
