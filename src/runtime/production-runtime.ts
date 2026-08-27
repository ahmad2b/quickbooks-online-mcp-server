import { createRequestStateCodec, type ServerContext } from "@modelcontextprotocol/server";
import { ClaimBindingAuthorizationPolicy } from "./authorization-policy.js";
import { RequestScopedQboClientFactory } from "../clients/quickbooks-client.js";
import type {
  MutationRequestState,
  OperationLedger,
  QboExecutionLeaseProvider,
  RateLimiter,
  RuntimeServices,
} from "./contracts.js";
import type { HttpConfig } from "../http-config.js";

export type ProductionRuntime = {
  services: RuntimeServices;
  close: () => Promise<void>;
};

export type RuntimeProviderAdapters = {
  qboExecutionLeaseProvider: QboExecutionLeaseProvider;
  operationLedger: OperationLedger;
  rateLimiter: RateLimiter;
  qboClientFactory?: RuntimeServices["qboClientFactory"];
  /** Must verify non-customer-specific adapter connectivity before binding HTTP. */
  checkReadiness: () => Promise<void>;
  close?: () => Promise<void>;
};

function claimsFromContext(context: ServerContext): Readonly<Record<string, unknown>> {
  const claims = context.http?.authInfo?.extra?.claims;
  return claims && typeof claims === "object" && !Array.isArray(claims)
    ? claims as Readonly<Record<string, unknown>>
    : {};
}

function scopesFromContext(context: ServerContext): string {
  return [...(context.http?.authInfo?.scopes ?? [])].sort().join(" ");
}

/**
 * Compose the MCP runtime only from provider adapters supplied by DevRaftel
 * infrastructure. This repository intentionally does not select an internal
 * HTTP/gRPC connection-service protocol or persist customer credentials.
 */
export async function createProductionRuntime(
  config: HttpConfig,
  adapters?: RuntimeProviderAdapters,
): Promise<ProductionRuntime> {
  if (!adapters) {
    throw new Error(
      "MCP runtime providers are not configured; inject a connection-lease provider, operation ledger, rate limiter, and QBO client factory",
    );
  }
  if (typeof adapters.qboExecutionLeaseProvider.resolveConnectionBinding !== "function") {
    throw new Error("MCP runtime connection provider does not expose a trusted binding resolver");
  }
  try {
    await adapters.checkReadiness();
  } catch {
    throw new Error("MCP runtime provider readiness failed");
  }

  const authorizationPolicy = new ClaimBindingAuthorizationPolicy({
    issuer: config.authIssuer,
    organizationClaim: config.authOrganizationClaim,
  });
  const requestStateCodec = createRequestStateCodec<MutationRequestState>({
    key: Buffer.from(config.requestStateKey, "base64"),
    ttlSeconds: 10 * 60,
    bind: (context) => {
      const claims = claimsFromContext(context);
      return [
        claims.iss,
        claims.sub,
        claims.client_id ?? claims.azp,
        claims[config.authOrganizationClaim],
        scopesFromContext(context),
        context.mcpReq.method,
      ]
        .map((value) => typeof value === "string" ? value : "")
        .join("\0");
    },
  });

  return {
    services: {
      qboClientFactory: adapters.qboClientFactory ?? new RequestScopedQboClientFactory(
        adapters.qboExecutionLeaseProvider,
      ),
      qboExecutionLeaseProvider: adapters.qboExecutionLeaseProvider,
      rateLimiter: adapters.rateLimiter,
      authorizationPolicy,
      operationLedger: adapters.operationLedger,
      operationFingerprint: {
        key: Buffer.from(config.operationFingerprintKey, "base64"),
        keyVersion: config.operationFingerprintKeyVersion,
      },
      requestStateCodec,
    },
    close: adapters.close ?? (async () => undefined),
  };
}
