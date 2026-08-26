# QuickBooks Online MCP: Modern Streamable HTTP Migration Specification

- **Status:** Implementation in progress; live deployment/conformance validation pending
- **Date:** 2026-08-25
- **Target protocol:** MCP `2026-07-28` only
- **Target deployment model:** One configured QuickBooks company per deployment, with stateless compute and shared durable state
- **Transports after migration:** Streamable HTTP over HTTPS only; MCP stdio serving is removed
- **Authorization server:** Provider-neutral configuration; `https://auth.devraftel.com/api/auth` is the initial deployment value
- **Deployment resource URI:** Required configuration; final public value is intentionally deferred

## 2026-08-26 Production Hardening Addendum

This addendum supersedes earlier passages that retain stdio, use a writable
token file, assume one process/replica, or authorize callers by scope alone.
Those were temporary migration constraints and are not the production target.

### Revalidated protocol baseline

- The latest stable MCP revision remains `2026-07-28`.
- `@modelcontextprotocol/server` `2.0.0` is the stable TypeScript server SDK and
  its `createMcpHandler(..., { legacy: "reject" })` entry serves the
  `2026-07-28` protocol while rejecting the 2025 lifecycle.
- The endpoint remains stateless Streamable HTTP: a fresh MCP server is created
  per request; business state is never stored in the protocol server instance.
- Financial mutations use the revision's multi-round-trip `input_required`
  mechanism. Confirmation state is HMAC protected, expires after ten minutes,
  and is bound to method, issuer, subject, and OAuth client.

### Production state and trust boundaries

1. **PostgreSQL is durable authority.** `quickbooks_connections` stores the
   realm, environment, encrypted access/refresh tokens, expiries, version, and
   connection status. A 32-byte deployment key encrypts tokens with AES-256-GCM
   and connection/credential-specific associated data.
2. **Refresh is distributed.** A transaction-scoped PostgreSQL advisory lock is
   acquired per connection. The winner rereads current state, reuses a valid
   access token when possible, otherwise refreshes, and atomically persists
   both the access token and rotated refresh token before returning it.
3. **Caller authorization is provider neutral.** JWT or introspection preserves
   `iss`, `sub`, `client_id`/`azp`, and configured tenant claims separately. A
   deployment-configured claim/value binding maps authorized callers to the one
   QuickBooks company. OAuth scopes remain action permissions, not tenant
   isolation.
4. **Rate limits are shared.** Authenticated application limits use atomic
   PostgreSQL buckets keyed by issuer, subject, OAuth client, QuickBooks
   connection, and read/write/delete authority. A coarse unauthenticated limit
   remains the deployment edge/WAF's responsibility because invalid bearer
   tokens are rejected before application identity exists.
5. **Mutations are confirmation-gated and audited.** Each write/delete gets a
   durable operation UUID and input hash. The ledger records
   `prepared -> executing -> succeeded|failed|unknown`. Once dispatch begins,
   the application does not create a false retry signal by force-cancelling the
   HTTP request. An unknown outcome requires reconciliation before retry.
6. **Server filesystem semantics are removed.** Remote tools reject former
   `file_path`, `file_url`, `output_path`, and overwrite arguments. Small
   attachments/PDFs are bounded to 2 MiB inline. Larger files remain blocked
   until a private artifact-store adapter is selected and can return an MCP
   `resource_link`; no storage vendor is assumed by this change.
7. **Cold start is side-effect bounded.** Initialization validates configuration,
   authorization metadata, schema, encrypted connection state, and registry.
   It does not refresh QuickBooks tokens.
8. **Runtime is HTTP-only.** The executable no longer selects or serves stdio.
   Rollback means deploying the previous artifact, not maintaining two protocol
   paths in one release.
9. **Unresolved mutations cannot be replayed blindly.** PostgreSQL enforces one
   unresolved operation per company, caller, tool, and canonical input. Expired
   confirmations become `failed`; stale dispatched operations become `unknown`
   and remain blocked until reconciled.

### Required production configuration

- `DATABASE_URL`
- `MCP_DATA_ENCRYPTION_KEY` (base64, exactly 32 decoded bytes)
- `MCP_REQUEST_STATE_KEY` (base64, exactly 32 decoded bytes, shared by instances)
- `MCP_AUTH_BINDING_CLAIM`
- `MCP_AUTH_ALLOWED_BINDING_VALUES`
- `QUICKBOOKS_CONNECTION_ID`
- existing resource URI, authorization metadata/verifier, host/origin, and
  QuickBooks application client credentials

`QUICKBOOKS_REALM_ID`, `QUICKBOOKS_REFRESH_TOKEN`, and
`QUICKBOOKS_ENVIRONMENT` are accepted together only for an initial idempotent
database provision. Existing database state always wins; rotated credentials
are never overwritten by stale deployment environment values.

## Verified Current State

The following statements are repository or live-metadata facts, not design assumptions:

1. The server is a Node.js/TypeScript ESM package. Its manifest declares `@modelcontextprotocol/sdk` `^1.6.0`; the lockfile currently resolves v1.30.0. It uses Zod v3.
2. The only executable MCP entry point creates a singleton `McpServer`, registers tools, connects a `StdioServerTransport`, and exits on a top-level error.
3. Tool registration uses the v1 variadic `server.tool()` API and wraps each tool's schema under a synthetic `params` property. Tool callbacks consequently receive `{ params: ... }` rather than the modern direct input shape.
4. The active registry contains exactly 142 unique tools: 71 read operations, 51 create/update operations, and 20 delete operations. Every active tool definition is registered exactly once.
5. Documentation is stale: the architecture document reports 143 tools and the README reports 145. Neither number is an acceptable migration baseline.
6. The MCP server exposes tools only. It does not implement prompts, resources, tasks, subscriptions, roots, sampling, elicitation, or MCP logging.
7. QuickBooks authority is process-global. One module-level QuickBooks client loads one client ID, client secret, realm ID, refresh token, environment, and token-store path. It caches access state and persists rotated refresh tokens back to the token store.
8. The QuickBooks client already coalesces concurrent authentication and refresh attempts within one process and has limited protection against refresh-token rotation by a sibling process using the same token store.
9. When sandbox QuickBooks authorization is missing or invalid, the current runtime can open a browser and bind a local callback server. Production failures already require operator reauthorization.
10. The build passes. The existing test baseline is 35 passing suites and 629 passing tests. Tests emit asynchronous OAuth callback logging after completion.
11. The existing lint command fails before this migration because ESLint 9 is installed without a flat ESLint configuration.
12. AuthCo's live discovery metadata reports issuer `https://auth.devraftel.com/api/auth`, PKCE `S256`, Client ID Metadata Document support, authorization-response issuer support, JWKS, introspection, authorization, token, and revocation endpoints.
13. AuthCo currently advertises `finance.chat` but not the three QuickBooks scopes selected below. The path-appended OIDC discovery endpoint works. The two path-inserted discovery URLs tried first by MCP clients currently return 404; conforming clients then reach the working path-appended endpoint.

## Relevant MCP `2026-07-28` Requirements

The latest specification contains a larger protocol surface than this server needs. The migration is governed by the following relevant requirements:

- MCP remains JSON-RPC, but the modern protocol is stateless. Every request carries protocol version and client capabilities in `_meta`; there is no `initialize`/`initialized` handshake and the server creates no session state. A client-supplied `Mcp-Session-Id` is ignored.
- Servers must implement `server/discover`, advertise supported versions and capabilities, and return cache metadata.
- Streamable HTTP uses one MCP endpoint accepting POST. Each JSON-RPC message is a separate POST. A request response is either one JSON object or a request-scoped SSE stream.
- The modern transport has no general GET stream, session termination DELETE, SSE resumability, or message redelivery.
- HTTP requests require `MCP-Protocol-Version` and `Mcp-Method`; `tools/call` also requires `Mcp-Name`. Header and body values must match.
- Clients advertise support for both `application/json` and `text/event-stream`. This server may return JSON for its current request/response-only tools.
- Requests for unsupported protocol versions return `UnsupportedProtocolVersionError`. This server advertises and accepts only `2026-07-28`.
- `tools/list` must be deterministic and return `ttlMs` plus `cacheScope`. Tool invocation remains `tools/call`.
- HTTP servers must validate a present `Origin`, reject an invalid origin with 403, and use proper authentication. Local listeners should bind to loopback unless isolated behind a local proxy/container network.
- A protected HTTP MCP server acts as an OAuth resource server. It publishes RFC 9728 Protected Resource Metadata, returns RFC-compliant bearer challenges, validates issuer/audience/expiry/scope, and never accepts tokens intended for another resource.
- The MCP authorization token and Intuit tokens belong to different trust domains. Token passthrough is prohibited.
- Roots, Sampling, Logging, Dynamic Client Registration, and legacy HTTP+SSE are deprecated. This migration will not introduce them.

Authoritative references:

- [MCP `2026-07-28` key changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [Versioning and compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)
- [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [Authorization server discovery](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery)
- [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [TypeScript SDK v2 migration guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2)
- [TypeScript SDK support for `2026-07-28`](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)

## Current-to-Target Difference Matrix

| Concern | Current | Phase 1 target |
|---|---|---|
| Protocol era | Legacy, initialization-based v1 SDK behavior | Modern MCP `2026-07-28` only |
| Lifecycle | `initialize` and connection-scoped state | Per-request metadata; `server/discover`; no handshake |
| Remote transport | None | Stateless Streamable HTTP on one POST endpoint |
| Local transport | stdio using legacy SDK connection | stdio retained, upgraded to modern-only protocol |
| HTTP sessions | Not applicable | No protocol sessions and no session store |
| Server construction | Process singleton `McpServer` | Fresh server from one shared factory per HTTP request; one server per stdio process |
| Tool registry | Embedded in executable entry point | One deterministic registry consumed by both transports |
| Tool registration | Deprecated variadic `server.tool()` with `{ params }` wrapper | SDK v2 `registerTool()` with Standard Schema input; adapter preserves existing handlers |
| Tool surface | 142 verified tools | Same 142 names, schemas, availability policy, and handler behavior |
| Tool authority | Optional environment category disables; unknown prefixes default to read | Existing disables retained; explicit fail-closed read/write/delete authority metadata added |
| Client authorization | None; local subprocess trust | Provider-neutral OAuth 2.1 bearer authorization for HTTP; AuthCo is the initial deployment provider |
| QuickBooks authorization | One environment/file-backed company per process | Same single-company authority, made an explicit deployment invariant |
| Errors | Mostly text tool results | Existing tool-result semantics preserved; HTTP/protocol/auth failures use correct HTTP and JSON-RPC boundaries |
| Deployment | Local package subprocess | Same package plus one reusable container image and local HTTPS Compose topology |
| Conformance | Unit/handler tests only | Existing baseline plus protocol, auth, transport parity, container, and official conformance tests |

## Problem Statement

Users can currently run the QuickBooks MCP server only as a local stdio subprocess. They cannot connect to a centrally operated, authenticated HTTPS endpoint. Simply replacing `StdioServerTransport` with an HTTP listener would expose one company's accounting authority over a network without a caller identity boundary, would retain an obsolete MCP lifecycle, and would couple concurrent HTTP requests to a singleton protocol server that was designed for one process connection.

The migration must add remote connectivity without changing the QuickBooks tool contract, mixing MCP identity tokens with Intuit credentials, silently supporting legacy protocol behavior, or prematurely building multi-tenant infrastructure.

## Solution

Upgrade the repository to the stable MCP TypeScript SDK v2 line and create one deterministic QuickBooks MCP server factory. The factory registers the verified 142-tool surface and is used by two modern-only serving adapters:

1. A stateless Streamable HTTP adapter mounted at `/mcp`, protected by a configured standards-compliant authorization server and served publicly only through HTTPS.
2. A stdio adapter retained for local use and rollback, but explicitly configured to reject legacy initialization-based clients.

The HTTP endpoint is a single-tenant OAuth resource server. A configured OAuth 2.1 authorization server authenticates and authorizes MCP callers; AuthCo is the initial deployment choice. The existing Intuit configuration separately authorizes the server to one QuickBooks company. The deployment runs one replica with one writable token-store mount. The same immutable container image is used for local Compose validation and eventual deployment.

## User Stories

1. As an MCP user, I want to connect to the QuickBooks server through a standard HTTPS URL, so that my MCP host does not need to spawn a local subprocess.
2. As an MCP user, I want any MCP `2026-07-28`-conforming client to interoperate, so that the server is not coupled to a vendor host.
3. As an existing local user, I want stdio to remain available during Phase 1, so that I retain a local diagnostic and rollback path.
4. As a protocol operator, I want both transports to expose the same tool registry, so that capabilities cannot drift.
5. As a protocol operator, I want older MCP requests rejected clearly, so that the service does not silently run two lifecycle models.
6. As an authenticated user, I want the configured authorization server to authorize my MCP access, so that possession of the endpoint URL does not grant QuickBooks access.
7. As a read-only user, I want read operations to require `quickbooks.read`, so that I cannot mutate company data.
8. As an accounting operator, I want create and update operations to require `quickbooks.write`, so that accounting changes require explicit authority.
9. As an accounting administrator, I want deletion to require `quickbooks.delete`, so that destructive operations have a distinct authorization boundary.
10. As an OAuth client, I want correct 401 and 403 challenges, so that I can discover the configured authorization server and perform initial or step-up authorization.
11. As a security operator, I want access tokens restricted to the exact MCP resource audience, so that tokens issued for another DevRaftel service cannot be reused here.
12. As a security operator, I want MCP client tokens kept separate from Intuit tokens, so that downstream credentials are never passed through or exposed.
13. As a QuickBooks company owner, I want one deployment bound to one realm, so that another caller cannot select or inject a different company ID.
14. As an operator, I want the service to refuse remote startup without pre-provisioned QuickBooks credentials, so that an MCP request never triggers an interactive browser flow.
15. As an operator, I want refresh-token rotation persisted on a writable volume, so that container restarts do not lose the newest token.
16. As an operator, I want a non-sensitive health endpoint, so that the platform can determine process readiness without reading company data.
17. As an operator, I want structured, redacted request logs and trace correlation, so that failures can be investigated without leaking tokens or accounting payloads.
18. As an operator, I want one production image used locally and remotely, so that deployment does not introduce an untested runtime variant.
19. As a maintainer, I want the existing 629-test baseline preserved, so that the transport migration does not silently alter QuickBooks behavior.
20. As a maintainer, I want protocol-level tests above the individual tool layer, so that one parity test covers all registered tools and both transports.
21. As a maintainer, I want the official MCP conformance suite pinned in validation, so that interoperability is measured against the protocol rather than one branded client.
22. As a maintainer, I want stale tool-count documentation corrected from the executable registry, so that acceptance criteria describe the server that actually runs.
23. As a release owner, I want an explicit rollback path, so that the remote endpoint can be withdrawn without rewriting the QuickBooks integration.

## Implementation Decisions

### 1. Protocol and SDK

- Replace the monolithic v1 SDK dependency with the stable v2 server, Node, and official Express adapter packages required by shipped code. Express is the selected HTTP boundary because the official adapter supplies the MCP-aware host/origin and OAuth resource-server middleware this migration needs.
- Upgrade schemas supplied to the SDK to a Standard Schema-compatible Zod version.
- Use the SDK's modern serving entries, not hand-written JSON-RPC dispatch.
- Configure HTTP and stdio serving to accept only `2026-07-28` and reject legacy fallback.
- Implement only core server discovery and tools. Do not advertise unimplemented capabilities.
- Let the SDK produce required modern result envelopes such as `resultType` and server metadata; do not manually forge protocol envelopes in tool handlers.

### 2. One Server Factory and One Registry Seam

- Replace the protocol-server singleton with a factory that creates a fresh `McpServer` and registers the complete tool registry deterministically.
- Construct one server per HTTP request, as required by the modern stateless handler, and one server per stdio process.
- Keep the QuickBooks API client outside the protocol-server factory. It remains a single, process-level dependency because Phase 1 is explicitly single tenant.
- Extract registry composition from the executable startup path. Transport entry points may choose how to listen, but neither may define tools.
- Preserve every verified tool name, description, input schema, enable/disable rule, handler, and user-visible result unless an SDK v2 wire requirement forces a documented change.
- Preserve existing `{ params }`-expecting handler implementations through one central registration adapter. The SDK-facing callback receives modern direct input and wraps it only at the internal compatibility boundary. Do not mechanically rewrite 142 handlers merely to change transport plumbing.

### 3. Tool Metadata and Authority

- Extend the internal tool definition with an explicit authority class: read, write, or delete.
- Unknown or missing authority classes fail registration. The existing behavior that defaults an unknown prefix to read is not safe for a network service.
- The current verb prefixes may populate or validate the explicit authority during migration because all 142 names classify unambiguously; authorization must ultimately use the explicit registered metadata, not untrusted client text alone.
- Derive MCP annotations centrally. Read tools are marked read-only and non-destructive. All QuickBooks operations remain open-world. Mutating tools are conservatively marked non-read-only, potentially destructive, and non-idempotent unless a tool is individually proven otherwise.
- Do not add output schemas or convert all responses to `structuredContent` in this transport migration. Preserve the text content contract and address structured output as a separate tool-quality project.
- Return the tool list in stable name order with finite `ttlMs`. Use private cache scope for the protected tool catalog unless implementation evidence proves a public cache is safe across deployments and principals.

### 4. Streamable HTTP

- Expose exactly one MCP path, `/mcp`, accepting POST for the modern protocol.
- Do not implement the legacy general GET event stream, session DELETE, session creation, resumability, or redelivery. Never emit or persist `Mcp-Session-Id`; ignore it when received.
- Use JSON response mode for the current request/response-only tools. The implementation must remain able to emit request-scoped SSE if a future in-scope tool adds progress before its final response; that future capability requires its own tests.
- Enforce body size, request timeout, content type, `Accept`, protocol version, and standard MCP header requirements using the official SDK/adapter behavior where available.
- Reject missing or mismatched `MCP-Protocol-Version`, `Mcp-Method`, and required `Mcp-Name` values according to the current specification.
- Validate `Origin` whenever present. Maintain an explicit configured allowlist; do not use wildcard CORS. Requests without `Origin`, typical of server-to-server MCP clients, remain eligible for normal authentication.
- Validate the request host/resource boundary. Locally, publish only the TLS proxy port; do not publish the application port to the host.
- Add per-principal and per-tool-class rate limits at the HTTP boundary, with conservative defaults and observable 429 responses. Rate limits supplement rather than replace QuickBooks API throttling behavior.

### 5. Provider-Neutral Resource-Server Authorization

- Configure `https://auth.devraftel.com/api/auth` as the sole Phase 1 authorization server.
- Require an exact `MCP_RESOURCE_URI` at HTTP startup. Its form is `https://{final-host}/mcp`; only the host remains undecided. This exact endpoint URI is both the protected resource identifier and required token audience.
- Publish RFC 9728 Protected Resource Metadata at the path-derived well-known URI and include its URL in every relevant `WWW-Authenticate` challenge. A root metadata alias may also be published for interoperability.
- Protected metadata advertises the configured issuer and QuickBooks scopes. Authorization/OIDC metadata remains owned and served by the selected authorization server.
- The runtime requires explicit `MCP_AUTH_*` configuration and contains no vendor-specific issuer or endpoint defaults. AuthCo values are supplied only by deployment configuration.
- Add `quickbooks.read`, `quickbooks.write`, and `quickbooks.delete` to the selected authorization server before live integration testing.
- Require authorization-code flow with PKCE for Phase 1 interactive clients. Do not enable machine-to-machine `client_credentials` use until a concrete caller and policy are specified.
- Use Client ID Metadata Documents or explicit pre-registration for client registration. Do not add the deprecated Dynamic Client Registration mechanism.
- Validate every access token's configured issuer, resource audience, expiry/not-before, signature or introspection status, and scopes. Do not infer access-token format from discovery metadata: configure JWKS verification for audience-bound JWTs or authenticated introspection for opaque tokens.
- Require at least one QuickBooks scope for protected MCP access. `server/discover` and `tools/list` use `quickbooks.read` as the initial minimum scope. A tool call additionally requires its explicit authority scope.
- Scopes do not imply one another. Clients request the union they need. A read token cannot write; a write token does not silently read; deletion always requires `quickbooks.delete`.
- Missing/invalid credentials return 401. Valid tokens lacking required scope return 403 with one challenge containing the complete minimum scope set for the current operation.
- Perform tool authorization against the validated JSON-RPC method and tool name after header/body consistency checks. A gateway may pre-filter using `Mcp-Method` and `Mcp-Name`, but gateway routing is not the authorization authority.
- Never log bearer tokens, authorization codes, Intuit tokens, raw QuickBooks request/response bodies, or sensitive `Mcp-Name` parameter mirrors.
- OAuth bearer authorization applies only to Streamable HTTP. Modern stdio retains its local process/environment trust model and existing tool-disable policy; it does not run an HTTP OAuth flow.

### 6. QuickBooks Single-Tenant Runtime

- Declare one deployment, one token store, and one QuickBooks realm as a startup invariant.
- Do not accept realm ID, Intuit access token, refresh token, client secret, token-store path, or environment from MCP request arguments or headers.
- Keep current access-token caching, refresh coalescing, refresh-token persistence, and transient-vs-invalid refresh handling.
- Split interactive Intuit bootstrap from server operation. The operator performs initial company authorization explicitly; HTTP mode refuses to start when required Intuit configuration or a usable persisted refresh token is absent.
- HTTP request handling never opens a browser and never binds an Intuit callback listener. The separate bootstrap command may retain that behavior for an operator-controlled sandbox workflow.
- Run one application replica in Phase 1. Multi-replica refresh-token coordination and shared durable credential storage belong to the later multi-tenant/high-availability design.

### 7. Runtime Configuration and Health

- Select transport explicitly. The local package entry remains stdio-oriented for compatibility; the container defaults to HTTP. Ambiguous production startup fails rather than guessing.
- HTTP mode requires resource URI, OAuth issuer and metadata, listen address/port, allowed origins, QuickBooks environment, realm, credentials, and an absolute writable token-store path.
- Validate all configuration once at startup and report missing variable names without printing values.
- Separate liveness from readiness. Liveness proves the process event loop responds. Readiness proves static configuration and token-store access are valid; it does not query or expose QuickBooks company data.
- Keep `/healthz` outside MCP routing and return only bounded status, build version, and readiness state.
- Log structured records to stderr/stdout according to transport safety: stdio protocol output remains uncontaminated. Include request/trace ID, MCP method, tool name, status, duration, and a stable non-secret principal identifier. Exclude arguments and result bodies by default.
- Propagate documented W3C trace context metadata when present, without adopting the deprecated MCP Logging feature.

### 8. Container and Local HTTPS Topology

- Build one multi-stage image from the lockfile using a current supported Node LTS compatible with SDK v2; pin the major version.
- Compile in the build stage and copy only production runtime dependencies and built artifacts into the runtime stage.
- Run as a non-root user with a read-only root filesystem, dropped Linux capabilities, and a writable mount only for the QuickBooks token store and unavoidable temporary files.
- Never bake environment files, access tokens, refresh tokens, authorization-server client material, or TLS private keys into image layers.
- Use Compose locally with a private application-to-proxy ingress network and a separate un-published application egress network for the authorization server and QuickBooks. Publish only the proxy's loopback-bound port.
- Use a locally trusted development certificate or explicitly configured test trust store. Do not normalize bypassing TLS verification as the development workflow.
- Reuse the same application image in deployment. The production platform or edge terminates TLS and forwards only trusted internal traffic to the application.
- Add graceful shutdown: stop accepting requests, bound in-flight completion time, close the HTTP handler, and exit without corrupting the refresh-token file.

### 9. Documentation and Release Contract

- Document HTTPS as the security layer and Streamable HTTP as the MCP transport; do not call the transport merely "HTTPS."
- Document the modern-only compatibility boundary explicitly. "Any MCP client" means any client conforming to MCP `2026-07-28` Streamable HTTP and the MCP OAuth profile, not legacy MCP clients.
- Correct all tool-count claims to the registry-derived value and automate the check so future changes cannot drift silently.
- Document both OAuth systems separately: the configured authorization server protects MCP; Intuit protects QuickBooks. AuthCo is the initial MCP authorization provider.
- Provide separate local stdio, local Compose HTTPS, authorization-server configuration, Intuit bootstrap, and production configuration procedures, with AuthCo values documented as the initial deployment example.
- Treat the protocol/SDK change as a breaking compatibility release even though stdio remains available.

## Testing Decisions

### Primary Test Seam

The highest useful seam is the server factory invoked through an in-process MCP transport/HTTP handler with a fake QuickBooks dependency and token verifier. This single seam observes advertised capabilities, discovery, tool schemas, tool calls, result envelopes, protocol rejection, and authorization without binding a real port or calling Intuit. Tests should assert external protocol behavior rather than private SDK objects.

Transport parity is tested above individual handlers: obtain `server/discover` and `tools/list` through modern stdio and Streamable HTTP, then compare the ordered tool names and advertised schemas. One representative read, write, delete, validation-error, and handler-error call proves that the shared registration adapter preserves the existing callback contract. Existing handler tests remain the detailed QuickBooks behavior authority.

### Required Automated Coverage

1. **Factory and registry:** exactly 142 unique tools; deterministic order; every tool has a valid schema, authority, annotations, and handler; no duplicate or unregistered definitions.
2. **Modern lifecycle:** `server/discover` reports only `2026-07-28` and tools capability; no prompts/resources/extensions are advertised.
3. **Legacy rejection:** `initialize`, missing modern `_meta`, 2025 protocol versions, legacy HTTP GET, and session DELETE fail with the required actionable behavior.
4. **HTTP framing:** POST-only MCP endpoint, single JSON-RPC body, supported content types, notification handling, JSON result mode, bounded body, and timeout/cancellation behavior.
5. **Header validation:** missing and mismatched protocol/method/name headers produce the specified status and JSON-RPC error; body remains the execution authority.
6. **Origin/host controls:** allowed, disallowed, malformed, absent, and DNS-rebinding-shaped host/origin inputs.
7. **Authentication:** missing, malformed, expired, not-yet-valid, wrong issuer, wrong audience, bad signature/introspection, and revoked tokens return 401 without protocol execution.
8. **Authorization:** read/write/delete allow and deny matrix; no scope implication; correct 403 and complete `WWW-Authenticate` scope challenge.
9. **Protected metadata:** path-derived and optional root discovery documents contain the exact resource URI, configured issuer, and supported scopes.
10. **Tool-result parity:** representative calls preserve current text content and error behavior while the SDK supplies valid modern result envelopes.
11. **stdio safety:** no application logs reach stdout; modern discovery and tool calls work; legacy handshake fails clearly.
12. **QuickBooks startup:** HTTP mode fails before listening when realm, credentials, token store, or resource-server configuration is absent or invalid; it never starts interactive OAuth.
13. **Token persistence:** rotated refresh tokens survive container restart; file permissions and read-only-root behavior are enforced.
14. **Concurrency:** simultaneous first calls and refresh attempts retain existing single-flight behavior; authorization context cannot leak between requests.
15. **Graceful shutdown:** new requests are rejected after draining starts, bounded in-flight calls complete or cancel, and token persistence remains intact.

### External Validation

- Pin a reviewed release of the official [MCP conformance suite](https://github.com/modelcontextprotocol/conformance) and run the full applicable server suite with spec version `2026-07-28`, including wire-schema validation. Do not silently baseline unexpected failures.
- Use MCP Inspector for diagnostics, not as the sole conformance claim.
- Run a Compose smoke test through local TLS for discovery, authorization challenge, authenticated tool listing, one sandbox read, and denied mutation.
- Register a distinct local-development resource URI/audience with the selected authorization server for the Compose HTTPS endpoint. Do not issue a production-resource token to a localhost audience or weaken audience validation for development.
- Run a live authorization-server test with a pre-registered development client: discovery, authorization-code + PKCE, correct audience, each scope, insufficient-scope step-up, and revocation/expiry behavior. The initial deployment test uses AuthCo.
- Run a QuickBooks sandbox smoke test only with a dedicated sandbox company. No automated test may mutate production accounting data.

### Baseline Gates

- Existing build remains green.
- All 629 existing tests remain green.
- Pre-existing asynchronous OAuth test logging is tracked separately and must not hide new open-handle failures.
- Pre-existing lint failure is either repaired as a prerequisite or explicitly excluded from the migration gate. The migration may not claim lint success until the ESLint configuration exists.
- Documentation counts must be generated or verified against the executable registry.

## Implementation Plan

### Stage 0 — Establish a Reproducible Baseline

1. Record build, test, lint, registry count, SDK lockfile version, and Node runtime evidence.
2. Decide whether to repair the pre-existing ESLint configuration in a small prerequisite change or keep it as a documented external blocker.
3. Add a registry-parity assertion at the existing registration test seam.
4. Freeze the current 142-tool list and representative wire outputs as migration comparison evidence.

**Exit criteria:** baseline evidence is reproducible; no migration code has changed tool behavior.

### Stage 1 — Upgrade SDK and Create the Shared Modern Server Factory

1. Run the official SDK v1-to-v2 codemod in dry-run mode and review its package/import/type changes; do not accept mechanical edits blindly.
2. Replace v1 SDK packages and migrate SDK-facing schemas/types to the supported Standard Schema/Zod version.
3. Extract deterministic registry composition and create the per-serving-unit server factory.
4. Replace the deprecated registration call with one central modern adapter that preserves existing handler inputs and outputs.
5. Add explicit fail-closed authority and MCP annotations.
6. Move stdio to the modern SDK serving entry and reject legacy fallback.
7. Prove modern discovery, complete tool parity, representative calls, and explicit legacy rejection over stdio.

**Exit criteria:** modern-only stdio passes registry parity and existing tests; no HTTP listener exists yet.

### Stage 2 — Add the Protected Streamable HTTP Vertical Slice

1. Mount a modern-only, stateless SDK HTTP handler at `/mcp` using the same server factory.
2. Add configuration validation, origin/host protection, body/time limits, structured redacted logging, and graceful shutdown.
3. Implement the provider-neutral token-verifier boundary and Protected Resource Metadata.
4. Enforce initial read scope and per-tool read/write/delete scope centrally.
5. Add health endpoints outside the MCP handler.
6. Test one read, one write, one delete, and all auth/error boundaries through the in-process HTTP seam before expanding parity assertions to all tools.

**Exit criteria:** no unauthenticated request reaches MCP dispatch; all 142 tools are advertised identically; scope enforcement is fail-closed; legacy HTTP is rejected.

### Stage 3 — Containerize and Validate Local HTTPS

1. Add the multi-stage, non-root, read-only production image.
2. Add local Compose topology with internal application networking, TLS proxy, trusted development certificate, token-store mount, secrets injection, and health checks.
3. Prove startup failure without credentials, successful sandbox startup with mounted credentials, token rotation persistence, restart recovery, and graceful stop.
4. Run protocol and authorization tests through the HTTPS proxy, not directly against the internal application port.

**Exit criteria:** the same immutable image passes local HTTPS, configured authorization-server, QuickBooks sandbox read, denied mutation, and restart-persistence smoke tests.

### Stage 4 — Conformance, Documentation, and Release Readiness

1. Pin and run the full official `2026-07-28` server conformance suite.
2. Resolve every applicable conformance failure or document a verified upstream harness defect with a narrow temporary exception and removal condition.
3. Update architecture, authentication, local stdio, remote HTTPS, container, troubleshooting, and compatibility documentation.
4. Correct stale tool and test counts from executable evidence.
5. Publish a breaking-change migration note explaining that stdio remains but legacy protocol clients no longer work.
6. Produce a deployment checklist whose unresolved inputs include final `MCP_RESOURCE_URI`, authorization-server resource registration, TLS platform, and secret/volume provisioning.

**Exit criteria:** build/tests/conformance/container gates pass; documentation matches the executable surface; all production prerequisites are explicit.

### Stage 5 — Single-Tenant Deployment and Controlled Cutover

1. Select the final HTTPS resource URI and configure its exact audience in the selected authorization server.
2. Verify authorization-server scopes and actual access-token validation mode in the target environment.
3. Provision one instance, one company realm, one encrypted secret set, and one durable token-store volume.
4. Deploy with external traffic disabled; run readiness, authorization, protocol, and QuickBooks sandbox or approved non-mutating production checks.
5. Enable limited client access, observe authorization failures, latency, QuickBooks refresh behavior, throttling, and process health.
6. Keep stdio available during Phase 1. If remote validation fails, withdraw the HTTPS route and continue local stdio while correcting the HTTP layer.

**Exit criteria:** authenticated remote discovery and approved QuickBooks operations succeed over HTTPS; unauthorized and wrong-scope operations fail; token rotation survives restart; rollback has been exercised or procedurally verified.

## Rollback Strategy

- The remote route is independently removable because transport adapters share but do not replace QuickBooks handlers.
- Keep a known-good pre-migration package artifact for legacy stdio users during the cutover window; the new package deliberately does not provide legacy protocol fallback.
- If authorization, TLS, HTTP framing, or container health fails, disable the public route and use the approved local recovery path. Do not bypass authentication or enable legacy protocol as an emergency workaround.
- If QuickBooks behavior differs, stop the rollout and compare the same representative tool through the old and new registration seams before changing handlers.
- Refresh-token rollback must preserve the newest persisted token. Never restore an older token-store snapshot blindly because Intuit rotation may have invalidated it.

## Out of Scope

- Multi-tenant users, organizations, company selection, per-user QuickBooks credentials, or shared credential databases.
- Multiple QuickBooks realms in one process or deployment.
- Multiple replicas, distributed locks, shared refresh-token coordination, sticky sessions, Redis, or a session database.
- MCP `2025-11-25` or earlier, legacy initialization, legacy HTTP+SSE, or dual-era fallback.
- Removing stdio in Phase 1.
- Building or hosting an OAuth authorization server in this repository.
- Machine-to-machine `client_credentials` access.
- Selecting the final production hostname, deployment provider, ingress product, or certificate authority.
- Redesigning the 142 QuickBooks tools, renaming them, adding service prefixes, changing pagination, or adding structured outputs wholesale.
- Adding prompts, resources, Tasks, MCP Apps, subscriptions, roots, sampling, elicitation, or MCP Logging.
- Interactive QuickBooks onboarding through the MCP endpoint.
- Production-data mutation during validation.
- General lint/test cleanup except where required to make migration gates reliable.

## Further Notes

### Required Inputs Before Implementation Can Be Declared Deployable

1. The selected authorization server must advertise and issue `quickbooks.read`, `quickbooks.write`, and `quickbooks.delete`.
2. The deployment must explicitly select JWT/JWKS verification or authenticated introspection without guessing token format.
3. The final `MCP_RESOURCE_URI` and corresponding authorization-server audience/resource registration must be set before live deployment.
4. A deployment TLS edge, secret injection mechanism, and durable writable token-store volume must be selected.
5. The official SDK and conformance package versions must be pinned to reviewed releases current at implementation time.

### AuthCo Discovery Observation

At the time of this spec, AuthCo serves valid OIDC metadata at the path-appended issuer endpoint and at root aliases. The MCP discovery algorithm for a path-bearing issuer tries two path-inserted URLs first; those currently return 404, after which the working path-appended endpoint is tried. This is compatible with a conforming client's required fallback sequence, but adding path-inserted aliases would reduce discovery round trips and improve compatibility with imperfect clients. That AuthCo improvement is recommended, not a blocker for a standards-conforming client.

### Specification Publication

The requested `to-spec` skill normally publishes to a configured issue tracker with a `ready-for-agent` label. No repository issue-tracker setup or triage vocabulary was provided, and this task did not authorize creating an external issue. This specification is therefore stored locally. Publishing it is a separate explicit action.
