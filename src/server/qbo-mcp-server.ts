import { McpServer } from "@modelcontextprotocol/server";
import { getToolDefinitions } from "../registry.js";
import { RegisterTool } from "../helpers/register-tool.js";
import { APPLICATION_VERSION } from "../version.js";
import type { RuntimeServices } from "../runtime/contracts.js";

export const QUICKBOOKS_SERVER_INFO = {
  name: "QuickBooks Online MCP Server",
  version: APPLICATION_VERSION,
} as const;

/**
 * Build a fresh v2 server instance for one serving unit/request. QuickBooks
 * credentials and clients are created later by the request execution seam;
 * protocol state is never shared between HTTP requests.
 */
export function createQuickbooksMcpServer(services: RuntimeServices): McpServer {
  const server = new McpServer(QUICKBOOKS_SERVER_INFO, {
    capabilities: {
      tools: {},
    },
  });

  for (const definition of getToolDefinitions()) {
    RegisterTool(server, definition, services);
  }

  return server;
}
