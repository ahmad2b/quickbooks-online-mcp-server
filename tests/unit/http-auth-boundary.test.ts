import { afterEach, describe, expect, it, jest } from "@jest/globals";
import http from "node:http";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  McpServer,
  OAuthError,
  OAuthErrorCode,
  PROTOCOL_VERSION_META_KEY,
  type AuthInfo,
  type McpServerFactory,
  type OAuthMetadata,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import { ClaimBindingAuthorizationPolicy } from "../../src/runtime/authorization-policy";
import { createHttpApp } from "../../src/http-server";
import {
  DEVRAFTEL_COMPANY_ID_META_KEY,
  RegisterTool,
} from "../../src/helpers/register-tool";
import { HttpConfigurationError, loadHttpConfig } from "../../src/http-config";
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
const ORGANIZATION_CLAIM = "https://devraftel.com/organization_id";
const FINANCE_WORKER = "finance-worker";
const COMPANY = "00000000-0000-4000-8000-000000000001";

const oauthMetadata: OAuthMetadata = {
  issuer: ISSUER,
  authorization_endpoint: "https://auth.example/authorize",
  token_endpoint: "https://auth.example/token",
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "client_credentials"],
  code_challenge_methods_supported: ["S256"],
  scopes_supported: ["quickbooks.read", "quickbooks.write", "quickbooks.delete"],
};

// ---------------------------------------------------------------------------
// loadHttpConfig
// ---------------------------------------------------------------------------

function environment(overrides: Record<string, string | undefined> = {}) {
  const base: Record<string, string | undefined> = {
    MCP_RESOURCE_URI: RESOURCE,
    MCP_AUTH_ISSUER: ISSUER,
    MCP_AUTH_METADATA_URL:
      "https://auth.example/.well-known/oauth-authorization-server",
    MCP_AUTH_INTROSPECTION_URL: "https://auth.example/introspect",
    MCP_AUTH_INTROSPECTION_CLIENT_ID: "quickbooks-mcp",
    MCP_AUTH_INTROSPECTION_CLIENT_SECRET: "introspection-secret",
    MCP_AUTH_ORGANIZATION_CLAIM: ORGANIZATION_CLAIM,
    MCP_AUTH_ALLOWED_CLIENT_IDS: FINANCE_WORKER,
    MCP_ALLOWED_ORIGINS: "quickbooks-mcp.example",
    QBO_EXECUTION_LEASE_PROVIDER: "finance-http",
    ...overrides,
  };
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) delete base[key];
  }
  return base as NodeJS.ProcessEnv;
}

function invalidNames(run: () => unknown): readonly string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof HttpConfigurationError) return error.missingOrInvalid;
    throw error;
  }
  throw new Error("Expected the configuration to be rejected.");
}

describe("MCP_AUTH_ALLOWED_CLIENT_IDS", () => {
  it("parses a comma-separated list, trimming and dropping blanks", () => {
    const config = loadHttpConfig(
      environment({
        MCP_AUTH_ALLOWED_CLIENT_IDS: ` ${FINANCE_WORKER} , second-worker ,,`,
      }),
    );
    expect(config.allowedClientIds).toEqual([FINANCE_WORKER, "second-worker"]);
  });

  it("is required when the server authenticates callers", () => {
    expect(
      invalidNames(() =>
        loadHttpConfig(
          environment({ MCP_AUTH_ALLOWED_CLIENT_IDS: undefined }),
        ),
      ),
    ).toContain("MCP_AUTH_ALLOWED_CLIENT_IDS");
  });

  it("rejects a list that is present but empty", () => {
    expect(
      invalidNames(() =>
        loadHttpConfig(environment({ MCP_AUTH_ALLOWED_CLIENT_IDS: " , , " })),
      ),
    ).toContain("MCP_AUTH_ALLOWED_CLIENT_IDS");
  });

  it("rejects a wildcard, which would defeat the allowlist", () => {
    expect(
      invalidNames(() =>
        loadHttpConfig(environment({ MCP_AUTH_ALLOWED_CLIENT_IDS: "*" })),
      ),
    ).toContain("MCP_AUTH_ALLOWED_CLIENT_IDS");
  });

  it("is not required in temporary unauthenticated mode, which has no callers to allow", () => {
    const config = loadHttpConfig(
      environment({
        MCP_AUTH_ALLOWED_CLIENT_IDS: undefined,
        MCP_TEMPORARY_UNAUTHENTICATED_MODE: "true",
        FINANCE_QUICKBOOKS_ENVIRONMENT: "sandbox",
      }),
    );
    expect(config.allowedClientIds).toEqual([]);
    expect(config.temporaryUnauthenticatedMode).toBe(true);
  });
});

describe("temporary unauthenticated mode guard", () => {
  it("is allowed only against the Intuit sandbox", () => {
    for (const value of ["production", undefined, "Sandbox-ish"]) {
      expect(
        invalidNames(() =>
          loadHttpConfig(
            environment({
              MCP_TEMPORARY_UNAUTHENTICATED_MODE: "true",
              FINANCE_QUICKBOOKS_ENVIRONMENT: value,
            }),
          ),
        ),
      ).toContain("FINANCE_QUICKBOOKS_ENVIRONMENT");
    }
  });

  it("accepts sandbox regardless of casing", () => {
    const config = loadHttpConfig(
      environment({
        MCP_TEMPORARY_UNAUTHENTICATED_MODE: "true",
        FINANCE_QUICKBOOKS_ENVIRONMENT: " SANDBOX ",
      }),
    );
    expect(config.temporaryUnauthenticatedMode).toBe(true);
  });

  it("defaults to off, which needs no sandbox", () => {
    const config = loadHttpConfig(
      environment({ FINANCE_QUICKBOOKS_ENVIRONMENT: "production" }),
    );
    expect(config.temporaryUnauthenticatedMode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HTTP authorization boundary, driven over a real listener
// ---------------------------------------------------------------------------

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
    qboExecutionLeaseProvider: "test-lease-provider",
    ...overrides,
  };
}

type Token = {
  clientId: string;
  subject?: string;
  scopes?: string[];
  organizationId?: string | null;
};

const TOKENS: Record<string, Token> = {
  // The Finance worker: a machine token whose subject is its own client id.
  "finance-worker-token": { clientId: FINANCE_WORKER },
  "read-only-token": { clientId: FINANCE_WORKER, scopes: ["quickbooks.read"] },
  "no-scope-token": { clientId: FINANCE_WORKER, scopes: [] },
  "no-organization-token": { clientId: FINANCE_WORKER, organizationId: null },
  "third-party-token": { clientId: "third-party-connector" },
};

function authInfoFor(name: string): AuthInfo {
  const token = TOKENS[name];
  return {
    token: name,
    clientId: token.clientId,
    scopes: token.scopes ?? ["quickbooks.read", "quickbooks.write"],
    expiresAt: Math.floor(Date.now() / 1_000) + 600,
    resource: new URL(RESOURCE),
    extra: {
      claims: {
        iss: ISSUER,
        sub: token.subject ?? token.clientId,
        client_id: token.clientId,
        ...(token.organizationId === null
          ? {}
          : { [ORGANIZATION_CLAIM]: token.organizationId ?? "organization-1" }),
      },
    },
  };
}

type Harness = {
  origin: string;
  executions: ExecutionContext[];
  logs: Record<string, unknown>[];
  close: () => Promise<void>;
};

const openHarnesses: Harness[] = [];

async function makeHarness(
  overrides: Partial<HttpConfig> = {},
): Promise<Harness> {
  const executions: ExecutionContext[] = [];
  const leaseCreate = jest.fn(
    async (execution: ExecutionContext): Promise<QboClientLease> => {
      executions.push(execution);
      const qbo = {
        getAccount: (
          id: string,
          callback: (error: null, value: unknown) => void,
        ) => callback(null, { Id: id }),
      };
      return {
        qbo: qbo as never,
        rawQbo: {
          accessToken: "access",
          realmId: "realm",
          environment: "sandbox",
        },
        qboConnectionId: "connection",
        leaseId: "lease",
        expiresAt: new Date(Date.now() + 60_000),
        close: jest.fn(async () => undefined),
      };
    },
  );
  const logs: Record<string, unknown>[] = [];
  const httpConfig = config(overrides);
  const services: RuntimeServices = {
    qboClientFactory: { create: leaseCreate },
    authorizationPolicy: new ClaimBindingAuthorizationPolicy({
      issuer: httpConfig.authIssuer,
      organizationClaim: httpConfig.authOrganizationClaim,
      allowedClientIds: httpConfig.allowedClientIds,
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
      qbo.getAccount(params.id, (_error, value) =>
        resolve({ content: [{ type: "text" as const, text: JSON.stringify(value) }] }),
      );
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
  const serverFactory: McpServerFactory = () => {
    const server = new McpServer(
      { name: "HTTP auth boundary test server", version: "test" },
      { capabilities: { tools: {} } },
    );
    RegisterTool(server, readDefinition, services);
    RegisterTool(server, writeDefinition, services);
    return server;
  };

  const app = createHttpApp({
    config: httpConfig,
    oauthMetadata,
    tokenVerifier: {
      verifyAccessToken: async (token: string) => {
        if (!(token in TOKENS)) {
          throw new OAuthError(
            OAuthErrorCode.InvalidToken,
            "The access token is not recognized",
          );
        }
        return authInfoFor(token);
      },
    },
    serverFactory,
    services,
    toolAuthority: (name: string) =>
      name === "get_probe" ? "read" : name === "create_probe" ? "write" : undefined,
    logger: (entry) => {
      logs.push(entry as Record<string, unknown>);
    },
  });
  app.setReady(true);

  const server = http.createServer(app.app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The test server did not bind a port.");
  }
  const harness: Harness = {
    origin: `http://127.0.0.1:${address.port}`,
    executions,
    logs,
    close: async () => {
      await app.closeHandler();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  openHarnesses.push(harness);
  return harness;
}

afterEach(async () => {
  while (openHarnesses.length > 0) {
    await openHarnesses.pop()?.close();
  }
});

function callBody(name = "get_probe") {
  return {
    jsonrpc: "2.0",
    id: "1",
    method: "tools/call",
    params: {
      name,
      arguments: { id: "42" },
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
        [CLIENT_INFO_META_KEY]: { name: "auth-boundary-test-client", version: "test" },
        [CLIENT_CAPABILITIES_META_KEY]: {},
        [DEVRAFTEL_COMPANY_ID_META_KEY]: COMPANY,
      },
    },
  };
}

async function call(
  harness: Harness,
  options: { token?: string; name?: string } = {},
): Promise<{ status: number; challenge: string | null; body: unknown }> {
  const response = await fetch(`${harness.origin}/mcp`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/call",
      "Mcp-Name": options.name ?? "get_probe",
      ...(options.token
        ? { Authorization: `Bearer ${options.token}` }
        : {}),
    },
    body: JSON.stringify(callBody(options.name)),
  });
  const text = await response.text();
  return {
    status: response.status,
    challenge: response.headers.get("www-authenticate"),
    body: text ? JSON.parse(text) : undefined,
  };
}

function refusalReason(body: unknown): unknown {
  if (!body || typeof body !== "object") return undefined;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return undefined;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return undefined;
  return (data as { reason?: unknown }).reason;
}

describe("the MCP authorization boundary", () => {
  it("answers a missing bearer with 401 and a WWW-Authenticate challenge", async () => {
    const harness = await makeHarness();
    const response = await call(harness);
    expect(response.status).toBe(401);
    expect(response.challenge).toContain("Bearer");
    expect(response.challenge).toContain("resource_metadata=");
  });

  it("answers an invalid bearer with 401 and a WWW-Authenticate challenge", async () => {
    const harness = await makeHarness();
    const response = await call(harness, { token: "not-a-real-token" });
    expect(response.status).toBe(401);
    expect(response.challenge).toContain("invalid_token");
  });

  it("refuses a client that is not on the allowlist with 403 and says why", async () => {
    const harness = await makeHarness();
    const response = await call(harness, { token: "third-party-token" });
    expect(response.status).toBe(403);
    expect(refusalReason(response.body)).toBe("client_not_allowed");
    expect(harness.executions).toHaveLength(0);
  });

  it("refuses a token with no organization claim with 403 and says why", async () => {
    const harness = await makeHarness();
    const response = await call(harness, { token: "no-organization-token" });
    expect(response.status).toBe(403);
    expect(refusalReason(response.body)).toBe("missing_organization");
    expect(harness.executions).toHaveLength(0);
  });

  it("keeps the reason a machine-readable code, not prose", async () => {
    const harness = await makeHarness();
    const response = await call(harness, { token: "third-party-token" });
    const error = (response.body as { error: { message: string } }).error;
    // The operator-facing distinction lives in `data.reason`; the message
    // stays one generic sentence so it says nothing about the caller.
    expect(error.message).not.toContain("client_not_allowed");
    expect(error.message).toBe("The caller is not authorized for this resource");
  });

  it("records the refusal reason in the request log", async () => {
    const harness = await makeHarness();
    await call(harness, { token: "third-party-token" });

    const entry = harness.logs.find(
      (line) => line.event === "mcp_request" && line.status === 403,
    );
    expect(entry).toBeDefined();
    expect(entry?.authorizationRefusal).toBe("client_not_allowed");
  });

  it("logs no refusal reason when the caller is allowed", async () => {
    const harness = await makeHarness();
    await call(harness, { token: "finance-worker-token" });

    const entry = harness.logs.find((line) => line.event === "mcp_request");
    expect(entry?.status).toBe(200);
    expect(entry).not.toHaveProperty("authorizationRefusal");
  });

  it("refuses a scope shortfall with 403 and names the scopes it wanted", async () => {
    const harness = await makeHarness();
    const response = await call(harness, {
      token: "read-only-token",
      name: "create_probe",
    });
    expect(response.status).toBe(403);
    expect(response.challenge).toContain("insufficient_scope");
    expect(response.challenge).toContain("quickbooks.write");
    expect(harness.executions).toHaveLength(0);
  });

  it("refuses a token that does not even carry the baseline read scope", async () => {
    const harness = await makeHarness();
    const response = await call(harness, { token: "no-scope-token" });
    expect(response.status).toBe(403);
    expect(response.challenge).toContain("insufficient_scope");
  });

  it("lets the finance worker's machine token through to the lease", async () => {
    const harness = await makeHarness();
    const response = await call(harness, { token: "finance-worker-token" });

    expect(response.status).toBe(200);
    expect(harness.executions).toHaveLength(1);
    const execution = harness.executions[0];
    expect(execution.organizationId).toBe("organization-1");
    expect(execution.companyId).toBe(COMPANY);
    expect(execution.oauthClientId).toBe(FINANCE_WORKER);
    // No human on the badge: the subject is the worker's own client id.
    expect(execution.subjectId).toBe(FINANCE_WORKER);
    expect(execution.issuer).toBe(ISSUER);
  });
});
