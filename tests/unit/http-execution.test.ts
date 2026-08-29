import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  McpServer,
  PROTOCOL_VERSION_META_KEY,
  type AuthInfo,
  type McpServerFactory,
  type OAuthMetadata,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { ClaimBindingAuthorizationPolicy } from "../../src/runtime/authorization-policy";
import { createHttpApp, makeExecutionInputMiddleware } from "../../src/http-server";
import { OAuthAccessTokenVerifier } from "../../src/auth/oauth-access-token-verifier";
import { DEVRAFTEL_COMPANY_ID_META_KEY, RegisterTool } from "../../src/helpers/register-tool";
import type {
  ExecutionContext,
  QboClientLease,
  QboHandlerDependencies,
  RuntimeServices,
} from "../../src/runtime/contracts";
import type { HttpConfig } from "../../src/http-config";
import type { ToolDefinition } from "../../src/types/tool-definition";

const RESOURCE = "https://quickbooks-mcp.example/mcp";
const ISSUER = "https://auth.example/issuer";
const ORGANIZATION_CLAIM = "https://claims.example/organization";
const COMPANY_A = "00000000-0000-4000-8000-000000000001";
const COMPANY_B = "00000000-0000-4000-8000-000000000002";

type FakeToken = {
  tenant: string;
  resource?: string;
  scopes?: string[];
  omitOrganization?: boolean;
  ambiguousOrganization?: boolean;
};

type QboCall = {
  id: string;
  organizationId: string;
  companyId: string;
  qboConnectionId: string;
  realmId: string;
  accessToken: string;
};

type Harness = {
  app: ReturnType<typeof createHttpApp>;
  leaseCreate: jest.MockedFunction<(execution: ExecutionContext) => Promise<QboClientLease>>;
  qboCalls: QboCall[];
  verifyAccessToken: jest.MockedFunction<(token: string) => Promise<AuthInfo>>;
};

const oauthMetadata: OAuthMetadata = {
  issuer: ISSUER,
  authorization_endpoint: "https://auth.example/authorize",
  token_endpoint: "https://auth.example/token",
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code"],
  code_challenge_methods_supported: ["S256"],
  scopes_supported: ["quickbooks.read", "quickbooks.write", "quickbooks.delete"],
};

function config(): HttpConfig {
  return {
    resourceUri: new URL(RESOURCE),
    authIssuer: ISSUER,
    authMetadataUrl: new URL("https://auth.example/.well-known/oauth-authorization-server"),
    authIntrospectionUrl: new URL("https://auth.example/introspect"),
    authIntrospectionClientId: "mcp-resource-server",
    authIntrospectionClientSecret: "test-secret",
    listenHost: "127.0.0.1",
    listenPort: 0,
    allowedHosts: ["127.0.0.1"],
    allowedOrigins: ["127.0.0.1"],
    bodyLimit: "1mb",
    requestTimeoutMs: 2_000,
    authOrganizationClaim: ORGANIZATION_CLAIM,
    qboExecutionLeaseProvider: "test-lease-provider",
  };
}

function tokenInfo(token: FakeToken): AuthInfo {
  const clientId = `client-${token.tenant}`;
  const claims: Record<string, unknown> = {
    iss: ISSUER,
    sub: `subject-${token.tenant}`,
    client_id: clientId,
    ...(token.omitOrganization ? {} : {
      [ORGANIZATION_CLAIM]: token.ambiguousOrganization
        ? [`organization-${token.tenant}`]
        : `organization-${token.tenant}`,
    }),
  };
  return {
    token: token.tenant,
    clientId,
    scopes: token.scopes ?? ["quickbooks.read"],
    expiresAt: Math.floor(Date.now() / 1_000) + 600,
    resource: new URL(token.resource ?? RESOURCE),
    extra: { claims },
  };
}

function makeHarness(options: { leaseError?: Error } = {}): Harness {
  const qboCalls: QboCall[] = [];
  const leaseCreate = jest.fn(async (execution: ExecutionContext): Promise<QboClientLease> => {
    if (options.leaseError) throw options.leaseError;
    const qboConnectionId = `connection-${execution.organizationId}-${execution.companyId}`;
    const accessToken = `access-${qboConnectionId}`;
    const realmId = `realm-${qboConnectionId}`;
    const qbo = {
      getAccount: (id: string, callback: (error: null, value: unknown) => void) => {
        qboCalls.push({
          id,
          organizationId: execution.organizationId,
          companyId: execution.companyId,
          qboConnectionId,
          realmId,
          accessToken,
        });
        callback(null, { Id: id, RealmId: realmId });
      },
    };
    return {
      qbo: qbo as never,
      rawQbo: { accessToken, realmId, environment: "sandbox" },
      qboConnectionId,
      leaseId: `lease-${qboConnectionId}`,
      expiresAt: new Date(Date.now() + 60_000),
      close: jest.fn(async () => undefined),
    };
  });
  const services: RuntimeServices = {
    qboClientFactory: { create: leaseCreate },
    authorizationPolicy: new ClaimBindingAuthorizationPolicy({
      issuer: ISSUER,
      organizationClaim: ORGANIZATION_CLAIM,
    }),
  };
  const schema = z.object({ id: z.string().min(1) });
  const handler = async (
    { params }: { params: { id: string } },
    _context: unknown,
    dependencies?: QboHandlerDependencies,
  ) => {
    const qbo = dependencies?.qbo as never as {
      getAccount(id: string, callback: (error: null, value: unknown) => void): void;
    };
    return new Promise((resolve) => {
      qbo.getAccount(params.id, (_error, value) => resolve({
        content: [{ type: "text" as const, text: JSON.stringify(value) }],
      }));
    });
  };
  const readDefinition: ToolDefinition<typeof schema> = {
    name: "get_probe",
    description: "read test probe",
    schema,
    authority: "read",
    handler,
  };
  const writeDefinition: ToolDefinition<typeof schema> = {
    name: "create_probe",
    description: "write test probe",
    schema,
    authority: "write",
    handler,
  };
  const verifyAccessToken = jest.fn(async (token: string) => {
      if (token === "other-resource") return tokenInfo({ tenant: "a", resource: "https://other.example/mcp" });
      if (token === "missing-organization") return tokenInfo({ tenant: "a", omitOrganization: true });
      if (token === "ambiguous-organization") return tokenInfo({ tenant: "a", ambiguousOrganization: true });
      return tokenInfo({ tenant: token, scopes: token === "read-only" ? ["quickbooks.read"] : ["quickbooks.read", "quickbooks.write"] });
    });
  const serverFactory: McpServerFactory = () => {
    const server = new McpServer(
      { name: "HTTP execution test server", version: "test" },
      { capabilities: { tools: {} } },
    );
    RegisterTool(server, readDefinition, services);
    RegisterTool(server, writeDefinition, services);
    return server;
  };
  const app = createHttpApp({
    config: config(),
    oauthMetadata,
    tokenVerifier: { verifyAccessToken },
    serverFactory,
    services,
    toolAuthority: (name: string) => name === "get_probe" ? "read" : name === "create_probe" ? "write" : undefined,
    logger: () => undefined,
  });
  return { app, leaseCreate, qboCalls, verifyAccessToken };
}

async function post(harness: Harness, token: string, body: unknown): Promise<{ status: number; body: Record<string, any> }> {
  const authInfo = await harness.verifyAccessToken(token);
  const response = await harness.app.handler.fetch(
    new Request(RESOURCE, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": body && typeof body === "object" && "params" in body
          ? String((body as { params?: { name?: unknown } }).params?.name ?? "")
          : "",
      },
      body: JSON.stringify(body),
    }),
    { authInfo },
  );
  return { status: response.status, body: await response.json() as Record<string, any> };
}

function runExecutionInputGuard(body: unknown): { next: boolean; status?: number; body?: Record<string, any> } {
  let next = false;
  let status: number | undefined;
  let responseBody: Record<string, any> | undefined;
  const response = {
    headersSent: false,
    status(code: number) {
      status = code;
      return this;
    },
    type() {
      return this;
    },
    send(value: string) {
      responseBody = JSON.parse(value) as Record<string, any>;
      return this;
    },
  };
  makeExecutionInputMiddleware()(
    { body } as never,
    response as never,
    () => { next = true; },
  );
  return { next, status, body: responseBody };
}

function callBody(
  name: string,
  id = "42",
  argumentsOverride?: Record<string, unknown>,
  companyId = COMPANY_A,
) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name,
      arguments: argumentsOverride ?? { id },
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
        [CLIENT_INFO_META_KEY]: { name: "execution-test-client", version: "test" },
        [CLIENT_CAPABILITIES_META_KEY]: {},
        [DEVRAFTEL_COMPANY_ID_META_KEY]: companyId,
      },
    },
  };
}

afterEach(async () => undefined);

describe("authenticated HTTP execution seam", () => {
  it("keeps concurrent organizations request-scoped while the trusted lease supplies connection data", async () => {
    const harness = makeHarness();

    const [tenantA, tenantB] = await Promise.all([
      post(harness, "tenant-a", callBody("get_probe", "a", undefined, COMPANY_A)),
      post(harness, "tenant-b", callBody("get_probe", "b", undefined, COMPANY_B)),
    ]);

    expect(tenantA.status).toBe(200);
    expect(tenantB.status).toBe(200);
    expect(harness.qboCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "a",
        organizationId: "organization-tenant-a",
        companyId: COMPANY_A,
        qboConnectionId: `connection-organization-tenant-a-${COMPANY_A}`,
      }),
      expect.objectContaining({
        id: "b",
        organizationId: "organization-tenant-b",
        companyId: COMPANY_B,
        qboConnectionId: `connection-organization-tenant-b-${COMPANY_B}`,
      }),
    ]));
    expect(harness.leaseCreate).toHaveBeenCalledTimes(2);
    expect(harness.leaseCreate.mock.calls.every(([execution]) => !("qboConnectionId" in execution))).toBe(true);
  });

  it("denies missing or invalid Company metadata before lease acquisition", async () => {
    const harness = makeHarness();
    const missing = callBody("get_probe");
    const missingMeta: Partial<Record<string, unknown>> = missing.params._meta;
    delete missingMeta[DEVRAFTEL_COMPANY_ID_META_KEY];
    const invalid = callBody("get_probe", "invalid", undefined, "company-from-model");

    const [missingResponse, invalidResponse] = await Promise.all([
      post(harness, "tenant-a", missing),
      post(harness, "tenant-a", invalid),
    ]);

    expect(missingResponse.body.result?.isError).toBe(true);
    expect(invalidResponse.body.result?.isError).toBe(true);
    expect(harness.leaseCreate).not.toHaveBeenCalled();
    expect(harness.qboCalls).toHaveLength(0);
  });

  it("denies missing or ambiguous organization grants before lease acquisition", async () => {
    const harness = makeHarness();

    const missingOrganization = await post(harness, "missing-organization", callBody("get_probe"));
    const ambiguousOrganization = await post(harness, "ambiguous-organization", callBody("get_probe"));

    expect(missingOrganization.status).toBe(200);
    expect(ambiguousOrganization.status).toBe(200);
    expect(missingOrganization.body.result?.isError).toBe(true);
    expect(ambiguousOrganization.body.result?.isError).toBe(true);
    expect(harness.leaseCreate).not.toHaveBeenCalled();
    expect(harness.qboCalls).toHaveLength(0);
  });

  it("rejects model-controlled execution fields without touching QBO", () => {
    const harness = makeHarness();

    const response = runExecutionInputGuard(callBody("get_probe", "42", {
      id: "42",
      tenant_id: "organization-tenant-b",
      company_id: "company-tenant-b",
      realm_id: "realm-tenant-b",
      access_token: "attacker-token",
    }));

    expect(response.next).toBe(false);
    expect(response.status).toBe(200);
    expect(response.body?.result?.isError).toBe(true);
    expect(response.body?.result?._meta?.errorCode).toBe("MCP_TOOL_NOT_AUTHORIZED");
    expect(harness.leaseCreate).not.toHaveBeenCalled();
    expect(harness.qboCalls).toHaveLength(0);
  });

  it("enforces write scope before acquiring one lease and executing the mutation", async () => {
    const harness = makeHarness();

    const readOnly = await post(harness, "read-only", callBody("create_probe"));
    const mutation = await post(harness, "tenant-a", callBody("create_probe"));

    expect(readOnly.status).toBe(200);
    expect(readOnly.body.result?.isError).toBe(true);
    expect(mutation.status).toBe(200);
    expect(mutation.body.result?.isError).not.toBe(true);
    expect(harness.leaseCreate).toHaveBeenCalledTimes(1);
    expect(harness.qboCalls).toHaveLength(1);
    expect(harness.qboCalls[0]).toMatchObject({
      organizationId: "organization-tenant-a",
      companyId: COMPANY_A,
    });
  });

  it("returns a safe execution error when the lease provider is unavailable", async () => {
    const harness = makeHarness({ leaseError: new Error("private broker URL and token must not escape") });

    const response = await post(harness, "tenant-a", callBody("get_probe"));

    expect(response.status).toBe(200);
    expect(response.body.result?.isError).toBe(true);
    expect(response.body.result?.content?.[0]?.text).toContain("unavailable");
    expect(response.body.result?.content?.[0]?.text).not.toContain("private broker");
    expect(harness.qboCalls).toHaveLength(0);
  });
});

describe("AuthCo OAuth token verification", () => {
  const now = Math.floor(Date.now() / 1_000);
  const basePayload = {
    active: true,
    iss: ISSUER,
    aud: RESOURCE,
    client_id: "client-a",
    azp: "client-a",
    sub: "subject-a",
    scope: "quickbooks.read",
    exp: now + 600,
  };

  function verifier(payload: Record<string, unknown>): OAuthAccessTokenVerifier {
    return new OAuthAccessTokenVerifier({
      issuer: ISSUER,
      resourceUri: RESOURCE,
      introspectionUrl: "https://auth.example/introspect",
      introspectionClientId: "mcp-client",
      introspectionClientSecret: "test-secret",
      fetchImpl: jest.fn(async () => new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })),
    });
  }

  it("accepts AuthCo introspection with exact resource, finite expiry, caller identity, and no connection claim", async () => {
    const authInfo = await verifier(basePayload).verifyAccessToken("access-token");

    expect(authInfo.clientId).toBe("client-a");
    expect(authInfo.scopes).toEqual(["quickbooks.read"]);
    expect(authInfo.expiresAt).toBe(now + 600);
    expect(authInfo.resource?.href).toBe(RESOURCE);
    expect(authInfo.extra?.claims).toMatchObject({
      iss: ISSUER,
      sub: "subject-a",
      client_id: "client-a",
      aud: RESOURCE,
    });
    expect(authInfo.extra?.claims).not.toHaveProperty("https://devraftel.com/qbo_connection_id");
  });

  it("rejects wrong issuer, audience, expiry, subject, or client identity", async () => {
    for (const [label, override] of [
      ["issuer", { iss: "https://other.example/issuer" }],
      ["audience", { aud: "https://other.example/mcp" }],
      ["audience list", { aud: [RESOURCE, "https://other.example/mcp"] }],
      ["expiry", { exp: now - 1 }],
      ["subject", { sub: "" }],
      ["client", { client_id: "", azp: "" }],
    ] as const) {
      await expect(verifier({ ...basePayload, ...override }).verifyAccessToken("access-token"))
        .rejects.toThrow(/invalid|audience|expir|subject|client/i);
      expect(label).toEqual(expect.any(String));
    }
  });
});
