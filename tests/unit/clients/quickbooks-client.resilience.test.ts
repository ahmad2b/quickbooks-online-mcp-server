import { describe, expect, it, jest } from "@jest/globals";
import { RequestScopedQboClientFactory, QboExecutionError } from "../../../src/clients/quickbooks-client";
import { FinanceExecutionLeaseProvider } from "../../../src/adapters/finance-execution-lease-provider";
import type {
  ExecutionContext,
  QboExecutionLease,
  QboExecutionLeaseProvider,
} from "../../../src/runtime/contracts";

const context: ExecutionContext = Object.freeze({
  requestId: "request-1",
  issuer: "https://issuer.example",
  subjectId: "user-1",
  oauthClientId: "client-1",
  organizationId: "org-1",
  companyId: "00000000-0000-4000-8000-000000000001",
  scopes: new Set<"quickbooks.read">(["quickbooks.read"]),
});

function lease(overrides: Partial<QboExecutionLease> = {}): QboExecutionLease {
  return {
    leaseId: "lease-1",
    qboConnectionId: "connection-1",
    accessToken: "access-1",
    realmId: "realm-1",
    environment: "sandbox",
    expiresAt: new Date(Date.now() + 60_000),
    credentialVersion: "credential-1",
    ...overrides,
  };
}

function provider(result: QboExecutionLease | Error): QboExecutionLeaseProvider {
  return {
    acquire: jest.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

describe("RequestScopedQboClientFactory", () => {
  it("creates a fresh SDK/raw pair from a matching short-lived lease", async () => {
    const constructed: unknown[][] = [];
    class FakeQuickBooks {
      constructor(...args: unknown[]) {
        constructed.push(args);
      }
    }
    const factory = new RequestScopedQboClientFactory(provider(lease()), {
      QuickBooksConstructor: FakeQuickBooks as never,
      now: () => Date.now(),
    });

    const result = await factory.create(context);

    expect(constructed).toHaveLength(1);
    expect(constructed[0]?.slice(0, 5)).toEqual(["", "", "access-1", false, "realm-1"]);
    expect(result.rawQbo).toEqual({
      accessToken: "access-1",
      realmId: "realm-1",
      environment: "sandbox",
    });
    await result.close();
    await result.close();
  });

  it("uses the trusted provider lease connection without requiring a connection claim", async () => {
    const acquire = jest.fn<QboExecutionLeaseProvider["acquire"]>(async (_context) =>
      lease({ qboConnectionId: "connection-2" }));
    const factory = new RequestScopedQboClientFactory({
      acquire,
    });
    await factory.create(context);
    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      subjectId: "user-1",
    }));
    expect(acquire.mock.calls[0]?.[0]).not.toHaveProperty("qboConnectionId");
  });

  it("rejects expired and near-expiry leases", async () => {
    const expired = new RequestScopedQboClientFactory(
      provider(lease({ expiresAt: new Date(1_000) })),
      { now: () => 1_000, leaseSafetyMarginMs: 5_000 },
    );
    await expect(expired.create(context)).rejects.toBeInstanceOf(QboExecutionError);
  });

  it("turns broker failures into a stable unavailable error", async () => {
    const factory = new RequestScopedQboClientFactory(provider(new Error("network details")));
    await expect(factory.create(context)).rejects.toMatchObject({ code: "QBO_EXECUTION_LEASE_UNAVAILABLE" });
  });

  it("calls an optional provider release exactly once", async () => {
    const release = jest.fn(async () => undefined);
    const leaseProvider: QboExecutionLeaseProvider = {
      acquire: async () => lease(),
      release,
    };
    class FakeQuickBooks {}
    const factory = new RequestScopedQboClientFactory(leaseProvider, {
      QuickBooksConstructor: FakeQuickBooks as never,
    });
    const result = await factory.create(context);
    await result.close();
    await result.close();
    expect(release).toHaveBeenCalledTimes(1);
  });
});


const CONNECTION_ID = "00000000-0000-4000-8000-000000000002";
const LEASE_ID = "00000000-0000-4000-8000-000000000003";
const WORKLOAD_TOKEN = "finance-workload-token-with-32-characters";

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function leaseBindingResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    organization_id: context.organizationId,
    company_id: context.companyId,
    qbo_connection_id: CONNECTION_ID,
    environment: "sandbox",
    credential_version: "7",
    ...overrides,
  };
}

function leaseResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...leaseBindingResponse(),
    lease_id: LEASE_ID,
    access_token: "temporary-intuit-access-token",
    realm_id: "realm-123",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

describe("FinanceExecutionLeaseProvider", () => {
  it("uses only workload auth and verified execution metadata for one lease call", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return jsonResponse(leaseResponse());
    }) as unknown as typeof fetch;
    const provider = new FinanceExecutionLeaseProvider({
      baseUrl: "http://finance.internal/",
      workloadToken: WORKLOAD_TOKEN,
      environment: "sandbox",
      fetchImpl,
    });

    await expect(provider.acquire(context)).resolves.toMatchObject({
      leaseId: LEASE_ID,
      qboConnectionId: CONNECTION_ID,
      accessToken: "temporary-intuit-access-token",
      realmId: "realm-123",
      environment: "sandbox",
      credentialVersion: "7",
    });

    expect(calls).toHaveLength(1);
    for (const call of calls) {
      const headers = call.init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${WORKLOAD_TOKEN}`);
      const body = JSON.parse(String(call.init.body)) as Record<string, any>;
      expect(body).toMatchObject({
        request_id: context.requestId,
        organization_id: context.organizationId,
        company_id: context.companyId,
        environment: "sandbox",
      });
      expect(body).not.toHaveProperty("access_token");
      expect(body).not.toHaveProperty("refresh_token");
      expect(body.caller.scopes).toEqual(["quickbooks.read"]);
    }
  });

  it("rejects tenant mismatches and forbidden credential-bearing response fields", async () => {
    const mismatchedFetch = jest.fn(async () => jsonResponse(leaseResponse({
      company_id: "00000000-0000-4000-8000-000000000099",
    }))) as unknown as typeof fetch;
    const mismatched = new FinanceExecutionLeaseProvider({
      baseUrl: "http://finance.internal/",
      workloadToken: WORKLOAD_TOKEN,
      environment: "sandbox",
      fetchImpl: mismatchedFetch,
    });
    await expect(mismatched.acquire(context)).rejects.toMatchObject({
      code: "QBO_EXECUTION_LEASE_INVALID",
    });

    const forbiddenFetch = jest.fn(async () => jsonResponse(leaseResponse({
      refresh_token: "must-never-cross-the-boundary",
    }))) as unknown as typeof fetch;
    const forbidden = new FinanceExecutionLeaseProvider({
      baseUrl: "http://finance.internal/",
      workloadToken: WORKLOAD_TOKEN,
      environment: "sandbox",
      fetchImpl: forbiddenFetch,
    });
    await expect(forbidden.acquire(context)).rejects.toMatchObject({
      code: "QBO_EXECUTION_LEASE_INVALID",
    });
  });

  it("maps broker failures to a safe unavailable error without retrying", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ error: "private detail" }, 503)) as unknown as typeof fetch;
    const provider = new FinanceExecutionLeaseProvider({
      baseUrl: "http://finance.internal/",
      workloadToken: WORKLOAD_TOKEN,
      environment: "sandbox",
      fetchImpl,
    });

    await expect(provider.acquire(context)).rejects.toMatchObject({
      code: "QBO_EXECUTION_LEASE_UNAVAILABLE",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
