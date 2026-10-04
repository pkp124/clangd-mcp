# clangd-mcp plan

An MCP server that is a **thin interface from agents to clangd**, delivered
as a **container**. The image includes clangd and `clangd-indexer`. The same
image both **builds** a static index and **serves** MCP queries against it.

The MCP tools themselves stay a clangd query interface. Review workflows,
diff parsing, and index-file comparison stay in the caller.

---

## Goal

Give agents project-wide C++ intelligence (symbols, xrefs, hover, call/type
hierarchy) over MCP, with a hermetic clangd stack.

The container:

1. **`index`** — run `clangd-indexer` on a `compile_commands.json` and write
   a static index file.
2. **`serve`** — start the MCP server, which starts clangd with
   `--index-file=<that file> --background-index=false` and exposes clangd
   requests as tools.

It does **not** interpret git diffs, assemble review reports, or parse
index files by hand.

---

## Why this exists

Agents default to grep. That misses overloads, templates, macros, virtual
dispatch, and cross-TU references. clangd already answers those from an
index. This image is the clangd + indexer + MCP socket.

Typical *callers* (not built into the tools):

- A review agent that already has a diff and wants callers / implementations
  for symbols it resolved itself.
- A pipeline that diffs two index files elsewhere, then looks up names or
  locations here.
- Interactive exploration: "what is this type?", "who calls this?"

---

## Constraints

- **Container is the unit of delivery.** clangd and `clangd-indexer` live
  in the image (same clangd release). Callers do not install clangd on the
  host.
- **Index build is a container command, not an MCP tool.** Building an
  index is a long batch job. `docker run … index` produces the file;
  `docker run … serve` queries it. The MCP tool list stays query-only.
- **One clangd, one index per serve process.** Comparing two indexes is
  two containers (or two serve invocations).
- **Paths stay as they are (v1).** clangd indexes store absolute paths.
  We do **not** rewrite `compile_commands.json`, source paths, or index
  URIs. Bind-mount the workspace (and anything the compile commands
  reference) at the **same absolute path** inside the container as on the
  host. Path remapping can come later if this becomes painful.
- **No LSP lookup by SymbolID / USR.** Callers join by name and/or
  `file:line:col`. Tools still return `usr` and clangd `id` from
  `textDocument/symbolInfo` when a position is available.
- **AST-backed vs index-backed.** Project-wide search, references, and
  call hierarchy come from the static index. Hover, document symbols,
  diagnostics, and AST still need `didOpen` plus a compile command for
  that file.

---

## Non-goals

- Review composites (hunk mapping, blast-radius ranking, test-path
  heuristics).
- Parsing unified diffs or git patches.
- Parsing or diffing clangd index files.
- Rewriting or relocating paths inside the index / compile database (v1).
- Completion, rename, apply-edit, format.
- Whole-TU AST dumps.
- Remote-index / clangd-index-server protocol.
- Attaching to a host or editor clangd.

---

## Architecture

```mermaid
flowchart TB
  subgraph image["clangd-mcp image"]
    Indexer["clangd-indexer"]
    MCP["MCP server"]
    Clangd["clangd"]
    MCP -->|"LSP stdio"| Clangd
  end
  HostWS["Host workspace at /same/abs/path"] -->|"bind mount"| image
  CDB["compile_commands.json"] --> Indexer
  Indexer --> Idx["index file"]
  Idx --> Clangd
  Agent["Agent"] -->|"MCP stdio via docker run -i"| MCP
```

Two entrypoints, one image:

| Command | What it runs |
| --- | --- |
| `index` | `clangd-indexer` → static index file |
| `serve` | MCP stdio server → child `clangd --index-file=…` |

### Image contents

Pin a **clangd GitHub release** (e.g. 22.x) and install matching assets:

- `clangd-linux-*.zip` → `clangd`
- `clangd_indexing_tools-linux-*.zip` → `clangd-indexer`

(`clangd-indexer` is not in the LLVM distro packages; it is in the
[clangd/clangd](https://github.com/clangd/clangd/releases) indexing-tools
asset.)

Also ship a default C/C++ compiler (image `clang`/`gcc`) so projects whose
compile commands use `/usr/bin/c++` (or similar) can index without a host
toolchain. If the project's compile commands point at a **custom**
compiler path, bind-mount that path too. Same rule as sources: no rewrite.

The MCP process is the image `CMD` (`serve`). `index` is an explicit
subcommand.

### Path rule (v1)

```text
host /home/me/proj     →  container /home/me/proj
host /opt/my-toolchain →  container /opt/my-toolchain   # only if CDB needs it
```

```bash
# Build the index (same image).
docker run --rm \
  -v /home/me/proj:/home/me/proj \
  clangd-mcp index \
    --compile-commands /home/me/proj/build/compile_commands.json \
    --output /home/me/proj/.clangd-mcp/index.idx

# Serve MCP over stdio (Cursor / Claude Code).
docker run -i --rm \
  -v /home/me/proj:/home/me/proj \
  clangd-mcp serve \
    --workspace /home/me/proj \
    --index-file /home/me/proj/.clangd-mcp/index.idx
```

If `compile_commands.json` names `/home/me/proj/...` and the compiler
`/usr/bin/c++`, both must exist at those paths in the container. The first
comes from the bind mount; the second from the image (or another mount).

### `index` command

Thin wrapper around `clangd-indexer`, same version as the image clangd:

```text
clangd-indexer --executor=all-TUs <compile_commands.json> > <output>
```

Flags we expose: compile-commands path, output path, extra indexer args.
The output is a static RIFF/YAML index suitable for `--index-file`.

This is **not** an MCP tool. CI or a human runs `index` when the tree or
compile database changes; agents then `serve`.

### `serve` command

1. Process manager starts clangd:
   ```text
   clangd --index-file=<abs> --background-index=false --offset-encoding=utf-8
          [--compile-commands-dir=<dir>]
   ```
2. LSP client: Content-Length JSON-RPC, `publishDiagnostics`,
   `clangd.fileStatus`.
3. Document session: `didOpen` / wait idle / `didClose` for position-based
   calls.
4. Tool layer: one MCP tool ≈ one clangd request (or prepare/resolve).

`--background-index=false` matters: the static `clangd-indexer` file is
not the same format as `.cache/clangd/index` shards. We do not want a
full reindex on first `didOpen`.

Config for `serve`:

| Setting | Purpose |
| --- | --- |
| index file | **Required.** clangd `--index-file`. |
| workspace root | **Required.** LSP `rootUri`. |
| compile-commands dir | Optional `compilationDatabasePath`. |
| extra clangd args | Escape hatch. |
| result caps | Applied in the MCP. |

clangd binary path is internal to the image, not a user setting.

### Language / MCP transport

**TypeScript + official `@modelcontextprotocol/sdk`**, Node 20+, **stdio**
inside the container. Host agents use `docker run -i`. HTTP/SSE can wait
until someone needs a long-lived daemon.

---

## Tools

Each tool is a direct clangd capability. Light presentation only: paths
as clangd returned them (absolute, matching the index), UTF-8 positions,
default result caps, optional snippets. No cross-tool review assembly.

When a tool is position-based and the token resolves, include `name`,
`containerName`, `kind`, `usr`, `id` from `textDocument/symbolInfo` where
it is cheap.

Default caps (overridable per call): `max_results=50`, `snippet_lines=0`,
`call_depth=1`.

| Tool | clangd / LSP | Notes |
| --- | --- | --- |
| `search_symbols` | `workspace/symbol` | Fuzzy name search; `::` scope hints as clangd implements them. |
| `get_symbol_info` | `textDocument/symbolInfo` | USR + clangd `id` at a position. |
| `get_hover` | `textDocument/hover` | Truncate long markdown. |
| `get_definition` | `textDocument/definition` | |
| `get_declaration` | `textDocument/declaration` | |
| `get_type_definition` | `textDocument/typeDefinition` | |
| `find_references` | `textDocument/references` | Enable `textDocument.references.container`. Cap the list. |
| `find_implementations` | `textDocument/implementation` | |
| `get_callers` | `prepareCallHierarchy` + `incomingCalls` | `depth` default 1. |
| `get_callees` | `prepareCallHierarchy` + `outgoingCalls` | Same. |
| `get_type_hierarchy` | `prepareTypeHierarchy` + super/sub | `direction`: parents, children, both. |
| `get_file_symbols` | `textDocument/documentSymbol` | Outline of one file. |
| `get_diagnostics` | stored `publishDiagnostics` | Per opened file. |
| `switch_source_header` | `textDocument/switchSourceHeader` | |
| `get_ast` | `textDocument/ast` | Range required, depth-capped. |
| `clangd_status` | initialize + fileStatus | clangd version, index-file path, ready?, open files. |

Omitted: `completion`, `rename`, `codeAction`, `formatting`, `inlayHints`,
`semanticTokens`, `inactiveRegions` as tools, `$/memoryUsage`, and any
`build_index` MCP tool.

---

## Example caller flow

1. Image built once (CI or local).
2. `docker run … index` on the project's `compile_commands.json`.
3. Agent config points at `docker run -i … serve` with the same mounts
   and the index file path.
4. Agent calls `search_symbols` / `get_definition` / `find_references` /
   `get_callers` / … as needed.

A review or index-diff job (elsewhere) uses the same `serve` tools.

---

## Operational details

**Readiness.** After LSP initialize, wait until the static index has
finished loading (`--index-file` is applied asynchronously in clangd).
`clangd_status` reports when index-backed tools are safe. For an opened
file, wait on `textDocument/clangd.fileStatus` before AST requests.

**didOpen.** Only files the tool needs. Close after idle.

**Compile database.** Fail clearly if an AST/position tool is called and
clangd has no compile command for that file. Index-only tools should
still work.

**Result hygiene.** Cap lists.

**Concurrency.** One clangd stdio socket inside the container; MCP tool
calls queue.

**Security.** Container entrypoint is `index` or `serve` only. No
arbitrary host shell. Bind mounts are the caller's responsibility.

**Resource.** `clangd-indexer` over a large CDB is CPU- and memory-heavy.
`index` should document that; `serve` is lighter once the file exists
but clangd plus the loaded index can still be large.

---

## Implementation phases

### Phase 0 — this document

Container + bundled clangd/indexer; MCP remains query-only.

### Phase 1 — skeleton + image

- TypeScript MCP stdio server.
- clangd spawn with required `--index-file` and `--background-index=false`.
- Document session (`didOpen` / `didClose` / fileStatus wait).
- `clangd_status`, `search_symbols`, `get_hover`, `get_definition`,
  `find_references`.
- Dockerfile: pinned clangd + indexing-tools + Node runtime.
- Image entrypoint: `index` | `serve`.

### Phase 2 — remaining clangd tools

- Declaration, type definition, symbol info, document symbols.
- Implementations, callers, callees, type hierarchy.
- Diagnostics, switch header, bounded AST.

### Phase 3 — polish

- Caps, optional snippets, `usr`/`id` on resolved positions.
- Unit tests against a mocked LSP.
- One integration test: fixture C++ project → `index` → `serve` → a few
  tool calls, all in the image.
- README: Docker run examples and Cursor / Claude Code MCP config.

---

## Open questions

1. **TypeScript vs Python** — plan assumes TypeScript (fits a Node-based
   image). Easy to flip before Phase 1.
2. **How much toolchain to ship.** A default `clang`/`g++` covers
   `/usr/bin/c++`. Projects with custom compilers keep mounting those
   paths. We will learn from real CDBs whether the default is enough.
3. **stdio vs HTTP.** v1 is `docker run -i` stdio. A long-running
   HTTP MCP can be added if attaching many agents to one clangd matters.
4. **Lookup-by-USR** would need a clangd-side extension. Out of scope
   unless name+location collisions become real.
5. **Path remapping** is explicitly deferred. If same-path bind mounts
   become unusable (CI runners, mixed OS paths), that is a later design.

---

## What success looks like

From one image, without a host clangd install:

- `index` produces a static index from an existing compile database.
- `serve` answers search, definition, hover, references, callers,
  implementations, and type hierarchy against that file.
- Host paths used in the compile database and the index are the same
  paths inside the container.

The server still does not know what a review, a diff, or a second index
is.
