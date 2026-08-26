#!/usr/bin/env node

/**
 * The executable is HTTP-only. MCP 2025-era requests and stdio serving are not
 * fallback paths; deployment rollback uses the previous release artifact.
 */
async function main(): Promise<void> {
  const { startHttpServer } = await import("./http-server.js");
  await startHttpServer();
}

main().catch((error: unknown) => {
  console.error("[mcp] startup failed", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
