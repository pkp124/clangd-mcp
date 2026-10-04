import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ClangdSession } from "../clangd/session.js";
import { DEFAULT_MAX_RESULTS } from "../clangd/session.js";
import { errorResult, jsonResult } from "./result.js";

const positionInput = {
  path: z.string().describe("Absolute path to a source file in the workspace"),
  line: z.number().int().min(0).describe("0-based line"),
  character: z.number().int().min(0).describe("0-based UTF-8 character offset"),
};

const maxResultsField = {
  max_results: z.number().int().positive().optional().describe(`Default ${DEFAULT_MAX_RESULTS}`),
};

async function runTool(fn: () => Promise<unknown>) {
  try {
    return jsonResult(await fn());
  } catch (error) {
    return errorResult(error);
  }
}

export function registerTools(server: McpServer, session: ClangdSession): void {
  server.registerTool(
    "clangd_status",
    {
      description: "clangd process status, index source, and currently open files",
      inputSchema: {},
    },
    async () => runTool(async () => session.status()),
  );

  server.registerTool(
    "search_symbols",
    {
      description: "Fuzzy workspace symbol search (workspace/symbol)",
      inputSchema: {
        query: z.string().describe("Symbol name; leading :: scopes the search the way clangd does"),
        ...maxResultsField,
      },
    },
    async ({ query, max_results }) => runTool(() => session.searchSymbols(query, max_results)),
  );

  server.registerTool(
    "get_symbol_info",
    {
      description: "Resolve name, container, USR, and clangd id at a position (textDocument/symbolInfo)",
      inputSchema: positionInput,
    },
    async (args) => runTool(() => session.getSymbolInfo(args)),
  );

  server.registerTool(
    "get_hover",
    {
      description: "Hover text and type information at a position",
      inputSchema: positionInput,
    },
    async (args) => runTool(() => session.getHover(args)),
  );

  server.registerTool(
    "get_definition",
    {
      description: "Go to definition at a position",
      inputSchema: positionInput,
    },
    async (args) => runTool(() => session.getDefinition(args)),
  );

  server.registerTool(
    "get_declaration",
    {
      description: "Go to declaration at a position",
      inputSchema: positionInput,
    },
    async (args) => runTool(() => session.getDeclaration(args)),
  );

  server.registerTool(
    "get_type_definition",
    {
      description: "Go to the type definition at a position",
      inputSchema: positionInput,
    },
    async (args) => runTool(() => session.getTypeDefinition(args)),
  );

  server.registerTool(
    "find_references",
    {
      description: "Find references to the symbol at a position, including container names when available",
      inputSchema: { ...positionInput, ...maxResultsField },
    },
    async ({ path, line, character, max_results }) =>
      runTool(() => session.findReferences({ path, line, character, maxResults: max_results })),
  );

  server.registerTool(
    "find_implementations",
    {
      description: "Find implementations of the symbol at a position",
      inputSchema: positionInput,
    },
    async (args) => runTool(() => session.findImplementations(args)),
  );

  server.registerTool(
    "get_callers",
    {
      description: "Incoming call hierarchy for the function at a position",
      inputSchema: {
        ...positionInput,
        depth: z.number().int().positive().optional().describe("Default 1"),
        ...maxResultsField,
      },
    },
    async ({ path, line, character, depth, max_results }) =>
      runTool(() => session.getCallers({ path, line, character, depth, maxResults: max_results })),
  );

  server.registerTool(
    "get_callees",
    {
      description: "Outgoing call hierarchy for the function at a position",
      inputSchema: {
        ...positionInput,
        depth: z.number().int().positive().optional().describe("Default 1"),
        ...maxResultsField,
      },
    },
    async ({ path, line, character, depth, max_results }) =>
      runTool(() => session.getCallees({ path, line, character, depth, maxResults: max_results })),
  );

  server.registerTool(
    "get_type_hierarchy",
    {
      description: "Base and/or derived types for the type at a position",
      inputSchema: {
        ...positionInput,
        direction: z.enum(["parents", "children", "both"]).optional().describe("Default both"),
        ...maxResultsField,
      },
    },
    async ({ path, line, character, direction, max_results }) =>
      runTool(() =>
        session.getTypeHierarchy({ path, line, character, direction, maxResults: max_results }),
      ),
  );

  server.registerTool(
    "get_file_symbols",
    {
      description: "Document symbol outline for a file",
      inputSchema: {
        path: z.string().describe("Absolute path to a source file in the workspace"),
      },
    },
    async ({ path }) => runTool(() => session.getFileSymbols(path)),
  );

  server.registerTool(
    "get_diagnostics",
    {
      description: "Compiler diagnostics for one opened file, or all files clangd has published",
      inputSchema: {
        path: z.string().optional().describe("Absolute path; omit for all stored diagnostics"),
      },
    },
    async ({ path }) => runTool(() => session.getDiagnostics(path)),
  );

  server.registerTool(
    "switch_source_header",
    {
      description: "Paired header or source file for the given translation unit",
      inputSchema: {
        path: z.string().describe("Absolute path to a source or header file"),
      },
    },
    async ({ path }) => runTool(() => session.switchSourceHeader(path)),
  );

  server.registerTool(
    "get_ast",
    {
      description: "clangd AST for a source range (depth-capped)",
      inputSchema: {
        ...positionInput,
        end_line: z.number().int().min(0),
        end_character: z.number().int().min(0),
        max_depth: z.number().int().min(0).optional().describe("Default 3"),
      },
    },
    async ({ path, line, character, end_line, end_character, max_depth }) =>
      runTool(() =>
        session.getAst({
          path,
          line,
          character,
          endLine: end_line,
          endCharacter: end_character,
          maxDepth: max_depth,
        }),
      ),
  );
}
