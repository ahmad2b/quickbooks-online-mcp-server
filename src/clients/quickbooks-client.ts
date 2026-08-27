import QuickBooks from "node-quickbooks";
import type {
  ExecutionContext,
  QboClientFactory,
  QboClientLease,
  QboExecutionLease,
  QboExecutionLeaseProvider,
  QboHandlerDependencies,
  QboRawClient,
  QuickBooksEnvironment,
} from "../runtime/contracts.js";

export type QuickBooksConstructor = new (
  consumerKey: string,
  consumerSecret: string,
  accessToken: string,
  tokenSecret: boolean | string,
  realmId: string,
  useSandbox?: boolean,
  debug?: boolean,
  minorversion?: string | number | null,
  oauthVersion?: string,
  refreshToken?: string,
) => QuickBooks;

export class QboExecutionError extends Error {
  constructor(
    public readonly code:
      | "QBO_EXECUTION_LEASE_UNAVAILABLE"
      | "QBO_EXECUTION_LEASE_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "QboExecutionError";
  }
}

function isEnvironment(value: unknown): value is QuickBooksEnvironment {
  return value === "sandbox" || value === "production";
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function assertLease(
  lease: QboExecutionLease,
  now: () => number,
  safetyMarginMs: number,
): void {
  if (!lease || typeof lease !== "object") {
    throw new QboExecutionError("QBO_EXECUTION_LEASE_INVALID", "The execution lease is invalid");
  }
  if (typeof lease.leaseId !== "string" || lease.leaseId.length === 0 ||
      typeof lease.qboConnectionId !== "string" || lease.qboConnectionId.length === 0 ||
      typeof lease.accessToken !== "string" || lease.accessToken.length === 0 ||
      typeof lease.realmId !== "string" || lease.realmId.length === 0 ||
      typeof lease.credentialVersion !== "string" || lease.credentialVersion.length === 0 ||
      !isEnvironment(lease.environment) || !validDate(lease.expiresAt)) {
    throw new QboExecutionError("QBO_EXECUTION_LEASE_INVALID", "The execution lease is incomplete");
  }
  if (lease.expiresAt.getTime() <= now() + safetyMarginMs) {
    throw new QboExecutionError("QBO_EXECUTION_LEASE_INVALID", "The execution lease is expired or too close to expiry");
  }
}

/**
 * Constructs a fresh node-quickbooks and raw credential context for each
 * authorized request. The connection service resolves the connection for the
 * verified organization context and supplies only a short-lived access token;
 * the MCP process has no refresh-token or client-secret input.
 */
export class RequestScopedQboClientFactory implements QboClientFactory {
  private readonly QuickBooksConstructor: QuickBooksConstructor;
  private readonly now: () => number;
  private readonly safetyMarginMs: number;

  constructor(
    private readonly provider: QboExecutionLeaseProvider,
    options: {
      QuickBooksConstructor?: QuickBooksConstructor;
      now?: () => number;
      leaseSafetyMarginMs?: number;
    } = {},
  ) {
    this.QuickBooksConstructor = options.QuickBooksConstructor ?? QuickBooks;
    this.now = options.now ?? Date.now;
    this.safetyMarginMs = options.leaseSafetyMarginMs ?? 5_000;
    if (!Number.isInteger(this.safetyMarginMs) || this.safetyMarginMs < 0) {
      throw new Error("Lease safety margin must be a non-negative integer");
    }
  }

  async create(context: ExecutionContext): Promise<QboClientLease> {
    let lease: QboExecutionLease | undefined;
    try {
      lease = await this.provider.acquire(context);
    } catch (error) {
      if (error instanceof QboExecutionError) throw error;
      throw new QboExecutionError(
        "QBO_EXECUTION_LEASE_UNAVAILABLE",
        "The QuickBooks execution lease is unavailable",
      );
    }

    try {
      assertLease(lease, this.now, this.safetyMarginMs);
      // node-quickbooks requires consumer key/secret constructor positions even
      // for bearer-token calls. Empty markers avoid introducing Intuit client
      // secrets into this data plane; refresh/exchange belongs to the broker.
      const qbo = new this.QuickBooksConstructor(
        "",
        "",
        lease.accessToken,
        false,
        lease.realmId,
        lease.environment === "sandbox",
        false,
        null,
        "2.0",
      );
      const rawQbo: QboRawClient = Object.freeze({
        accessToken: lease.accessToken,
        realmId: lease.realmId,
        environment: lease.environment,
      });
      let closed = false;
      return {
        qbo,
        rawQbo,
        qboConnectionId: lease.qboConnectionId,
        leaseId: lease.leaseId,
        expiresAt: lease.expiresAt,
        close: async () => {
          if (closed) return;
          closed = true;
          // A provider may use explicit lease release, but the port does not
          // require a network round trip for every request. Object references
          // are dropped by the request scope after this callback returns.
          if ("release" in this.provider && typeof this.provider.release === "function") {
            await this.provider.release(lease, context);
          }
        },
      };
    } catch (error) {
      if (lease && typeof this.provider.release === "function") {
        await this.provider.release(lease, context).catch(() => undefined);
      }
      if (error instanceof QboExecutionError) throw error;
      throw new QboExecutionError("QBO_EXECUTION_LEASE_INVALID", "The QuickBooks execution lease is invalid");
    }
  }
}

/**
 * Resolve the explicit request-scoped dependencies passed by the tool
 * registration seam. Keeping this small adapter in the client module lets
 * business handlers share one failure mode without reintroducing ambient or
 * process-global credential lookup.
 */
export function resolveQboHandlerDependencies(
  dependencies?: QboHandlerDependencies,
): QboHandlerDependencies {
  if (!dependencies) {
    throw new QboExecutionError(
      "QBO_EXECUTION_LEASE_UNAVAILABLE",
      "QuickBooks execution dependencies were not provided",
    );
  }
  return dependencies;
}
