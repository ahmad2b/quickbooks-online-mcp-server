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
import { RegisterTool } from "../../src/helpers/register-tool";
import type {
  ExecutionContext,
  OperationLedger,
  QboClientLease,
  QboHandlerDependencies,
  RateLimiter,
  RuntimeServices,
} from "../../src/runtime/contracts";
import type { HttpConfig } from "../../src/http-config";
import type { ToolDefinition } from "../../src/types/tool-definition";

const RESOURCE = "https://quickbooks-mcp.example/mcp";
const ISSUER = "https://auth.example/issuer";
const ORGANIZATION_CLAIM = "https://claims.example/organization";
const CONNECTION_CLAIM = "https://claims.example/qbo-connection";

type FakeToken = {
  tenant: string;
  resource?: string;
  scopes?: string[];
  omitOrganization?: boolean;
  omitConnection?: boolean;
};

type QboCall = {
  id: string;
  organizationId: string;
  qboConnectionId: string;
  realmId: string;
  accessToken: string;
};

type Harness = {
  app: ReturnType<typeof createHttpApp>;
  leaseCreate: jest.MockedFunction<(execution: ExecutionContext) => Promise<QboClientLease>>;
  qboCalls: QboCall[];
  rateConsume: jest.MockedFunction<RateLimiter["consume"]>;
  ledger: OperationLedger;
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
  const key = Buffer.alloc(32, 7).toString("base64");
  return {
    resourceUri: new URL(RESOURCE),
    authIssuer: ISSUER,
    authMetadataUrl: new URL("https://auth.example/.well-known/oauth-authorization-server"),
    authJwksUrl: new URL("https://auth.example/jwks"),
    listenHost: "127.0.0.1",
    listenPort: 0,
    allowedHosts: ["127.0.0.1"],
    allowedOrigins: ["127.0.0.1"],
    bodyLimit: "1mb",
    requestTimeoutMs: 2_000,
    rateLimitPerMinute: 100,
    requestStateKey: key,
    operationFingerprintKey: key,
    operationFingerprintKeyVersion: "test-v1",
    authOrganizationClaim: ORGANIZATION_CLAIM,
    authConnectionClaim: CONNECTION_CLAIM,
    qboExecutionLeaseProvider: "test-lease-provider",
    operationLedgerProvider: "test-ledger-provider",
    rateLimitProvider: "test-rate-provider",
    workloadIdentity: "test-workload",
  };
}

function tokenInfo(token: FakeToken): AuthInfo {
  const clientId = `client-${token.tenant}`;
  const claims: Record<string, unknown> = {
    iss: ISSUER,
    sub: `subject-${token.tenant}`,
    client_id: clientId,
    ...(token.omitOrganization ? {} : { [ORGANIZATION_CLAIM]: `organization-${token.tenant}` }),
    ...(token.omitConnection ? {} : { [CONNECTION_CLAIM]: `connection-${token.tenant}` }),
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
    const accessToken = `access-${execution.qboConnectionId}`;
    const realmId = `realm-${execution.qboConnectionId}`;
    const qbo = {
      getAccount: (id: string, callback: (error: null, value: unknown) => void) => {
        qboCalls.push({
          id,
          organizationId: execution.organizationId,
          qboConnectionId: execution.qboConnectionId,
          realmId,
          accessToken,
        });
        callback(null, { Id: id, RealmId: realmId });
      },
    };
    return {
      qbo: qbo as never,
      rawQbo: { accessToken, realmId, environment: "sandbox" },
      leaseId: `lease-${execution.qboConnectionId}`,
      expiresAt: new Date(Date.now() + 60_000),
      close: jest.fn(async () => undefined),
    };
  });
  const rateConsume = jest.fn(async () => ({ allowed: true, retryAfterSeconds: 0 }));
  const ledger: OperationLedger = {
    prepare: jest.fn(async (operation: Parameters<OperationLedger["prepare"]>[0]) => ({ created: true, operationId: operation.id, status: "prepared" as const })),
    transition: jest.fn(async () => true),
    recoverStale: jest.fn(async () => 0),
  };
  const services: RuntimeServices = {
    qboClientFactory: { create: leaseCreate },
    rateLimiter: { consume: rateConsume } as RateLimiter,
    authorizationPolicy: new ClaimBindingAuthorizationPolicy({
      issuer: ISSUER,
      organizationClaim: ORGANIZATION_CLAIM,
      connectionClaim: CONNECTION_CLAIM,
    }),
    operationLedger: ledger,
    operationFingerprint: { key: Buffer.alloc(32, 11), keyVersion: "test-v1" },
    requestStateCodec: {
      mint: jest.fn(async () => "signed-test-state"),
      verify: jest.fn(async () => ({ operationId: "operation", toolName: "create_probe", inputFingerprint: "fingerprint" })),
    },
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
      if (token === "missing-connection") return tokenInfo({ tenant: "a", omitConnection: true });
      return tokenInfo({ tenant: token, scopes: token === "read-only" ? ["quickbooks.read"] : ["quickbooks.read", "quickbooks.write"] });
    });
  const serverFactory: McpServerFactory = () => {
    const server = new McpServer(
      { name: "HTTP execution test server", version: "test" },
      {
        capabilities: { tools: {} },
        requestState: { verify: services.requestStateCodec.verify },
      },
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
  return { app, leaseCreate, qboCalls, rateConsume, ledger, verifyAccessToken };
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

function callBody(name: string, id = "42", argumentsOverride?: Record<string, unknown>) {
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
        [CLIENT_CAPABILITIES_META_KEY]: { elicitation: { form: {} } },
      },
    },
  };
}

afterEach(async () => undefined);

describe("authenticated HTTP execution seam", () => {
  it("keeps concurrent organization/connection/realm mappings request-scoped", async () => {
    const harness = makeHarness();

    const [tenantA, tenantB] = await Promise.all([
      post(harness, "tenant-a", callBody("get_probe", "a")),
      post(harness, "tenant-b", callBody("get_probe", "b")),
    ]);

    expect(tenantA.status).toBe(200);
    expect(tenantB.status).toBe(200);
    expect(harness.qboCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "a", organizationId: "organization-tenant-a", qboConnectionId: "connection-tenant-a", realmId: "realm-connection-tenant-a", accessToken: "access-connection-tenant-a" }),
      expect.objectContaining({ id: "b", organizationId: "organization-tenant-b", qboConnectionId: "connection-tenant-b", realmId: "realm-connection-tenant-b", accessToken: "access-connection-tenant-b" }),
    ]));
    expect(harness.leaseCreate).toHaveBeenCalledTimes(2);
  });

  it("denies missing grants and tokens issued for another resource before lease acquisition", async () => {
    const harness = makeHarness();

    const missingOrganization = await post(harness, "missing-organization", callBody("get_probe"));
    const missingConnection = await post(harness, "missing-connection", callBody("get_probe"));

    expect(missingOrganization.status).toBe(200);
    expect(missingConnection.status).toBe(200);
    expect(missingOrganization.body.result?.isError).toBe(true);
    expect(missingConnection.body.result?.isError).toBe(true);
    expect(harness.leaseCreate).not.toHaveBeenCalled();
    expect(harness.qboCalls).toHaveLength(0);
    expect(harness.rateConsume).not.toHaveBeenCalled();
  });

  it("rejects model-controlled execution fields without touching QBO", () => {
    const harness = makeHarness();

    const response = runExecutionInputGuard(callBody("get_probe", "42", {
      id: "42",
      tenant_id: "organization-tenant-b",
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

  it("enforces write scope before lease acquisition and starts mutations with MRTR", async () => {
    const harness = makeHarness();

    const readOnly = await post(harness, "read-only", callBody("create_probe"));
    const mutation = await post(harness, "tenant-a", callBody("create_probe"));

    expect(readOnly.status).toBe(200);
    expect(readOnly.body.result?.isError).toBe(true);
    expect(mutation.status).toBe(200);
    expect(mutation.body.result?.resultType ?? mutation.body.result?.structuredContent?.resultType).toBe("input_required");
    expect(harness.leaseCreate).not.toHaveBeenCalled();
    expect(harness.qboCalls).toHaveLength(0);
    expect(harness.ledger.prepare).toHaveBeenCalledTimes(1);
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
