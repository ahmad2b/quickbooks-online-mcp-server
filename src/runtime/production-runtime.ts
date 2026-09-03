import { ClaimBindingAuthorizationPolicy } from "./authorization-policy.js";
import { RequestScopedQboClientFactory } from "../clients/quickbooks-client.js";
import { financeExecutionLeaseProviderFromEnv } from "../adapters/finance-execution-lease-provider.js";
import type {
  QboExecutionLeaseProvider,
  RuntimeServices,
} from "./contracts.js";
import type { HttpConfig } from "../http-config.js";

export type ProductionRuntime = {
  services: RuntimeServices;
  close: () => Promise<void>;
};

export type RuntimeProviderAdapters = {
  qboExecutionLeaseProvider: QboExecutionLeaseProvider;
  qboClientFactory?: RuntimeServices["qboClientFactory"];
  close?: () => Promise<void>;
};

/**
 * Compose the MCP runtime from the Finance-backed lease provider and an
 * optional test/deployment client factory. The MCP server owns no credentials.
 */
export async function createProductionRuntime(
  config: HttpConfig,
  adapters?: RuntimeProviderAdapters,
  fetchImpl?: typeof fetch,
): Promise<ProductionRuntime> {
  const qboExecutionLeaseProvider = adapters?.qboExecutionLeaseProvider ??
    financeExecutionLeaseProviderFromEnv(process.env, fetchImpl);

  const authorizationPolicy = new ClaimBindingAuthorizationPolicy({
    issuer: config.authIssuer,
    organizationClaim: config.authOrganizationClaim,
    // Temporary unauthenticated mode has no authenticated caller to allow. It
    // fabricates a caller identity, and the execution seam re-runs this policy
    // on every tool call whatever the mode, so an allowlist here would refuse
    // every call in the cutover window where the list is configured but the
    // bypass is still on. The fabricated id is deliberately never allowlisted.
    allowedClientIds: config.temporaryUnauthenticatedMode
      ? []
      : config.allowedClientIds,
  });

  return {
    services: {
      qboClientFactory: adapters?.qboClientFactory ?? new RequestScopedQboClientFactory(
        qboExecutionLeaseProvider,
      ),
      authorizationPolicy,
    },
    close: adapters?.close ?? (async () => undefined),
  };
}
