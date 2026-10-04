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

## Commands

```text
clangd-mcp serve --workspace <dir> --index-file <file>
clangd-mcp serve --workspace <dir> --remote-index <host:port>
clangd-mcp index --compile-commands <file> --output <file>
clangd-mcp host  --index-file <file> --project-root <dir> [--port 50051]
```

`serve` requires exactly one of `--index-file` or `--remote-index`.
`--mount-point` defaults to `--workspace`. Remote-index is passed to
clangd as `--remote-index-address` and `--project-root` (GitHub clangd
builds). Index build and hosting are container commands, not MCP tools.

## Docker

```bash
docker build -t clangd-mcp .

# Build an index (same absolute paths as the host).
docker run --rm \
  -v /home/me/proj:/home/me/proj \
  clangd-mcp index \
    --compile-commands /home/me/proj/build/compile_commands.json \
    --output /home/me/proj/.clangd-mcp/index.idx

# Optional: share that index over gRPC.
docker run --rm -p 50051:50051 \
  -v /home/me/proj:/home/me/proj \
  clangd-mcp host \
    --index-file /home/me/proj/.clangd-mcp/index.idx \
    --project-root /home/me/proj

# MCP over stdio (local file).
docker run -i --rm \
  -v /home/me/proj:/home/me/proj \
  clangd-mcp serve \
    --workspace /home/me/proj \
    --index-file /home/me/proj/.clangd-mcp/index.idx

# Or attach clangd to LLVM's public remote index.
docker run -i --rm \
  -v /home/me/llvm:/home/me/llvm \
  clangd-mcp serve \
    --workspace /home/me/llvm \
    --remote-index clangd-index.llvm.org:5900
```

Cursor / Claude Code (`stdio`):

```json
{
  "mcpServers": {
    "clangd": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "/home/me/proj:/home/me/proj",
        "clangd-mcp", "serve",
        "--workspace", "/home/me/proj",
        "--index-file", "/home/me/proj/.clangd-mcp/index.idx"
      ]
    }
  }
}
```

Without Docker, `npm run build && node dist/src/main.js serve ...` if
`clangd` is on `PATH`.

## MCP tools

`search_symbols`, `get_symbol_info`, `get_hover`, `get_definition`,
`get_declaration`, `get_type_definition`, `find_references`,
`find_implementations`, `get_callers`, `get_callees`,
`get_type_hierarchy`, `get_file_symbols`, `get_diagnostics`,
`switch_source_header`, `get_ast`, `clangd_status`.

Paths in tool arguments are absolute workspace paths (the same paths
stored in the index). Positions are 0-based UTF-8.

See [PLAN.md](./PLAN.md) for the design.
