# clangd-mcp

MCP server that talks to a live [clangd](https://clangd.llvm.org/) process and
exposes C++ semantic queries as tools. The intended consumer is a review
agent: given a change, get the relevant neighborhood (symbols, callers,
implementations, type hierarchy, diagnostics) from an already-built clangd
index.

This server does not build, parse, or diff clangd index files. Index diffs
from regression runs stay outside; this process queries one clangd / one
index.

See [PLAN.md](./PLAN.md) for use cases, tool list, and implementation phases.
Implementation has not started yet.
