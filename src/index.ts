#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";

/**
 * The package remains stdio-oriented when launched directly. The container
 * image sets MCP_TRANSPORT=http explicitly; production startup never guesses
 * a remote transport from an incidental environment.
 */
async function main(): Promise<void> {
  const transport = (process.env.MCP_TRANSPORT ?? process.env.TRANSPORT ?? "stdio").toLowerCase();

  if (transport === "stdio") {
    const { createQuickbooksMcpServer } = await import("./server/qbo-mcp-server.js");
    const handle = serveStdio(() => createQuickbooksMcpServer(), {
      legacy: "reject",
      onerror: (error) => console.error("[mcp-stdio] transport error", error),
    });
    const close = () => {
      void handle.close().catch((error: unknown) => {
        console.error("[mcp-stdio] shutdown error", error);
        process.exitCode = 1;
      });
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    console.error("[mcp] serving modern MCP 2026-07-28 over stdio");
    return;
  }

  if (transport === "http") {
    const { startHttpServer } = await import("./http-server.js");
    await startHttpServer();
    return;
  }

  throw new Error(`Unsupported MCP_TRANSPORT value: ${transport}. Use "stdio" or "http".`);
}

main().catch((error: unknown) => {
  console.error("[mcp] startup failed", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
