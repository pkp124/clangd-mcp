# clangd-mcp

Containerized MCP server: a thin interface from agents to
[clangd](https://clangd.llvm.org/). The image ships clangd and
`clangd-indexer`. Use it to **build** a static index and to **serve**
clangd queries over MCP.

v1 keeps host paths as-is: bind-mount the workspace at the same absolute
path inside the container.

This package does not implement review or diff workflows. Those belong in
the caller.

See [PLAN.md](./PLAN.md) for the tool list, image layout, and phases.
Implementation has not started yet.
