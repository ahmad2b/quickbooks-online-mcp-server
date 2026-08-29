# Production Streamable HTTP

The server exposes MCP `2026-07-28` at `POST /mcp` using the official
TypeScript SDK v2 handler. It rejects stdio, legacy protocol versions, the
initialization lifecycle, general GET event streams, and MCP session state.

## Runtime ownership

Finance owns organizations, Company-to-QuickBooks connection mapping, Intuit
OAuth exchange, refresh-token storage and rotation, revocation, and
reauthorization state. The MCP server owns the remote tool interface and
request-scoped QuickBooks execution only.

For each tool call, the MCP server:

1. verifies the resource-bound AuthCo token, scopes, and single organization;
2. reads the Company selector from trusted per-call metadata at
   `com.devraftel.finance/company_id`;
3. rejects organization, Company, connection, realm, environment, credential,
   and server-file routing values supplied as model tool arguments;
4. requests one short-lived execution lease from Finance;
5. validates the lease organization, Company, environment, expiry, and shape;
6. creates a fresh request-scoped QuickBooks client, invokes the tool, and
   releases request references.

The Finance lease response may contain a temporary access token, realm ID,
connection ID, environment, expiry, credential version, and lease ID. It must
never contain an Intuit refresh token or client secret. No QuickBooks client,
access token, realm, or connection is process-global.

## Authorization and scopes

Every tool requires `quickbooks.read`. Write/update tools additionally require
`quickbooks.write`; delete tools require `quickbooks.delete`. Tool definitions
retain explicit read/write/delete authority and MCP risk annotations.

AuthCo authorization is technical permission to call an MCP tool. Product
supervision and human approval for financial mutations belong to the employee
and client application, not this MCP server.

## Deliberately deferred controls

This v1 MCP layer has no custom application-level rate limiter, mutation
ledger, duplicate-write protection, or MCP-side confirmation flow. These are
not mandatory MCP protocol features.

A write may have succeeded in QuickBooks even when its HTTP response is lost.
Callers must not blindly retry an ambiguous mutation. Before production writes,
idempotency, reconciliation, supervision, and any service-level throttling must
be designed in the system that owns execution at that time—preferably Finance
or deployment gateway infrastructure. QuickBooks/provider throttling responses
still surface through normal tool errors.

## Files and errors

Remote tools accept bounded inline attachment/PDF bytes only. They reject
server file paths, overwrite controls, and arbitrary server-side URL fetching.
Errors and logs omit provider bodies, credentials, internal URLs, stack traces,
and business payloads.

## Configuration

Copy `.env.example`. Required values are:

- `MCP_RESOURCE_URI`, host/origin allowlists, body limit, and request timeout;
- AuthCo issuer, metadata URL, introspection URL and confidential introspection
  client credentials;
- `MCP_AUTH_ORGANIZATION_CLAIM`;
- `QBO_EXECUTION_LEASE_PROVIDER=finance-http`;
- `FINANCE_QUICKBOOKS_INTERNAL_URL`;
- the dedicated `FINANCE_QUICKBOOKS_WORKLOAD_TOKEN`;
- `FINANCE_QUICKBOOKS_ENVIRONMENT` and a bounded timeout.

Do not configure this process with an Intuit client secret, refresh token,
realm ID, deployment-wide QuickBooks connection, database URL, ledger, or
rate-limiter provider.

## Validation still required

Local build and tests do not prove live integration. Before deployment, verify
real AuthCo token issuance/introspection and revocation, Finance workload
authentication, organization/Company rejection, sandbox lease acquisition, at
least one read tool, one mutation tool using non-customer sandbox data, token
refresh through Finance, and redacted failure behavior.
