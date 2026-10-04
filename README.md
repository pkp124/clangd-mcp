# clangd-mcp

MCP server that is a thin interface from agents to
[clangd](https://clangd.llvm.org/). You pass an already-built index file
(`clangd-indexer` output); the server starts clangd against it and exposes
clangd queries as tools.

This package does not build, parse, or diff indexes, and it does not
implement review or diff workflows. Those belong in the caller.

See [PLAN.md](./PLAN.md) for the tool list and implementation phases.
Implementation has not started yet.
