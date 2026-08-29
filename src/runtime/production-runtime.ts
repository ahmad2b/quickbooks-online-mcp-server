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
