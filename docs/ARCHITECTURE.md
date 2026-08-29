# Architecture

The QuickBooks Online MCP Server is a stateless MCP `2026-07-28` resource
server and execution adapter. It is not the organization database, Intuit OAuth
token vault, employee authority model, or financial control plane.

## Request execution

```text
MCP client
  -> AuthCo resource token verification and tool scope check
  -> organization claim plus trusted Company metadata
  -> tool schema and forbidden-routing-field validation
  -> one Finance execution-lease request
  -> one fresh request-scoped QuickBooks client
  -> QuickBooks Online
  -> release request references and return a redacted result
```

Reads, writes, updates, and deletes use the same execution path. Tool authority
metadata remains explicit so AuthCo scopes and the employee/client supervision
layer can distinguish risk.

## Ownership boundaries

Finance owns:

- organization and Company connection records;
- Intuit OAuth, refresh tokens, rotation, revocation, and reauthorization;
- validation that the requested Company belongs to the verified organization;
- issuing a short-lived access-token lease for one request.

The MCP server owns:

- MCP protocol and HTTP handling;
- AuthCo resource-token and scope enforcement;
- tool discovery, schemas, and authority annotations;
- rejection of model-controlled tenant, connection, realm, or credential data;
- request-scoped QuickBooks clients and safe result/error conversion.

The employee/client application owns human approval and work authority. Future
idempotency, reconciliation, or throttling controls should be designed beside
the execution owner when the concrete production need is known. They are not
ports or mandatory dependencies in this MCP repository today.

## Runtime seam

`QboExecutionLeaseProvider.acquire()` accepts an immutable verified execution
context and returns temporary QuickBooks material. Refresh tokens and Intuit
client secrets never cross this port. `RequestScopedQboClientFactory` validates
lease expiry and constructs a fresh SDK/raw-client pair for the call.

Handlers receive only explicit dependencies:

```typescript
type QboHandlerDependencies = Readonly<{
  execution: ExecutionContext;
  qbo: QuickBooks;
  rawQbo: QboRawClient;
}>;
```

Handlers do not read authorization headers, decode access tokens, select a
Company, or accept realm IDs and credentials from tool arguments.

## Source layout

```text
src/
├── index.ts                         # standalone HTTP entrypoint
├── http-config.ts                   # fail-closed resource configuration
├── http-server.ts                   # OAuth, MCP, health, and shutdown boundary
├── adapters/                        # Finance execution-lease adapter
├── auth/                            # token verification and metadata
├── runtime/                         # execution contracts and composition
├── clients/quickbooks-client.ts     # request-scoped lease/client factory
├── registry.ts                      # explicit-authority tool definitions
├── tools/                           # Zod schemas and adapters
├── handlers/                        # QuickBooks transformations and calls
└── helpers/register-tool.ts         # authorization and single-lease execution
```

## Operational consequence

The MCP server intentionally contains no custom operation ledger, application
rate limiter, or mutation-confirmation state. Consequently, an ambiguous write
response is not safe to retry automatically. This limitation is documented and
must be addressed by the owning production execution/control plane before
unattended financial mutations are enabled.
