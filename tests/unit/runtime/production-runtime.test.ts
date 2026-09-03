import { describe, expect, it, jest } from "@jest/globals";

import { createProductionRuntime } from "../../../src/runtime/production-runtime";
import { MCP_PATH } from "../../../src/http-config";
import type { HttpConfig } from "../../../src/http-config";
import type {
  ExecutionContext,
  QboExecutionLease,
  QboExecutionLeaseProvider,
} from "../../../src/runtime/contracts";

const RESOURCE = `https://quickbooks-mcp.example${MCP_PATH}`;
const ISSUER = "https://auth.example/issuer";
const ORGANIZATION_CLAIM = "https://devraftel.com/organization_id";
const FINANCE_WORKER = "finance-worker";

/** What the temporary middleware invents when it fabricates a caller. */
const TEMPORARY_CLIENT_ID = "temporary-unauthenticated-mcp";

function config(overrides: Partial<HttpConfig> = {}): HttpConfig {
  return {
    resourceUri: new URL(RESOURCE),
    authIssuer: ISSUER,
    authMetadataUrl: new URL(
      "https://auth.example/.well-known/oauth-authorization-server",
    ),
    authIntrospectionUrl: new URL("https://auth.example/introspect"),
    authIntrospectionClientId: "quickbooks-mcp",
    authIntrospectionClientSecret: "introspection-secret",
    listenHost: "127.0.0.1",
    listenPort: 0,
    allowedHosts: ["127.0.0.1"],
    allowedOrigins: ["127.0.0.1"],
    bodyLimit: "1mb",
    requestTimeoutMs: 2_000,
    authOrganizationClaim: ORGANIZATION_CLAIM,
    allowedClientIds: [FINANCE_WORKER],
    temporaryUnauthenticatedMode: false,
    qboExecutionLeaseProvider: "finance-http",
    ...overrides,
  };
}

const leaseProvider: QboExecutionLeaseProvider = {
  acquire: jest.fn(
    async (_context: ExecutionContext): Promise<QboExecutionLease> => {
      throw new Error("not used");
    },
  ),
};

function claims(clientId: string): Record<string, unknown> {
  return {
    iss: ISSUER,
    sub: clientId,
    client_id: clientId,
    [ORGANIZATION_CLAIM]: "organization-1",
  };
}

async function policyFor(overrides: Partial<HttpConfig>) {
  const runtime = await createProductionRuntime(config(overrides), {
    qboExecutionLeaseProvider: leaseProvider,
  });
  return runtime.services.authorizationPolicy;
}

describe("createProductionRuntime", () => {
  it("enforces the client allowlist when callers are authenticated", async () => {
    const policy = await policyFor({});

    expect(policy.authorize(claims(FINANCE_WORKER)).allowed).toBe(true);
    expect(policy.authorize(claims("third-party"))).toEqual({
      allowed: false,
      reason: "client_not_allowed",
    });
  });

  it("does not enforce the allowlist in temporary unauthenticated mode", async () => {
    // Cutover step 2 runs with the allowlist configured and temporary mode
    // still on. The execution seam re-runs this policy on every tool call
    // regardless of mode, and the fabricated caller is deliberately not on the
    // allowlist, so enforcing it here would fail every call in that window.
    const policy = await policyFor({
      temporaryUnauthenticatedMode: true,
      allowedClientIds: [FINANCE_WORKER],
    });

    expect(policy.authorize(claims(TEMPORARY_CLIENT_ID)).allowed).toBe(true);
  });

  it("still requires an organization in temporary unauthenticated mode", async () => {
    const policy = await policyFor({
      temporaryUnauthenticatedMode: true,
      allowedClientIds: [FINANCE_WORKER],
    });
    const { [ORGANIZATION_CLAIM]: _omitted, ...withoutOrganization } =
      claims(TEMPORARY_CLIENT_ID);

    expect(policy.authorize(withoutOrganization)).toEqual({
      allowed: false,
      reason: "missing_organization",
    });
  });

  it("still requires the configured issuer in temporary unauthenticated mode", async () => {
    const policy = await policyFor({
      temporaryUnauthenticatedMode: true,
      allowedClientIds: [FINANCE_WORKER],
    });

    expect(
      policy.authorize({
        ...claims(TEMPORARY_CLIENT_ID),
        iss: "https://elsewhere.example/issuer",
      }),
    ).toEqual({ allowed: false, reason: "missing_identity" });
  });

  it("uses the injected lease provider and close hook", async () => {
    const close = jest.fn(async () => undefined);
    const runtime = await createProductionRuntime(config(), {
      qboExecutionLeaseProvider: leaseProvider,
      close,
    });

    await runtime.close();
    expect(close).toHaveBeenCalledTimes(1);
    expect(runtime.services.qboClientFactory).toBeDefined();
  });
});
