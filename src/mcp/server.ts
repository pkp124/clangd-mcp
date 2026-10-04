import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ClangdSession } from "../clangd/session.js";
import { registerTools } from "./register-tools.js";

export async function startMcpServer(session: ClangdSession): Promise<void> {
  const server = new McpServer({
    name: "clangd-mcp",
    version: "0.1.0",
  });
  registerTools(server, session);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
