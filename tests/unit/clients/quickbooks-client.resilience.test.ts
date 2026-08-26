import { describe, expect, it, jest } from "@jest/globals";
import { RequestScopedQboClientFactory, QboExecutionError } from "../../../src/clients/quickbooks-client";
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
  qboConnectionId: "connection-1",
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

  it("rejects a lease for another connection before constructing a client", async () => {
    const factory = new RequestScopedQboClientFactory(provider(lease({ qboConnectionId: "connection-2" })));
    await expect(factory.create(context)).rejects.toMatchObject({ code: "QBO_EXECUTION_LEASE_INVALID" });
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
    const leaseProvider: QboExecutionLeaseProvider = { acquire: async () => lease(), release };
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
