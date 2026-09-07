/**
 * Shared-secret authentication between the Finance worker and this server.
 *
 * The worker and the MCP server are two first-party services. One secret,
 * presented as the bearer, proves the caller is Finance; organization and
 * company still travel in per-call metadata, and Finance re-checks both when
 * it issues the Intuit lease. The OAuth introspection path is retained as
 * MCP_AUTH_MODE=oauth and must be untouched by this mode.
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import http from "node:http";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  McpServer,
  PROTOCOL_VERSION_META_KEY,
  type McpServerFactory,
  type OAuthMetadata,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import { ClaimBindingAuthorizationPolicy } from "../../src/runtime/authorization-policy";
import { createHttpApp, prepareHttpApp } from "../../src/http-server";
import {
  DEVRAFTEL_COMPANY_ID_META_KEY,
  DEVRAFTEL_ORGANIZATION_ID_META_KEY,
  RegisterTool,
} from "../../src/helpers/register-tool";
import {
  DEFAULT_ORGANIZATION_CLAIM,
  HttpConfigurationError,
  SHARED_SECRET_CLIENT_ID,
  SHARED_SECRET_ISSUER,
  authModeOf,
  loadHttpConfig,
  type HttpConfig,
} from "../../src/http-config";
import { loadOAuthMetadata } from "../../src/auth/oauth-metadata";
import type {
  ExecutionContext,
  QboClientLease,
  QboHandlerDependencies,
  RuntimeServices,
} from "../../src/runtime/contracts";
import type { ToolDefinition } from "../../src/types/tool-definition";

const RESOURCE = "https://quickbooks-mcp.example/mcp";
const SECRET = "shared-secret-long-enough-to-be-accepted-0123456789";
const ORGANIZATION = "organization-1";
const COMPANY = "00000000-0000-4000-8000-000000000001";

const oauthMetadata: OAuthMetadata = {
  issuer: "https://auth.example/issuer",
  authorization_endpoint: "https://auth.example/authorize",
  token_endpoint: "https://auth.example/token",
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "client_credentials"],
  code_challenge_methods_supported: ["S256"],
  scopes_supported: ["quickbooks.read", "quickbooks.write", "quickbooks.delete"],
};

const OAUTH_ENVIRONMENT = {
  MCP_AUTH_MODE: "oauth",
  MCP_SHARED_SECRET: undefined,
  MCP_AUTH_ISSUER: "https://auth.example/issuer",
  MCP_AUTH_METADATA_URL: "https://auth.example/.well-known/oauth-authorization-server",
  MCP_AUTH_INTROSPECTION_URL: "https://auth.example/introspect",
  MCP_AUTH_INTROSPECTION_CLIENT_ID: "quickbooks-mcp",
  MCP_AUTH_INTROSPECTION_CLIENT_SECRET: "introspection-secret",
  MCP_AUTH_ORGANIZATION_CLAIM: "https://devraftel.com/organization_id",
  MCP_AUTH_ALLOWED_CLIENT_IDS: "finance-worker",
} as const;

// ---------------------------------------------------------------------------
// loadHttpConfig
// ---------------------------------------------------------------------------

function environment(overrides: Record<string, string | undefined> = {}) {
  const base: Record<string, string | undefined> = {
    MCP_AUTH_MODE: "shared-secret",
    MCP_SHARED_SECRET: SECRET,
    MCP_RESOURCE_URI: RESOURCE,
    MCP_ALLOWED_ORIGINS: "quickbooks-mcp.example",
    QBO_EXECUTION_LEASE_PROVIDER: "finance-http",
    FINANCE_QUICKBOOKS_ENVIRONMENT: "production",
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

describe("MCP_AUTH_MODE", () => {
  it("defaults to oauth so existing deployments are unchanged", () => {
    const config = loadHttpConfig(environment({ ...OAUTH_ENVIRONMENT, MCP_AUTH_MODE: undefined }));
    expect(authModeOf(config)).toBe("oauth");
    expect(config.sharedSecret).toBeUndefined();
    expect(config.authIntrospectionUrl?.href).toBe("https://auth.example/introspect");
  });

  it("reads as oauth when a configuration predates the field", () => {
    expect(authModeOf({})).toBe("oauth");
  });

  it("rejects a value that is neither oauth nor shared-secret", () => {
    expect(
      invalidNames(() => loadHttpConfig(environment({ MCP_AUTH_MODE: "jwt" }))),
    ).toContain("MCP_AUTH_MODE");
  });
});

describe("shared-secret mode configuration", () => {
  it("needs no introspection, metadata, or client allowlist settings", () => {
    const config = loadHttpConfig(environment());
    expect(authModeOf(config)).toBe("shared-secret");
    expect(config.sharedSecret).toBe(SECRET);
    expect(config.authIntrospectionUrl).toBeUndefined();
    expect(config.authMetadataUrl).toBeUndefined();
    expect(config.authIntrospectionClientId).toBeUndefined();
    expect(config.authIntrospectionClientSecret).toBeUndefined();
  });

  it("fixes the caller identity the policy will see", () => {
    const config = loadHttpConfig(environment());
    expect(config.allowedClientIds).toEqual([SHARED_SECRET_CLIENT_ID]);
    expect(config.authIssuer).toBe(SHARED_SECRET_ISSUER);
    expect(config.authOrganizationClaim).toBe(DEFAULT_ORGANIZATION_CLAIM);
  });

  it("still honours an explicit issuer and organization claim", () => {
    const config = loadHttpConfig(
      environment({
        MCP_AUTH_ISSUER: "https://auth.example/issuer",
        MCP_AUTH_ORGANIZATION_CLAIM: "https://example.com/org",
      }),
    );
    expect(config.authIssuer).toBe("https://auth.example/issuer");
    expect(config.authOrganizationClaim).toBe("https://example.com/org");
  });

  it("requires the secret", () => {
    expect(
      invalidNames(() => loadHttpConfig(environment({ MCP_SHARED_SECRET: undefined }))),
    ).toContain("MCP_SHARED_SECRET");
  });

  it.each(["too-short", "has whitespace inside the value but is long enough"])(
    "rejects a weak secret: %s",
    (value) => {
      expect(
        invalidNames(() => loadHttpConfig(environment({ MCP_SHARED_SECRET: value }))),
      ).toContain("MCP_SHARED_SECRET");
    },
  );

  it("is exclusive with temporary unauthenticated mode", () => {
    expect(
      invalidNames(() =>
        loadHttpConfig(
          environment({
            MCP_TEMPORARY_UNAUTHENTICATED_MODE: "true",
            FINANCE_QUICKBOOKS_ENVIRONMENT: "sandbox",
          }),
        ),
      ),
    ).toContain("MCP_AUTH_MODE");
  });

  it("is allowed against production, unlike temporary mode", () => {
    const config = loadHttpConfig(environment({ FINANCE_QUICKBOOKS_ENVIRONMENT: "production" }));
    expect(config.temporaryUnauthenticatedMode).toBe(false);
  });
});

describe("oauth mode still refuses to compose without its settings", () => {
  const sharedConfig = (): HttpConfig => loadHttpConfig(environment());

  it("does not load OAuth metadata for a shared-secret configuration", async () => {
    await expect(loadOAuthMetadata(sharedConfig())).rejects.toBeInstanceOf(
      HttpConfigurationError,
    );
  });

  it("refuses an oauth-mode app whose introspection settings are missing", () => {
    const config: HttpConfig = { ...sharedConfig(), authMode: "oauth" };
    expect(() =>
      createHttpApp({
        config,
        oauthMetadata,
        services: services().services,
        serverFactory: () => new McpServer({ name: "x", version: "x" }),
      }),
    ).toThrow(HttpConfigurationError);
  });

  it("refuses an oauth-mode app that has no authorization-server metadata to publish", () => {
    const config = loadHttpConfig(environment(OAUTH_ENVIRONMENT));
    expect(() =>
      createHttpApp({
        config,
        tokenVerifier: { verifyAccessToken: async () => { throw new Error("unused"); } },
        services: services().services,
        serverFactory: () => new McpServer({ name: "x", version: "x" }),
      }),
    ).toThrow(HttpConfigurationError);
  });
});

// ---------------------------------------------------------------------------
// The HTTP boundary, driven over a real listener
// ---------------------------------------------------------------------------

function services() {
  const executions: ExecutionContext[] = [];
  const leaseCreate = jest.fn(
    async (execution: ExecutionContext): Promise<QboClientLease> => {
      executions.push(execution);
      const qbo = {
        getAccount: (id: string, callback: (error: null, value: unknown) => void) =>
          callback(null, { Id: id }),
      };
      return {
        qbo: qbo as never,
        rawQbo: { accessToken: "access", realmId: "realm", environment: "production" },
        qboConnectionId: "connection",
        leaseId: "lease",
        expiresAt: new Date(Date.now() + 60_000),
        close: jest.fn(async () => undefined),
      };
    },
  );
  const config = loadHttpConfig(environment());
  const runtime: RuntimeServices = {
    qboClientFactory: { create: leaseCreate },
    authorizationPolicy: new ClaimBindingAuthorizationPolicy({
      issuer: config.authIssuer,
      organizationClaim: config.authOrganizationClaim,
      allowedClientIds: config.allowedClientIds,
    }),
  };
  return { services: runtime, executions, config };
}

type Harness = { origin: string; executions: ExecutionContext[]; close: () => Promise<void> };
const openHarnesses: Harness[] = [];

function probeServerFactory(runtime: RuntimeServices): McpServerFactory {
  const schema = z.object({ id: z.string().min(1) });
  const definition: ToolDefinition<typeof schema> = {
    name: "get_probe",
    description: "read test probe",
    schema,
    authority: "read",
    handler: async (
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
    },
  };
  return () => {
    const server = new McpServer(
      { name: "shared-secret test server", version: "test" },
      { capabilities: { tools: {} } },
    );
    RegisterTool(server, definition, runtime);
    return server;
  };
}

async function listen(app: { app: http.RequestListener; closeHandler: () => Promise<void> }, executions: ExecutionContext[]): Promise<Harness> {
  const server = http.createServer(app.app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const harness: Harness = {
    origin: `http://127.0.0.1:${address.port}`,
    executions,
    close: async () => {
      await app.closeHandler();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  openHarnesses.push(harness);
  return harness;
}

async function makeHarness(): Promise<Harness> {
  const { services: runtime, executions, config } = services();
  const app = createHttpApp({
    config: { ...config, listenHost: "127.0.0.1", allowedHosts: ["127.0.0.1"], allowedOrigins: ["127.0.0.1"] },
    services: runtime,
    serverFactory: probeServerFactory(runtime),
    toolAuthority: (name: string) => (name === "get_probe" ? "read" : undefined),
    logger: () => undefined,
  });
  app.setReady(true);
  return listen(app, executions);
}

afterEach(async () => {
  while (openHarnesses.length > 0) await openHarnesses.pop()?.close();
});

function headers(bearer?: string, method = "tools/call"): Record<string, string> {
  return {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": "2026-07-28",
    "Mcp-Method": method,
    ...(method === "tools/call" ? { "Mcp-Name": "get_probe" } : {}),
    ...(bearer !== undefined ? { Authorization: `Bearer ${bearer}` } : {}),
  };
}

// `null` omits the organization; a default parameter cannot express that,
// because passing `undefined` selects the default.
function callBody(organizationId: string | null = ORGANIZATION) {
  return {
    jsonrpc: "2.0",
    id: "1",
    method: "tools/call",
    params: {
      name: "get_probe",
      arguments: { id: "42" },
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
        [CLIENT_INFO_META_KEY]: { name: "shared-secret-test-client", version: "test" },
        [CLIENT_CAPABILITIES_META_KEY]: {},
        [DEVRAFTEL_COMPANY_ID_META_KEY]: COMPANY,
        ...(organizationId ? { [DEVRAFTEL_ORGANIZATION_ID_META_KEY]: organizationId } : {}),
      },
    },
  };
}

async function post(harness: Harness, body: unknown, bearer?: string, method = "tools/call") {
  const response = await fetch(`${harness.origin}/mcp`, {
    method: "POST",
    headers: headers(bearer, method),
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    challenge: response.headers.get("www-authenticate"),
    body: text ? JSON.parse(text) : undefined,
  };
}

describe("shared-secret HTTP boundary", () => {
  it("refuses a request with no bearer", async () => {
    const harness = await makeHarness();
    const result = await post(harness, callBody());
    expect(result.status).toBe(401);
    expect(result.challenge).toContain('error="invalid_token"');
    expect(harness.executions).toHaveLength(0);
  });

  it("refuses a wrong secret, including one of the same length", async () => {
    const harness = await makeHarness();
    const sameLength = "x".repeat(SECRET.length);
    for (const wrong of ["not-the-secret", sameLength, `${SECRET}x`]) {
      const result = await post(harness, callBody(), wrong);
      expect(result.status).toBe(401);
    }
    expect(harness.executions).toHaveLength(0);
  });

  it("refuses a non-bearer authorization scheme", async () => {
    const harness = await makeHarness();
    const response = await fetch(`${harness.origin}/mcp`, {
      method: "POST",
      headers: { ...headers(), Authorization: `Basic ${Buffer.from(SECRET).toString("base64")}` },
      body: JSON.stringify(callBody()),
    });
    expect(response.status).toBe(401);
  });

  it("executes a tool call as finance-worker for the organization in metadata", async () => {
    const harness = await makeHarness();
    const result = await post(harness, callBody(), SECRET);
    expect(result.status).toBe(200);
    expect(harness.executions).toHaveLength(1);
    expect(harness.executions[0].oauthClientId).toBe(SHARED_SECRET_CLIENT_ID);
    expect(harness.executions[0].organizationId).toBe(ORGANIZATION);
    expect(harness.executions[0].companyId).toBe(COMPANY);
  });

  it("authenticates without organization metadata, then refuses at the execution seam", async () => {
    // The bearer gate never demands an organization (the binding middleware is
    // pass-through, as in temporary mode); the execution seam still does.
    const harness = await makeHarness();
    const result = await post(harness, callBody(null), SECRET);
    expect(result.status).not.toBe(401);
    expect(harness.executions).toHaveLength(0);
  });
});

describe("prepareHttpApp in shared-secret mode", () => {
  it("composes without fetching OAuth metadata", async () => {
    const { services: runtime, config } = services();
    const prepared = await prepareHttpApp({
      config,
      services: runtime,
      serverFactory: probeServerFactory(runtime),
      toolAuthority: (name: string) => (name === "get_probe" ? "read" : undefined),
      fetchImpl: (async () => {
        throw new Error("no network call is expected in shared-secret mode");
      }) as unknown as typeof fetch,
    });
    expect(prepared.config.sharedSecret).toBe(SECRET);
    await prepared.close();
  });
});
