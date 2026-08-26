# QuickBooks Online MCP: Production Multi-Tenant Execution Specification

## Document metadata

- Status: Proposed; implementation pending
- Date: 2026-08-26
- Target protocol: MCP `2026-07-28`
- Canonical protected resource: `https://quickbooks-mcp.devraftel.com/mcp`
- Authorization server: DevRaftel AuthCo, configured through standard OAuth metadata
- Intended deployment model: horizontally scalable remote HTTPS service
- Compatibility policy: MCP `2026-07-28` only; no stdio or legacy MCP serving path
- Relationship to existing plan: supersedes the single-QuickBooks-company production-state model in the 2026-08-25 Streamable HTTP migration specification; retains its completed HTTP, OAuth resource-server, MRTR, and remote-filesystem decisions
- Primary architectural decision: DevRaftel owns multi-tenant identity, grants, QuickBooks connections, and long-lived credentials; the MCP server is a stateless, tenant-aware execution data plane that independently verifies and enforces each grant

## Executive decision

The proposed ownership boundary is accepted, with one essential qualification:

> Multi-tenancy must be owned by DevRaftel infrastructure, but it cannot be ignored by the MCP runtime.

The control plane is the source of truth for organizations, users, clients, QuickBooks connections, permissions, onboarding, revocation, and refresh tokens. The MCP runtime must still be incapable of crossing those boundaries. It therefore verifies the signed caller grant, obtains an execution lease for exactly one authorized QuickBooks connection, authorizes the requested tool, executes it with a request-scoped QuickBooks client, and retains no QuickBooks business payload.

The target is not a tenant database hidden inside the MCP server. The target is:

```text
DevRaftel control plane owns the truth
                ↓
AuthCo issues a resource- and connection-bound grant
                ↓
QuickBooks MCP verifies and enforces the grant
                ↓
DevRaftel connection service issues a short-lived execution lease
                ↓
QuickBooks MCP executes one authorized operation
```

This specification replaces the earlier draft at this path. That draft was directionally correct but described the pre-migration upstream as stdio/SDK v1, proposed optional legacy and stdio compatibility, and treated credential persistence and mutation-safety state as though they had the same owner. The current branch already serves MCP `2026-07-28` over stateless HTTP, rejects legacy requests, uses MRTR confirmation, and persists mutation safety state. This specification starts from that verified state.

## Problem Statement

The current branch is a secure single-connection remote MCP server, not yet a production multi-tenant service.

It already provides:

- MCP `2026-07-28` through the official TypeScript SDK v2 HTTP handler;
- one HTTPS MCP endpoint at `/mcp`;
- no stdio serving path;
- no MCP session or legacy HTTP/SSE path;
- OAuth protected-resource metadata and bearer-token verification;
- exact issuer and resource-audience validation;
- coarse QuickBooks scopes: `quickbooks.read`, `quickbooks.write`, and `quickbooks.delete`;
- a configurable signed organization-binding claim;
- durable rate limiting;
- MRTR confirmation for financial mutations;
- a durable operation ledger that prevents blind replay after ambiguous outcomes;
- encrypted QuickBooks access/refresh-token storage and distributed refresh locking.

Its remaining single-tenant assumptions are:

- one deployment-wide `QUICKBOOKS_CONNECTION_ID`;
- one process-configured QuickBooks client singleton;
- handlers resolving that singleton through static methods;
- the MCP database owning QuickBooks realm IDs and refresh tokens;
- the MCP runtime owning Intuit refresh-token rotation;
- an allow-list of organization claim values configured per deployment;
- a mutation ledger whose connection identifier is taken from deployment configuration rather than a per-request signed grant.

Adding multiple rows to the existing database would not, by itself, create a safe multi-tenant server. The security question is not whether the database can store several connections. It is whether every request has one unforgeable path:

```text
validated MCP token
  → trusted organization
  → trusted QuickBooks connection grant
  → authorized tool
  → matching temporary Intuit access context
  → exactly one QuickBooks realm
```

Any fallback, model-controlled identifier, mutable global client, or independently repeated tenant lookup can break that chain.

## Solution

### Architectural boundary

DevRaftel will split responsibilities into three trust domains.

#### AuthCo

AuthCo owns:

- end-user authentication;
- OAuth consent and client interoperability;
- organization selection;
- QuickBooks connection selection through a trusted control-plane lookup;
- issuance of short-lived access tokens for the exact MCP resource;
- signed caller, organization, client, scope, and connection-grant claims;
- token expiry and revocation behavior.

#### DevRaftel control plane and connection service

The DevRaftel control plane owns:

- organizations and memberships;
- user-to-organization authority;
- QuickBooks connection records;
- mapping opaque connection IDs to Intuit realm IDs;
- Intuit OAuth onboarding and callback handling;
- Intuit client credentials and refresh tokens;
- refresh-token rotation and connection status;
- validation that the caller grant may use the requested connection;
- issuance of short-lived execution leases to the MCP workload;
- connection revocation and reauthorization workflows;
- durable mutation-operation state through a platform execution-ledger implementation;
- platform rate-limit policy and shared rate-limit infrastructure.

#### QuickBooks MCP execution data plane

The MCP runtime owns:

- MCP `2026-07-28` protocol behavior;
- protected-resource metadata and OAuth challenges;
- access-token signature/introspection, issuer, audience, expiry, subject, client, scope, and required-claim validation;
- creation of an immutable request execution context;
- independent enforcement of the token grant and tool authority;
- acquisition and validation of one short-lived QuickBooks execution lease;
- creation of a request-scoped QuickBooks client;
- execution of existing QuickBooks tool logic;
- MRTR mutation confirmation;
- durable mutation idempotency and ambiguous-outcome handling through an injected execution-ledger port;
- safe output conversion, redaction, and ephemeral payload processing.

The MCP runtime does not own organization records, connection records, Intuit refresh tokens, or the permission database.

### Target request flow

```text
MCP client
  │
  │ Authorization: Bearer <AuthCo access token>
  │ resource = https://quickbooks-mcp.devraftel.com/mcp
  ▼
QuickBooks MCP HTTP boundary
  │
  ├─ validate MCP protocol headers/body
  ├─ validate token issuer/audience/time/client/subject
  ├─ read signed organization and connection grant
  ├─ enforce quickbooks.read/write/delete scope
  └─ build immutable ExecutionContext
  │
  ▼
Tool authorization boundary
  │
  ├─ resolve registered tool
  ├─ enforce explicit authority metadata
  ├─ apply mutation confirmation/ledger rules
  └─ deny before any credential or QBO call
  │
  ▼
QboExecutionLeaseProvider
  │ authenticated with workload identity
  ▼
DevRaftel connection service
  │
  ├─ revalidate organization/connection/grant relationship
  ├─ reject disabled or reauthorization-required connection
  ├─ refresh Intuit token under distributed lock when needed
  └─ return the minimum short-lived access context
  │
  ▼
Request-scoped QuickBooks client
  │
  ▼
QuickBooks Online
  │
  ▼
Ephemeral result → sanitized MCP response
```

### Non-negotiable invariants

1. No model-controlled tenant. Organization, connection, realm, and credentials must not be tool arguments.
2. No deployment-default QuickBooks connection. A missing connection grant fails closed.
3. One grant, one connection. A single MCP access token authorizes at most one QuickBooks connection.
4. No refresh token in the MCP runtime. The runtime must not receive, persist, rotate, log, or bootstrap Intuit refresh tokens.
5. No Intuit client secret in the MCP runtime. Token refresh and OAuth exchange belong to the connection service.
6. Request-scoped QuickBooks clients only. No mutable process-global realm, token, or QuickBooks SDK instance.
7. Authorization before effects. A denied call makes zero connection-service lease calls and zero QuickBooks calls.
8. Double enforcement. AuthCo signs the grant; the connection service revalidates ownership; the MCP runtime verifies and enforces the result.
9. No credential fallback. Broker outage, invalid lease, token expiry, or connection mismatch must never fall back to environment credentials or another connection.
10. Stateless protocol. No `Mcp-Session-Id`, sticky session, initialization handshake, or session-to-tenant mapping.
11. Durable financial safety. Removing credential storage from MCP must not remove MRTR confirmation, operation idempotency, or ambiguous-outcome reconciliation.
12. No persistent QuickBooks payloads. Business inputs and results may exist transiently in memory but must not be stored in logs, databases, caches, traces, or crash reports.
13. Internal service authentication. Private networking alone is insufficient; the connection and execution-ledger services must authenticate the MCP workload.
14. Exact resource binding. Only tokens issued for `https://quickbooks-mcp.devraftel.com/mcp` are accepted.
15. No compatibility escape hatch. The production entrypoint supports only MCP `2026-07-28` over HTTPS.

## User Stories

1. As a DevRaftel organization member, I want to authorize a compatible MCP client for one QuickBooks connection, so that the client cannot switch to another company without a new grant.
2. As a user belonging to multiple organizations, I want AuthCo to require explicit organization and QuickBooks connection selection, so that an old active organization is not silently reused.
3. As an organization administrator, I want connection access to be controlled by DevRaftel, so that revoking a connection or membership stops future MCP execution.
4. As an MCP client, I want standard OAuth protected-resource discovery, so that I can connect without DevRaftel-specific client code.
5. As an MCP client, I want tokens scoped to read, write, or delete authority, so that I can request the minimum necessary access.
6. As a finance operator, I want writes and deletes to require explicit MRTR confirmation, so that an agent cannot silently commit a financial mutation.
7. As a finance operator, I want ambiguous mutation outcomes recorded durably, so that a network or worker failure does not cause a blind duplicate retry.
8. As a platform operator, I want the MCP workload to hold only short-lived Intuit access tokens, so that compromising one worker does not expose long-lived refresh authority.
9. As a platform operator, I want every QBO client constructed per request, so that concurrent tenants cannot share mutable credentials.
10. As a security reviewer, I want tenant and connection identifiers derived only from verified claims and trusted services, so that headers and tool arguments cannot cross tenant boundaries.
11. As a security reviewer, I want every denied request to make zero downstream calls, so that authorization is demonstrably before execution.
12. As a privacy reviewer, I want QuickBooks business payloads processed ephemerally, so that the MCP layer does not become a shadow accounting database.
13. As an incident responder, I want global write/update/delete kill switches, so that risky categories can be disabled without changing tenant grants.
14. As an operator, I want structured metadata-only logs, so that I can diagnose latency and failures without storing invoices, customer names, account numbers, or credentials.
15. As an operator, I want any request to run on any healthy replica, so that the service can scale without sticky sessions.
16. As a developer, I want QuickBooks business handlers to receive explicit execution dependencies, so that tenant isolation is visible and testable.
17. As a developer, I want the existing QuickBooks transformations and schemas preserved, so that the tenancy migration does not unnecessarily rewrite business behavior.
18. As a connection owner, I want a stable reauthorization error when Intuit revokes access, so that I am routed back to DevRaftel rather than a local OAuth server.
19. As an auditor, I want an opaque operation record tied to organization, connection, principal, tool, and a keyed input fingerprint, so that financial execution can be reconciled without retaining the financial payload.
20. As a client user, I want remote-safe attachment and PDF behavior, so that server filesystem paths are never mistaken for my local files.

## Implementation Decisions

### 1. Preserve the current MCP protocol implementation

The migration is not another transport rewrite.

The current production entrypoint must retain:

- `createMcpHandler` from the official TypeScript SDK v2;
- `legacy: "reject"`;
- JSON response mode;
- POST-only `/mcp` serving;
- required `MCP-Protocol-Version`, `Mcp-Method`, and applicable `Mcp-Name` validation;
- no `initialize`/`initialized` exchange;
- no `Mcp-Session-Id`;
- MRTR `input_required` mutation confirmation;
- OAuth protected-resource metadata;
- HTTP `401` and `403` authorization behavior.

This spec does not restore stdio, legacy protocol versions, general GET event streams, or HTTP+SSE.

### 2. Keep one canonical resource identity

The protected resource and required token audience are exactly:

```text
https://quickbooks-mcp.devraftel.com/mcp
```

AuthCo authorization and token requests must receive this exact value through the OAuth `resource` parameter. The MCP server must reject tokens issued for the domain root, another DevRaftel API, an HTTP URL, or another path.

### 3. Use a signed, connection-bound AuthCo grant

Every accepted access token must provide these semantics:

```text
issuer
subject
OAuth client identity
audience/resource
scope
organization identifier
opaque QuickBooks connection identifier
expiry/not-before
```

Recommended namespaced custom claims are:

```text
https://devraftel.com/organization_id
https://devraftel.com/qbo_connection_id
```

The exact claim names remain deployment configuration in the MCP package so the resource server stays authorization-vendor neutral. The initial AuthCo deployment supplies the namespaced DevRaftel values.

The connection claim contains an opaque DevRaftel identifier, not an Intuit realm ID. It must be selected through trusted AuthCo/control-plane interaction during consent. Query parameters, client metadata, browser form fields, or model arguments are never trusted directly; AuthCo must validate the selected connection against the authenticated user's current organization membership and control-plane authority before signing it.

### 4. Keep public OAuth scopes intentionally coarse

The public MCP scopes remain:

```text
quickbooks.read
quickbooks.write
quickbooks.delete
```

Scope composition is explicit: every tool requires `quickbooks.read`; write tools additionally require `quickbooks.write`; delete tools additionally require `quickbooks.delete`. This preserves the current server contract and prevents a write/delete grant from becoming a separate discovery-blind capability.

This is the smallest stable authorization vocabulary matching the existing tool surface. The implementation must not invent a 144-permission public taxonomy before a product requirement exists.

Tool definitions still require explicit authority metadata. Name prefixes may be used as a migration assertion and global kill-switch classification, but must not be the final security source of truth.

If DevRaftel later introduces finer internal agent permissions, the control plane may include a signed grant reference or return a policy decision. That extension must narrow the three public scopes, never broaden them.

### 5. Define one immutable execution context

After token verification and before tool dispatch, the server creates one immutable context with these semantics:

```typescript
type ExecutionContext = Readonly<{
  requestId: string;
  issuer: string;
  subjectId: string;
  oauthClientId: string;
  organizationId: string;
  qboConnectionId: string;
  scopes: ReadonlySet<
    "quickbooks.read" | "quickbooks.write" | "quickbooks.delete"
  >;
}>;
```

This type is a contract, not a claim that the final implementation must use these exact property names.

The context must be constructed once from verified authorization information. Handlers do not re-read raw headers, decode tokens, query organization state, or accept alternate context from inputs.

### 6. Introduce a single high-level execution seam

The primary test and dependency-injection seam is the registered tool execution boundary:

```text
verified ExecutionContext
  + RegisteredToolDefinition
  + validated tool input
  + ToolExecutionServices
```

The target orchestration dependency semantics are:

```typescript
type ToolExecutionServices = Readonly<{
  execution: ExecutionContext;
  qboClientFactory: QboClientFactory;
  operationLedger: OperationLedger;
}>;
```

The orchestration boundary performs authorization and, for mutations, confirmation/ledger claiming before it asks the client factory for a lease. Only then does it invoke the business handler with a request-scoped `qbo` and `rawQbo`. A denied call or a mutation awaiting confirmation acquires no lease.

Explicit dependency injection is the final design. `AsyncLocalStorage` may be used only as a short-lived mechanical migration bridge if necessary; it must not remain the authoritative security boundary because ambient context makes dependency review and isolation tests weaker.

### 7. Replace the global client with a request-scoped factory

The production runtime must remove:

- the exported process-global QuickBooks client;
- static `getInstance()` resolution;
- static `getAuthCredentials()` resolution;
- process-level access/refresh tokens;
- process-level realm ID;
- deployment-level default connection ID.

Introduce a request-scoped factory with these semantics:

```typescript
interface QboClientFactory {
  create(context: ExecutionContext): Promise<QboClientLease>;
}

interface QboClientLease {
  qbo: QuickBooks;
  rawQbo: QboRawClient;
  leaseId: string;
  expiresAt: Date;
  close(): Promise<void>;
}
```

The factory obtains one execution lease, verifies that its opaque connection identity matches the signed request context, verifies its expiry and environment, constructs the client, and releases all references after the tool call.

No QuickBooks SDK client is cached globally. A future cache requires a separate security review and must be keyed by connection ID, credential version, and environment with expiry before token expiration.

### 8. Move Intuit credential ownership to a connection service

The MCP package defines a provider port:

```typescript
interface QboExecutionLeaseProvider {
  acquire(context: ExecutionContext): Promise<QboExecutionLease>;
}

interface QboExecutionLease {
  leaseId: string;
  qboConnectionId: string;
  accessToken: string;
  realmId: string;
  environment: "sandbox" | "production";
  expiresAt: Date;
  credentialVersion: string;
}
```

The network protocol and storage implementation belong to DevRaftel infrastructure, not this MCP repository. Whatever adapter is selected must provide the same semantics and use authenticated workload identity.

The connection service must:

- authenticate the QuickBooks MCP workload;
- accept the verified caller/grant context from that workload;
- revalidate that the organization owns the connection;
- revalidate current organization membership, connection ownership, and grant usability for every lease;
- reject disabled, disconnected, or reauthorization-required connections;
- refresh and durably rotate Intuit credentials under a per-connection distributed lock;
- return only the minimum access context;
- never return a refresh token;
- emit metadata-only security/audit events.

The MCP runtime must reject a lease when:

- the returned connection ID differs from the signed connection claim;
- the lease is expired or inside the configured safety margin;
- the environment is invalid;
- any required field is missing;
- the service response cannot be authenticated;
- the provider is unavailable.

It must never retry using a different connection.

Revocation has a bounded race: an operation that already received a valid lease may finish after the underlying grant is revoked. The connection service must minimize that window through short leases and per-lease revalidation. Immediate cancellation of an already-dispatched QuickBooks mutation is not promised because cancellation cannot reliably undo an upstream commit.

### 9. Acknowledge the access-token exposure boundary

Under this version, the MCP worker receives a short-lived Intuit access token because it executes the QuickBooks API call. Therefore the defensible security claim is:

> The MCP runtime has transient access to a short-lived Intuit access token and QuickBooks response data, but never possesses Intuit refresh tokens or persistent QuickBooks business data.

It is not defensible to claim that the MCP runtime never sees QuickBooks credentials or plaintext data.

A future stronger design could place all QuickBooks HTTP execution behind a constrained QBO gateway so the MCP worker receives neither token. That would substantially expand the internal API surface and duplicate QBO request semantics, so it is explicitly deferred.

### 10. Separate credential state from execution-safety state

The existing PostgreSQL runtime combines three unrelated concerns:

1. QuickBooks connection/token storage;
2. shared rate limiting;
3. financial mutation operation state.

The multi-tenant migration separates them.

#### Connection/token storage

Moves entirely to the DevRaftel connection service. The MCP runtime no longer owns the `quickbooks_connections` schema, encryption key, bootstrap credentials, refresh locks, or reauthorization status.

#### Rate limiting

Coarse unauthenticated protection belongs at the edge. Authenticated limits should use trusted organization, client, connection, tool, and authority identifiers through a shared platform limiter. The MCP package consumes a limiter port; it does not own tenant policy or require a local database table.

#### Mutation operation ledger

Must remain durable and close to the execution pipeline, but its storage is supplied by DevRaftel infrastructure through an injected port. Removing token storage must not reduce mutation safety.

### 11. Preserve and generalize the mutation ledger

The operation record must contain only metadata required for safety:

```text
operation ID
organization ID or non-reversible organization reference
opaque QuickBooks connection ID
non-reversible principal reference
tool name
authority class
keyed canonical input fingerprint and key version
status
timestamps
```

Allowed statuses remain:

```text
prepared → executing → succeeded | failed | unknown
```

Required behavior:

- create the operation before requesting confirmation;
- calculate the input fingerprint with a keyed HMAC over canonical input, not an unsalted hash, so low-entropy financial fields cannot be guessed through an offline dictionary attack;
- bind MRTR request state to issuer, subject, client, organization, connection, method, tool, and input fingerprint;
- atomically claim `prepared → executing` before dispatch;
- record `unknown` when execution began but commit outcome cannot be proven;
- prevent equivalent unresolved operations for the same organization, connection, principal, tool, and input fingerprint;
- require reconciliation before retrying an `unknown` operation;
- never store raw input or output.

Fingerprint key rotation must retain a key version and a controlled overlap strategy so unresolved operations remain detectable during rotation without keeping old keys indefinitely.

The control plane may expose reconciliation UI and operator actions. The MCP runtime enforces the ledger result but does not own that UI.

### 12. Require explicit tool authority metadata

Every registered tool must declare exactly one authority class:

```text
read
write
delete
```

The registry must fail closed at startup if authority is absent, unknown, or inconsistent with a temporary migration assertion.

Global environment switches may continue to disable write/update/delete categories during incidents. They are deployment-wide brakes, not tenant authorization.

Filtering `tools/list` by authority is optional UX. Direct `tools/call` authorization remains mandatory even if a tool was hidden.

### 13. Preserve remote-safe file behavior

The current remote schemas already remove server-path and arbitrary server-side URL semantics. Preserve that decision.

Production tools must not accept:

```text
file_path
output_path
overwrite
arbitrary file_url fetching
```

Small attachment and PDF payloads may be processed inline within explicit size limits. Larger files require a future private object-store/resource-link design and are outside this migration.

### 14. Enforce ephemeral payload processing

The MCP runtime may retain operational metadata, but not QuickBooks business payloads.

Allowed durable metadata includes:

- request/operation ID;
- timestamp and duration;
- hashed or opaque organization/principal identifiers;
- opaque connection identifier;
- OAuth client identifier when operationally required;
- tool name and authority;
- outcome/error category;
- upstream HTTP status category;
- byte counts.

Forbidden durable data includes:

- tool arguments or results;
- raw QuickBooks request/response bodies;
- customer, vendor, employee, account, invoice, bill, payment, or report data;
- PDFs and attachments;
- MCP bearer tokens;
- Intuit access or refresh tokens;
- Intuit client secrets;
- authorization codes;
- realm IDs unless a narrowly justified operational system requires them.

Logging, tracing, WAF, reverse proxy, APM, error reporting, and crash capture must all follow the same rule. Application-only redaction is insufficient if infrastructure records bodies or authorization headers.

### 15. Use a stable safe error taxonomy

Pre-MCP authentication failures use appropriate HTTP `401` or `403` responses and OAuth challenges.

Authorized tool execution uses safe application errors, including:

```text
MCP_TOOL_NOT_AUTHORIZED
QBO_CONNECTION_NOT_FOUND
QBO_CONNECTION_REAUTH_REQUIRED
QBO_EXECUTION_LEASE_UNAVAILABLE
QBO_EXECUTION_LEASE_INVALID
QBO_UPSTREAM_RATE_LIMITED
QBO_UPSTREAM_UNAVAILABLE
QBO_VALIDATION_ERROR
QBO_ENTITY_NOT_FOUND
QBO_PERMISSION_DENIED
QBO_OPERATION_OUTCOME_UNKNOWN
```

No error response includes raw provider bodies, internal URLs, tokens, stack traces, or database details.

### 16. Make internal dependencies fail closed

The MCP runtime must not start accepting tool traffic until required provider adapters are configured and readiness checks pass.

During request execution:

- connection-service timeout/unavailability fails the call;
- execution-ledger timeout/unavailability blocks mutations;
- shared limiter failure fails execution closed; the edge limiter remains an independent outer protection;
- invalid AuthCo metadata or token verification fails authorization;
- no failure path invokes QuickBooks using cached/default credentials.

Liveness must not depend on customer systems. Readiness may test non-customer-specific connectivity to required internal services without acquiring a QuickBooks lease.

### 17. Remove obsolete MCP-owned configuration

After cutover, the production MCP runtime must not require:

```text
DATABASE_URL
MCP_DATA_ENCRYPTION_KEY
QUICKBOOKS_CONNECTION_ID
QUICKBOOKS_CLIENT_ID
QUICKBOOKS_CLIENT_SECRET
QUICKBOOKS_ENVIRONMENT
QUICKBOOKS_REALM_ID
QUICKBOOKS_REFRESH_TOKEN
```

It will require provider-neutral configuration for:

```text
MCP_RESOURCE_URI
MCP_ALLOWED_HOSTS
MCP_ALLOWED_ORIGINS
MCP_AUTH_ISSUER
MCP_AUTH_METADATA_URL
MCP_AUTH_JWKS_URL or introspection configuration
MCP_AUTH_ORGANIZATION_CLAIM
MCP_AUTH_CONNECTION_CLAIM
MCP_REQUEST_STATE_KEY or an injected request-state signer
QBO_EXECUTION_LEASE_PROVIDER configuration
OPERATION_LEDGER_PROVIDER configuration
RATE_LIMIT_PROVIDER configuration
workload-identity configuration
```

Secrets remain deployment configuration and must not be committed.

### 18. AuthCo integration requirements

AuthCo must register the exact MCP resource with the three QuickBooks scopes and continue standard protected-resource interoperability.

For a QuickBooks grant, AuthCo must:

1. authenticate the user;
2. validate current organization membership;
3. require organization selection when more than one is available;
4. retrieve authorized QuickBooks connections from a trusted control-plane interface;
5. require selection of exactly one connection;
6. revalidate that selection server-side;
7. bind the organization and opaque connection identifier into the authorization grant;
8. issue an access token whose audience is the exact MCP resource;
9. include only approved QuickBooks scopes;
10. support revocation and short access-token lifetime.

OAuth client interoperability remains vendor neutral. AuthCo's CIMD support is used for compatible public clients; explicitly pre-registered clients may be supported where a client lacks CIMD. No single hard-coded MCP client may be used as evidence of universal interoperability.

### 19. Connection-service contract requirements

Before MCP implementation begins, the DevRaftel infrastructure work must provide a versioned execution-lease contract meeting the semantics in this spec.

The contract must define:

- workload authentication method;
- request authentication and replay resistance;
- request and response schemas;
- timeout and retry behavior;
- connection ownership validation;
- token refresh and rotation guarantees;
- lease expiry safety margin;
- status/error taxonomy;
- audit metadata;
- service availability target;
- behavior during revocation races.

If the connection service uses a persisted authorization-grant record for real-time revocation, AuthCo must include an opaque signed grant identifier or token identifier that the service can resolve. The MCP client never supplies or interprets that identifier; it is carried only in the verified token context.

Transport choice such as internal HTTPS, mTLS, or cloud-native RPC is intentionally not selected in this repository. The MCP package depends on the port, while the deployment supplies one reviewed adapter.

### 20. Migration sequence

#### Phase 0 — Freeze and verify the current baseline

- Record the current tool registry and existing behavioral test results.
- Run build, lint, tests, and MCP `2026-07-28` conformance.
- Record current remote-safe file schemas and mutation behavior.
- Do not change business transformations during the tenancy refactor.

Exit gate: current single-connection behavior is reproducibly green.

#### Phase 1 — Build control-plane prerequisites

- Add the QuickBooks MCP resource and scopes to AuthCo.
- Implement trusted organization and connection selection.
- Add the signed organization and connection claims.
- Build the connection-service execution-lease contract and adapter.
- Move Intuit onboarding, refresh-token storage, rotation, and reauthorization status to that service.
- Provide workload authentication.
- Provide an execution-ledger implementation and shared limiter adapter.

Exit gate: a test principal can obtain a resource-bound AuthCo token and the MCP test workload can acquire a matching short-lived sandbox lease without receiving a refresh token.

#### Phase 2 — Introduce request execution context

- Parse the configured organization and connection claims after token verification.
- Build the immutable execution context once.
- Reject missing, malformed, multiple, or mismatched connection grants.
- Bind MRTR request state to organization and connection.

Exit gate: forged headers, arguments, and wrong-audience tokens cannot affect context and cause zero downstream calls.

#### Phase 3 — Introduce execution-lease and client-factory ports

- Add the provider interfaces.
- Validate lease identity, expiry, environment, and response authenticity.
- Construct request-scoped SDK and raw HTTP clients.
- Ensure disposal after success, failure, timeout, and cancellation.

Exit gate: concurrent test tenants always receive their own realm/token and no process-global client is used.

#### Phase 4 — Migrate handlers through the single execution seam

- Pass explicit tool execution services from registration to handlers.
- Remove static QuickBooks client calls mechanically.
- Preserve schemas, transformations, and output behavior unless separately specified.
- Make authority metadata mandatory.

Exit gate: prohibited static/global access patterns are absent from the production dependency graph and existing handler behavior remains green.

#### Phase 5 — Separate durable state providers

- Remove MCP-owned connection/token persistence.
- Move rate-limit policy/storage to the injected platform provider.
- Generalize the mutation ledger to organization and per-request connection.
- Preserve all MRTR and ambiguous-outcome rules.

Exit gate: the MCP runtime can start with no Intuit refresh token, Intuit client secret, deployment connection ID, or MCP-owned connection table.

#### Phase 6 — Remove old code without compatibility fallback

- Delete the process-global client configuration path.
- Delete MCP token bootstrap and refresh rotation.
- Delete obsolete connection schema and encryption code from this repository.
- Delete obsolete environment variables and documentation.
- Add CI scans for prohibited patterns.
- Do not keep stdio or a single-tenant production mode.

Exit gate: there is one production execution architecture.

#### Phase 7 — Adversarial and live sandbox validation

- Run cross-tenant concurrency tests.
- Run live AuthCo authorization.
- Run official MCP conformance.
- Run real QuickBooks sandbox reads and confirmed mutations.
- Exercise revocation, refresh, worker death, broker outage, and ambiguous outcomes.

Exit gate: every definition-of-done condition passes with evidence.

### 21. Cutover policy

The new multi-tenant path must not silently fall back to the old connection store.

Safe rollout may use:

- isolated test environments;
- a dedicated QuickBooks sandbox connection;
- one internal organization first;
- read-only live verification before mutations;
- explicit traffic enablement after readiness.

It must not use:

- dual credential resolution where one path falls back to environment/database credentials;
- per-request flags allowing callers to choose old versus new behavior;
- automatic retries against a different connection;
- production accounting data before sandbox adversarial tests pass.

Rollback means routing traffic back to the last independently deployed safe service version, not enabling the deleted legacy credential path inside the new runtime.

## Testing Decisions

### Primary seam

The highest-value seam is an authenticated MCP `tools/call` request driven through the in-process HTTP handler with injected fake AuthCo verification, execution-lease provider, operation ledger, limiter, and QuickBooks transport.

Tests assert external behavior and downstream effects:

```text
HTTP/MCP request
  → authorization result
  → lease request or no request
  → QBO call or no call
  → MCP result
  → operation-ledger transitions
```

This seam is preferred over testing every internal helper independently. Existing handler tests remain useful for QuickBooks transformation behavior.

### Contract tests

The execution-lease adapter must have consumer-driven contract tests covering:

- valid lease;
- wrong connection ID;
- wrong organization ownership;
- expired/near-expiry lease;
- sandbox/production mismatch;
- connection disabled;
- reauthorization required;
- service authentication failure;
- timeout/unavailability;
- malformed response;
- revocation race;
- concurrent refresh returning one durable credential version.

### Mandatory authorization and isolation cases

1. Tenant A and Tenant B execute concurrently and each QBO request receives only its expected realm/token.
2. A valid token for another DevRaftel resource returns `401` and causes zero lease/QBO calls.
3. A token missing organization or connection claim fails closed.
4. A forged `X-Tenant-ID`, `X-Realm-ID`, or `X-QBO-Connection-ID` cannot affect execution.
5. Tool arguments containing tenant, connection, realm, access token, or refresh token are rejected as unsupported.
6. A signed organization A plus connection B mismatch is rejected by the connection service and produces zero QBO calls.
7. A lease response for a different connection is rejected by MCP even if the service call succeeded.
8. A read-only token cannot execute write or delete tools.
9. A hidden tool invoked directly is still authorized and denied independently.
10. Broker outage fails closed with no default credential path.
11. Expired or near-expiry leases are not used.
12. No request retries another connection after QBO `401` or `403`.
13. Thousands of mixed concurrent calls preserve request → organization → connection → realm mapping.
14. Sequential calls from one client may land on different replicas with identical behavior.

### Mandatory mutation cases

1. A mutation first returns MRTR `input_required` and makes zero lease or QBO calls.
2. Confirmation is bound to caller, client, organization, connection, tool, method, and keyed input fingerprint.
3. Reusing confirmation state under another organization or connection fails.
4. Declined confirmation transitions the operation to `failed` and makes zero QBO calls.
5. Accepted confirmation atomically claims the operation before dispatch.
6. Duplicate unresolved input is blocked.
7. Worker loss after dispatch produces `unknown`, never an automatic retry.
8. Reconciliation can transition an `unknown` operation only through an authorized operator path.
9. Ledger unavailability blocks mutations.

### Mandatory privacy and observability cases

Seed recognizable synthetic values representing:

```text
access token
refresh token
customer name
account number
invoice memo
attachment bytes
```

Exercise success, provider error, validation error, timeout, cancellation, and crash paths. Assert those values are absent from:

- application logs;
- stdout/stderr;
- traces and span attributes;
- error-reporting payloads;
- reverse-proxy/access logs;
- operation records;
- rate-limit records;
- temporary and persistent files.

### Protocol and interoperability cases

- Official MCP conformance requirements for `2026-07-28` pass.
- Legacy protocol requests are rejected.
- Missing or mismatched `Mcp-Method`/`Mcp-Name` is rejected.
- Protected-resource metadata advertises the exact resource and AuthCo issuer.
- Missing/invalid bearer token returns HTTP `401` with a usable challenge.
- Insufficient scope returns the required authorization response.
- At least one CIMD-compatible client completes authorization.
- Any explicitly pre-registered compatibility client is tested separately and not generalized as universal support.
- MRTR-capable clients can confirm mutations; non-MRTR clients are not advertised as mutation compatible.

### Live infrastructure cases

Focused unit tests do not prove production isolation. Before production QuickBooks traffic, run:

- two or more MCP replicas;
- managed control-plane/connection-service storage;
- real workload identity;
- real AuthCo issuance and revocation;
- a dedicated Intuit sandbox company;
- concurrent lease acquisition and token refresh;
- worker termination during reads and mutations;
- network partition/timeout simulations;
- operation reconciliation;
- deployment health and graceful shutdown.

## Definition of Done

The migration is complete only when all statements below are evidenced:

- The public endpoint serves only MCP `2026-07-28` over HTTPS.
- Every request validates an access token for the exact MCP resource.
- Every request has one signed organization and one opaque QuickBooks connection grant.
- The model/client cannot select organization, connection, realm, environment, or credentials through tool input or untrusted headers.
- AuthCo and the connection service both validate the organization/connection relationship.
- The MCP runtime contains no Intuit refresh token or Intuit client secret.
- The MCP runtime does not own QuickBooks connection/token storage or refresh rotation.
- No process-global QuickBooks client, realm, or access token exists.
- Every QBO client is created for one authorized execution context.
- Denied calls create zero lease requests and zero QuickBooks calls.
- Every tool has explicit authority metadata and direct calls are enforced.
- MRTR confirmation and durable ambiguous-outcome protection remain intact.
- Operation state is tenant- and connection-bound without retaining payloads.
- Logs, traces, errors, and storage contain no QuickBooks business payload or credentials.
- Remote file tools cannot access server paths or arbitrary URLs.
- Connection-service and ledger calls authenticate the MCP workload.
- Broker/ledger/auth failures fail closed with no credential fallback.
- Concurrent multi-tenant and multi-replica adversarial tests pass.
- Official MCP conformance and live QuickBooks sandbox tests pass.
- Production onboarding begins only after the sandbox evidence is reviewed.

## Out of Scope

This specification does not define:

- DevRaftel organization, membership, or invitation database schemas;
- the end-user dashboard;
- billing and subscription policy;
- the Intuit onboarding UI or callback route implementation;
- refresh-token vault schema and encryption implementation;
- the internal connection-service network protocol;
- provider-specific deployment manifests;
- a fine-grained 144-tool permission product;
- multi-company aggregation within one MCP grant;
- QuickBooks payload caching or analytics storage;
- a QBO API gateway that prevents MCP workers from seeing access tokens;
- customer-hosted execution or confidential computing;
- large-file object storage and resource-link delivery;
- retention/compliance policies outside the MCP execution boundary.

These require their own specifications or reviewed implementation contracts.

## Further Notes

### Deployment impact

This architecture simplifies the MCP workload after the DevRaftel platform dependencies exist. Each MCP replica becomes disposable and requires no customer-specific realm, refresh token, Intuit client secret, token-encryption key, connection bootstrap, or MCP-owned connection database. Any healthy replica can serve any authorized connection, so deployments no longer require one service per customer, sticky routing, or per-customer secret sets.

It does not make the first end-to-end deployment smaller. It moves security-critical complexity into shared infrastructure that must be deployed and operated first:

- AuthCo organization- and connection-bound grants;
- a QuickBooks connection/token service and durable credential store;
- workload identity between MCP and internal services;
- an execution-ledger provider;
- a shared authenticated rate limiter;
- private service networking, monitoring, backups, and recovery.

The operational tradeoff is therefore:

```text
Single-company prototype:
current self-contained MCP deployment is simpler

Production multi-tenant platform:
shared DevRaftel infrastructure is more complex once,
then every MCP replica and every new customer is simpler and safer
```

The expected deployment unit after migration is one generic MCP image plus environment-specific endpoints and workload identity. Customer onboarding changes control-plane records and grants; it does not deploy or reconfigure an MCP server.

### Why this is still tenant-aware

Moving multi-tenant ownership out of MCP does not mean trusting the control plane blindly or removing tenant checks. A resource server is a security enforcement point. It must know enough trusted context to prove that the operation it executes matches the signed grant and the lease it receives.

The correct distinction is:

```text
Control plane: owns and decides tenant truth
MCP data plane: verifies and enforces the decision
```

### Why mutation state remains

Protocol statelessness means the transport has no hidden client session. It does not mean financial execution can forget whether a write may have committed. The operation ledger is explicit application safety state and is compatible with MCP `2026-07-28`.

### Why this improves the current architecture

This boundary provides:

- one horizontally scalable MCP deployment instead of one deployment per customer;
- removal of long-lived QuickBooks refresh authority from the internet-facing MCP worker;
- centralized onboarding, revocation, and token rotation;
- independently testable tenant isolation;
- simpler disaster recovery for credential ownership;
- provider-neutral MCP OAuth behavior;
- preserved protocol compliance and mutation safety;
- a smaller, reviewable MCP responsibility surface.

It also adds a dependency on the connection service. That service becomes security- and availability-critical and must be designed and operated accordingly.

### Authoritative protocol references

- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [TypeScript SDK support for MCP 2026-07-28](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)
- [MCP `2026-07-28` authorization requirements](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)

### Final principle

> DevRaftel owns multi-tenancy. AuthCo expresses one authorized connection grant. The connection service owns long-lived QuickBooks credentials. The MCP runtime independently verifies the grant, executes exactly one authorized operation with a temporary access context, preserves financial safety, and forgets the business payload.
