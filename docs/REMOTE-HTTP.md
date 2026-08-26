# Production Streamable HTTP

The server exposes only MCP `2026-07-28` at `POST /mcp`. It rejects stdio,
legacy protocol versions, the initialization lifecycle, HTTP+SSE, general GET
event streams, and MCP session state. `legacy: "reject"` is configured in the
official TypeScript SDK v2 handler.

## Runtime ownership

DevRaftel control-plane infrastructure owns organizations, membership,
connection selection, Intuit OAuth exchange, refresh-token storage and
rotation, revocation, and reauthorization state. This MCP resource server
verifies a resource-bound access token, extracts one configured organization
claim and one opaque QuickBooks connection claim, and never accepts those
values from headers or tool arguments.

After authorization, the runtime creates an immutable `ExecutionContext` and
requests one short-lived execution lease from the injected
`QboExecutionLeaseProvider`. The lease contains an access token, realm ID,
environment, credential version, connection ID, expiry, and lease ID; it never
contains a refresh token or client secret. The request-scoped
`QboClientFactory` constructs a fresh `node-quickbooks` client and releases it
after the call. No client, token, realm, or connection is process-global.

The internal connection-service protocol is intentionally not defined here.
Deployment supplies an authenticated adapter implementing the port in
`src/runtime/contracts.ts`. The same boundary applies to the durable
operation ledger and shared rate limiter.

## Authorization and scopes

Configure the exact MCP resource URI and OAuth issuer. Tokens must have that
resource as audience, a subject and OAuth client identity, expiry/not-before,
and exactly one non-empty value for each configured organization and
connection claim. Claim names are provider-neutral configuration; the initial
AuthCo deployment can provide namespaced DevRaftel claims.

Every tool requires `quickbooks.read`. Write/update tools additionally require
`quickbooks.write`; delete tools require `quickbooks.delete`. The tool registry
requires explicit `read`, `write`, or `delete` authority metadata and direct
`tools/call` authorization is enforced even if a tool is hidden from discovery.

## Mutation safety

Every mutation first returns MCP `input_required`. The request state is signed,
expires after ten minutes, and binds method, issuer, subject, client,
organization, connection, tool, and keyed input fingerprint. The durable
operation ledger records only metadata and atomically claims
`prepared → executing` before dispatch. Outcomes are `succeeded`, `failed`, or
`unknown`; an ambiguous operation must be reconciled before retrying.

The input fingerprint is a keyed HMAC with an explicit key version. Raw input,
output, credentials, and provider response bodies are not stored in ledger or
rate-limit records. Ledger unavailability blocks mutations. A declined
confirmation makes no lease or QuickBooks call.

## Files and errors

Remote tools accept bounded inline attachment/PDF bytes only. They do not
accept `file_path`, `output_path`, `overwrite`, or arbitrary server-side URL
fetches. Inline attachments and PDFs are capped at 2 MiB; larger artifacts
require a future private resource-link/object-store adapter.

Errors are redacted and contain no raw provider bodies, internal URLs, tokens,
stack traces, or database details. Logs and traces contain metadata-only
request identifiers and hashed principal identifiers.

## Configuration

Copy `.env.example`. Required values include:

- exact `MCP_RESOURCE_URI`, HTTPS host/origin allowlists, and MCP limits;
- OAuth issuer, metadata URL, and either JWKS or authenticated introspection;
- `MCP_AUTH_ORGANIZATION_CLAIM` and `MCP_AUTH_CONNECTION_CLAIM`;
- independent 32-byte request-state and operation-fingerprint keys;
- deployment-supplied lease, ledger, rate-limit, and workload-identity
  adapter references.

The runtime must not be configured with `DATABASE_URL`, an MCP encryption key,
deployment `QUICKBOOKS_CONNECTION_ID`, Intuit client credentials, a realm ID,
or an Intuit refresh token. Provider implementations may use their own
deployment configuration outside this repository.

## Deployment gates

Before customer traffic, verify build, lint, tests, MCP conformance, real
AuthCo issuance/revocation, authenticated workload identity, at least two MCP
replicas, a dedicated Intuit sandbox, concurrent lease acquisition, provider
timeouts, worker loss during reads and mutations, and operation reconciliation.

Focused unit tests prove the in-process seam and handler transformations; they
do not prove live provider authentication, multi-replica isolation, or
QuickBooks sandbox behavior. AuthCo CIMD/client-resource authorization and the
versioned connection-service contract remain external integration gates.
