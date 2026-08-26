# Production Streamable HTTP

The server exposes only modern MCP `2026-07-28` at `POST /mcp`. It has no
stdio serving path, initialization handshake, MCP session store, general GET
event stream, or legacy HTTP+SSE fallback. `legacy: "reject"` is configured in
the official TypeScript SDK v2 handler.

## Runtime model

Application instances are disposable. Managed PostgreSQL is the durable
authority for:

- encrypted QuickBooks access and refresh tokens;
- distributed refresh locking and atomic rotation;
- rate-limit buckets shared across instances;
- mutation confirmation/audit states.

Cold start validates schema and connection state but does not contact Intuit or
rotate credentials. The Node entry binds a listener and supports graceful
shutdown.

## Identity and authorization

The MCP authorization server and Intuit are separate trust domains. MCP bearer
tokens are never forwarded to QuickBooks. The runtime has no AuthCo-specific
defaults: issuer, metadata, verification endpoint, binding claim, and allowed
binding values are environment configuration. AuthCo can be supplied as the
initial deployment provider without coupling application code to it.

Token verification requires exact issuer, exact MCP resource audience,
signature or authenticated introspection, expiry/not-before, a distinct
subject, and an OAuth client identity. The configured binding claim maps that
caller to this deployment's one QuickBooks company. Scopes then authorize
actions:

- `quickbooks.read`
- `quickbooks.write`
- `quickbooks.delete`

An authorization-server outage during introspection is treated as temporary
service unavailability, not as proof that a valid token is invalid.

## Financial mutation safety

Every write/delete call first returns MCP `input_required` with a confirmation
form. Its request state is HMAC protected, expires after ten minutes, and is
bound to method, issuer, subject, and client. The server records an operation
UUID plus canonical input hash before confirmation and atomically claims it
before dispatch. Final states are `succeeded`, `failed`, or `unknown`.

The database permits only one unresolved operation for the same company,
caller, tool, and canonical input. On startup, expired unconfirmed records
become `failed`; stale dispatched records become `unknown`, so instance loss
cannot silently turn an uncertain QuickBooks commit into an automatic replay.

The application does not force-cancel a dispatched mutation when its HTTP
timeout elapses: cancellation cannot roll back QuickBooks and would encourage
an unsafe retry. An `unknown` outcome must be reconciled before retrying.

Reconciliation is an operator action in this release: inspect the QuickBooks
company using the operation's tool and input hash, then conditionally update
that operation from `unknown` to `succeeded` if it committed or `failed` if it
did not. Do not clear unresolved rows merely to make a retry possible.

## Files and payloads

Remote tools do not accept server paths or arbitrary server-side URL fetches.
The former `file_path`, `file_url`, `output_path`, and `overwrite` fields are
absent from strict schemas. Small attachment/PDF payloads are capped at 2 MiB
inline. Larger artifacts remain unavailable until a private object-store
adapter is chosen; that future adapter should return MCP `resource_link`
content instead of local paths or oversized JSON.

## Configuration and first provision

Copy `.env.example` and provide every required value. Generate independent
32-byte base64 encryption/request-state keys. On the first deployment only,
provide `QUICKBOOKS_ENVIRONMENT`, `QUICKBOOKS_REALM_ID`, and
`QUICKBOOKS_REFRESH_TOKEN` together. Provisioning uses `INSERT ... ON CONFLICT
DO NOTHING`, so an old environment token can never overwrite a rotated database
token. Remove the bootstrap realm/token from deployment configuration after the
row exists.

The service creates its three runtime tables when initializing, so the database
role needs schema DDL permission for this version. A later controlled migration
pipeline may move those statements out of application startup without changing
the storage ports.

## Deployment boundary

The application is a platform-neutral Node HTTP service. A deployment platform
must preserve `/mcp` and the OAuth metadata routes, terminate public TLS, supply
the required environment variables, and provide PostgreSQL connectivity. A
coarse pre-auth rate limit belongs at the deployment edge; application rate
limits start after token verification so they can key on authenticated identity.

## Validation gates before production data

1. `npm run build`, `npm test`, and `npm run lint` pass.
2. The official MCP conformance suite passes against the deployed URL with
   requirements `2026-07-28`.
3. Auth tests cover correct audience, wrong audience, expiry, revocation,
   insufficient scopes, and company-binding mismatch.
4. A dedicated QuickBooks sandbox verifies refresh rotation across two
   concurrent instances and after one instance is terminated.
5. Read, confirmed mutation, declined mutation, and ambiguous mutation recovery
   are tested before connecting production accounting data.
