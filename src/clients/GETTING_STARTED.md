# QuickBooks execution provider

The MCP runtime does not own an Intuit OAuth application, refresh tokens, or a
default company. Finance owns those responsibilities and exposes a protected
execution-lease endpoint.

`FinanceExecutionLeaseProvider` sends the verified organization and trusted
Company selector with a dedicated workload bearer token. It requests one
short-lived lease per MCP tool call and strictly validates the response. The
provider interface exposes only `acquire(context)` and optional `release()`;
there is no separate connection-binding preflight.

The provider must never return a refresh token or Intuit client secret. See
`src/runtime/contracts.ts` for the port and `docs/REMOTE-HTTP.md` for runtime
configuration and ownership.

For local MCP-only tests, use a fake provider or fake `QboClientFactory`. Never
place customer credentials in `.env` or test fixtures.
