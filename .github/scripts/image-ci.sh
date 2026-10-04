#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE="${CLANGD_MCP_IMAGE:-clangd-mcp:ci}"
FIXTURE="$ROOT/test/fixture"
INDEX="$FIXTURE/.clangd-mcp/index.idx"
HOST_NAME="${CLANGD_MCP_HOST_NAME:-clangd-mcp-host}"
NETWORK="${CLANGD_MCP_DOCKER_NETWORK:-clangd-mcp-ci}"

cd "$ROOT"

echo "::group::Image binary smoke"
docker run --rm --entrypoint clangd "$IMAGE" --version
docker run --rm --entrypoint clangd-indexer "$IMAGE" --help >/dev/null
docker run --rm --entrypoint clangd-index-server "$IMAGE" --help >/dev/null
docker run --rm "$IMAGE" --help
echo "::endgroup::"

echo "::group::Write compile_commands.json"
node dist/scripts/write-compile-commands.js "$FIXTURE"
echo "::endgroup::"

echo "::group::Index sample project with the image"
mkdir -p "$FIXTURE/.clangd-mcp"
docker run --rm \
  -v "$ROOT:$ROOT" \
  "$IMAGE" index \
  --compile-commands "$FIXTURE/compile_commands.json" \
  --output "$INDEX"
test -s "$INDEX"
echo "index bytes=$(wc -c < "$INDEX")"
echo "::endgroup::"

echo "::group::MCP tools via serve --index-file"
CLANGD_MCP_IMAGE="$IMAGE" \
  CLANGD_MCP_MOUNT="$ROOT" \
  CLANGD_MCP_SAMPLE="$FIXTURE" \
  CLANGD_MCP_INDEX_FILE="$INDEX" \
  node dist/scripts/mcp-e2e.js
echo "::endgroup::"

cleanup() {
  docker rm -f "$HOST_NAME" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "::group::Host the index and exercise serve --remote-index"
docker network create "$NETWORK" >/dev/null
docker run -d --name "$HOST_NAME" --network "$NETWORK" \
  -v "$ROOT:$ROOT" \
  "$IMAGE" host \
  --index-file "$INDEX" \
  --project-root "$FIXTURE"
sleep 3
docker logs "$HOST_NAME" 2>&1 | tail -n 20 || true

CLANGD_MCP_IMAGE="$IMAGE" \
  CLANGD_MCP_MOUNT="$ROOT" \
  CLANGD_MCP_SAMPLE="$FIXTURE" \
  CLANGD_MCP_REMOTE_INDEX="${HOST_NAME}:50051" \
  CLANGD_MCP_DOCKER_NETWORK="$NETWORK" \
  node dist/scripts/mcp-e2e.js
echo "::endgroup::"
