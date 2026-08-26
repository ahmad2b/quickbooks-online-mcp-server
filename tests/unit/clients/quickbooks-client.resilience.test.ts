import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type {
  QuickBooksConnection,
  QuickBooksConnectionStore,
  QuickBooksTokenUpdate,
} from "../../../src/runtime/contracts";

const refreshDispatch = jest.fn<(token: string) => Promise<{ token: Record<string, unknown> }>>();

jest.unstable_mockModule("intuit-oauth", () => ({
  default: class MockOAuthClient {
    refreshUsingToken(token: string) {
      return refreshDispatch(token);
    }
  },
}));

const constructedQuickBooks = jest.fn();
jest.unstable_mockModule("node-quickbooks", () => ({
  default: class MockQuickBooks {
    constructor(...args: unknown[]) {
      constructedQuickBooks(...args);
    }
  },
}));

const { QuickbooksClient } = await import("../../../src/clients/quickbooks-client");

function connection(overrides: Partial<QuickBooksConnection> = {}): QuickBooksConnection {
  return {
    id: "primary",
    realmId: "realm-1",
    environment: "sandbox",
    refreshToken: "refresh-1",
    version: 1,
    status: "active",
    ...overrides,
  };
}

function makeStore(initial = connection()) {
  let current = initial;
  const persist = jest.fn(async (tokens: QuickBooksTokenUpdate) => {
    current = {
      ...current,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshToken: tokens.refreshToken,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
      version: current.version + 1,
    };
    return current;
  });
  const withRefreshLock: QuickBooksConnectionStore["withRefreshLock"] = async (_id, callback) =>
    callback(current, persist);
  const store: QuickBooksConnectionStore = {
    load: jest.fn(async () => current),
    provision: jest.fn(async () => undefined),
    withRefreshLock: jest.fn(withRefreshLock) as QuickBooksConnectionStore["withRefreshLock"],
    markReauthorizationRequired: jest.fn(async () => undefined),
  };
  return { store, persist, current: () => current };
}

function makeClient(store: QuickBooksConnectionStore, environment: "sandbox" | "production" = "sandbox") {
  return new QuickbooksClient({
    clientId: "client-id",
    clientSecret: "client-secret",
    connectionId: "primary",
    connectionStore: store,
    environment,
  });
}

beforeEach(() => {
  refreshDispatch.mockReset();
  constructedQuickBooks.mockReset();
});

describe("durable QuickBooks token rotation", () => {
  it("persists access and rotated refresh tokens before returning", async () => {
    const fixture = makeStore();
    refreshDispatch.mockResolvedValue({
      token: { access_token: "access-2", expires_in: 3600, refresh_token: "refresh-2" },
    });

    await expect(makeClient(fixture.store).refreshAccessToken()).resolves.toEqual({
      access_token: "access-2",
      expires_in: 3600,
    });
    expect(fixture.persist).toHaveBeenCalledTimes(1);
    expect(fixture.current().refreshToken).toBe("refresh-2");
  });

  it("coalesces concurrent refresh attempts in one instance", async () => {
    const fixture = makeStore();
    refreshDispatch.mockResolvedValue({ token: { access_token: "access-2", expires_in: 3600 } });
    const client = makeClient(fixture.store);

    await Promise.all([client.refreshAccessToken(), client.refreshAccessToken()]);

    expect(fixture.store.withRefreshLock).toHaveBeenCalledTimes(1);
    expect(refreshDispatch).toHaveBeenCalledTimes(1);
  });

  it("reuses a valid access token loaded under the distributed lock", async () => {
    const fixture = makeStore(connection({
      accessToken: "already-valid",
      accessTokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
    }));

    await expect(makeClient(fixture.store).refreshAccessToken()).resolves.toMatchObject({
      access_token: "already-valid",
    });
    expect(refreshDispatch).not.toHaveBeenCalled();
    expect(fixture.persist).not.toHaveBeenCalled();
  });

  it("fails the request when durable token persistence fails", async () => {
    const fixture = makeStore();
    (fixture.persist as jest.MockedFunction<typeof fixture.persist>).mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    refreshDispatch.mockResolvedValue({
      token: { access_token: "access-2", expires_in: 3600, refresh_token: "refresh-2" },
    });

    await expect(makeClient(fixture.store).refreshAccessToken()).rejects.toThrow("database unavailable");
  });

  it("marks an invalid refresh token for operator reauthorization", async () => {
    const fixture = makeStore();
    refreshDispatch.mockRejectedValue(new Error("Request failed with status code 400"));

    await expect(makeClient(fixture.store).refreshAccessToken()).rejects.toThrow(
      "operator reauthorization",
    );
    expect(fixture.store.markReauthorizationRequired).toHaveBeenCalledWith("primary");
  });

  it("keeps transient refresh failures retryable", async () => {
    const fixture = makeStore();
    refreshDispatch.mockRejectedValue(new Error("Request failed with status code 503"));

    await expect(makeClient(fixture.store).refreshAccessToken()).rejects.toThrow("503");
    expect(fixture.store.markReauthorizationRequired).not.toHaveBeenCalled();
  });

  it("builds the QBO SDK client from durable credentials", async () => {
    const fixture = makeStore(connection({
      accessToken: "access-1",
      accessTokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
    }));

    await makeClient(fixture.store).authenticate();

    expect(constructedQuickBooks).toHaveBeenCalledWith(
      "client-id", "client-secret", "access-1", false, "realm-1", true,
      false, null, "2.0", "refresh-1",
    );
  });
});
