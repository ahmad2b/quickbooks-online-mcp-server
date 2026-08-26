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
  // Startup errors may contain provider URLs or configuration details. Keep
  // the process log metadata-only; operators can inspect the deployment's
  // authenticated readiness telemetry separately.
  console.error("[mcp] startup failed", error instanceof Error ? error.name : "unknown");
  process.exitCode = 1;
});
