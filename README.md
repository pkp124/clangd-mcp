# clangd-mcp

Containerized MCP server: a thin interface from agents to
[clangd](https://clangd.llvm.org/). The image ships clangd,
`clangd-indexer`, and `clangd-index-server` (the same remote-index stack
as [`clangd-index.llvm.org`](https://clangd-index.llvm.org/)).

Use it to **build** a static index, optionally **host** that index over
gRPC, and **serve** clangd queries over MCP — either from a local
`--index-file` or from a remote server (ours or LLVM's).

v1 keeps host paths as-is: bind-mount the workspace at the same absolute
path inside the container.

This package does not implement review or diff workflows. Those belong in
the caller.

See [PLAN.md](./PLAN.md) for the tool list, image layout, and phases.
Implementation has not started yet.
