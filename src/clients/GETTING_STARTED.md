# QuickBooks execution provider

The MCP runtime does not own an Intuit OAuth application, refresh tokens, or a
default company. Those responsibilities belong to the DevRaftel connection
service. Deployment code must inject a `QboExecutionLeaseProvider` and return a
short-lived lease for the one opaque `qboConnectionId` in the verified request
context.

The provider must never return a refresh token or client secret. See
`src/runtime/contracts.ts` for the provider-neutral port and
`docs/plans/2026-08-26-production-multi-tenant-execution-spec.md` for the
required ownership, authentication, revocation, and expiry semantics.

For local MCP-only tests, use a fake provider and a fake `QboClientFactory`; do
not place customer credentials in `.env` or test fixtures. The production
adapter, workload identity, network protocol, and durable token store are
deployment-owned and intentionally not implemented in this repository.
