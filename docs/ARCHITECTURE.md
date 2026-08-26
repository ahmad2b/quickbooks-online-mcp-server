# Architecture

The QuickBooks Online MCP Server is one stateless MCP `2026-07-28`
Streamable HTTP resource. It is a resource server and execution data plane;
it is not the organization database, OAuth token vault, or QuickBooks
connection control plane.

## Request execution

```text
MCP client
  │ HTTPS POST /mcp
  ▼
OAuth verifier ── exact resource/audience + issuer + expiry + scopes
  ▼
ClaimBindingAuthorizationPolicy
  │ one immutable organization + opaque QBO connection context
  ▼
tool registry ── explicit authority + schema validation
  │ read: lease now
  │ mutation: ledger prepare → MRTR confirmation → atomic claim
  ▼
QboClientFactory ── one short-lived execution lease
  │ fresh node-quickbooks client + bounded raw HTTP context
  ▼
QuickBooks Online
```

Authorization, rate limiting, and mutation ledger checks happen before any
connection-service lease request. A denied request or unconfirmed mutation
makes zero QuickBooks calls. The lease is checked for connection identity,
expiry safety margin, environment, and required fields before a client is
constructed. The client and token references are released after every call.

## Ownership boundaries

DevRaftel infrastructure owns organizations, membership, connection selection,
Intuit OAuth exchange, refresh-token storage/rotation, revocation, and
reauthorization. It injects implementations of the provider ports in
`src/runtime/contracts.ts`:

- `QboExecutionLeaseProvider` returns a short-lived access token, realm,
  environment, opaque connection ID, lease ID, credential version, and expiry;
- `OperationLedger` durably protects mutation confirmation, idempotency, and
  ambiguous outcomes;
- `RateLimiter` provides atomic shared authenticated limits.

The connection-service network protocol and workload-identity mechanism are
deliberately not selected in this repository. The MCP process never receives
or stores an Intuit refresh token or client secret and has no deployment-level
default company.

## Source layout

```text
src/
├── index.ts                         # HTTP-only executable
├── http-config.ts                   # fail-closed static configuration
├── http-server.ts                   # OAuth + MCP + readiness boundary
├── auth/                            # token verification and metadata
├── runtime/
│   ├── contracts.ts                 # provider ports and execution types
│   ├── authorization-policy.ts     # claim shape and single-value checks
│   ├── production-runtime.ts       # provider composition
├── clients/quickbooks-client.ts    # request-scoped lease/client factory
├── registry.ts                      # 142 explicit-authority definitions
├── tools/                           # Zod schemas + dependency-forwarding adapters
├── handlers/                        # QBO transformations and calls
└── helpers/register-tool.ts         # authorization, MRTR, ledger orchestration
```

## Execution context and handlers

`executionContextFromServerContext()` constructs a frozen context from
verified `AuthInfo` claims and OAuth scopes. Handlers receive
`QboHandlerDependencies` explicitly from the registered tool callback:

```typescript
type QboHandlerDependencies = Readonly<{
  execution: ExecutionContext;
  qbo: QuickBooks;
  rawQbo: QboRawClient;
}>;
```

Handlers do not read request headers, decode tokens, select companies, accept
realm IDs, or use tool-controlled credentials. Production registration always
supplies the explicit third argument; a handler invoked without it fails closed.

## Authority and scopes

Every registry definition declares exactly one authority: `read`, `write`, or
`delete`. Name prefixes remain only a consistency assertion and emergency
registration kill-switch classification. `materializeToolDefinition()` fails
closed when metadata is absent, unknown, or inconsistent. Public scopes remain
coarse and compositional: all tools require `quickbooks.read`, writes add
`quickbooks.write`, and deletes add `quickbooks.delete`.

## Mutation safety

The orchestration layer calculates a canonical keyed HMAC fingerprint and
stores only metadata in the injected ledger. MRTR request state binds method,
issuer, subject, client, organization, connection, tool, and fingerprint.
`prepared → executing` is an atomic claim before dispatch. A dispatch that
cannot be proven to have completed becomes `unknown`; it is never retried
automatically. Raw financial input/output is not persisted.

## Remote-safe files and errors

Attachment and PDF tools process only bounded inline bytes. They reject server
paths, arbitrary URL fetching, and overwrite controls. Error responses and
operational logs omit provider bodies, credentials, internal URLs, stacks, and
business payloads.

## Operational consequences

Moving tenancy and credentials to shared infrastructure removes the MCP
single-company database/bootstrap path, but it does not make the first
deployment simpler: a connection service, workload identity, durable ledger,
shared limiter, AuthCo grant contract, and live sandbox validation become
prerequisites. That trade-off is intentional because tenant ownership and
long-lived credential custody belong outside the MCP execution process.
