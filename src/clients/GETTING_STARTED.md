# QuickBooks execution provider

The MCP runtime does not own an Intuit OAuth application, refresh tokens, or a
default company. Those responsibilities belong to the DevRaftel connection
service. Deployment code must inject a `QboExecutionLeaseProvider`; it resolves
the authorized QuickBooks connection from the verified caller and organization
context and returns a short-lived lease. It must also expose
`resolveConnectionBinding(context)`, which returns the opaque trusted connection
identifier used to bind a mutation's confirmation to its later lease.

The provider must never return a refresh token or client secret. See
`src/runtime/contracts.ts` for the provider-neutral port and
`docs/plans/2026-08-26-production-multi-tenant-execution-spec.md` for the
required ownership, authentication, revocation, and expiry semantics.

For local MCP-only tests, use a fake provider and a fake `QboClientFactory`; do
not place customer credentials in `.env` or test fixtures. The production
adapter, workload identity, network protocol, and durable token store are
deployment-owned and intentionally not implemented in this repository.
