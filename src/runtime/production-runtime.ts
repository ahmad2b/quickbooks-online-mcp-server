import { createRequestStateCodec, type ServerContext } from "@modelcontextprotocol/server";
import type { HttpConfig } from "../http-config.js";
import { configureQuickbooksClient } from "../clients/quickbooks-client.js";
import { ClaimBindingAuthorizationPolicy } from "./authorization-policy.js";
import type { MutationRequestState, RuntimeServices } from "./contracts.js";
import { PostgresRuntimeStore } from "./postgres-runtime-store.js";

export type ProductionRuntime = {
  services: RuntimeServices;
  close: () => Promise<void>;
};

function claimsFromContext(context: ServerContext): Readonly<Record<string, unknown>> {
  const claims = context.http?.authInfo?.extra?.claims;
  return claims && typeof claims === "object" && !Array.isArray(claims)
    ? claims as Readonly<Record<string, unknown>>
    : {};
}

/**
 * Initialize shared production infrastructure once per process/function
 * instance. This performs schema/configuration checks but deliberately does
 * not refresh QuickBooks tokens during cold start.
 */
export async function createProductionRuntime(config: HttpConfig): Promise<ProductionRuntime> {
  const store = new PostgresRuntimeStore(config.databaseUrl, config.dataEncryptionKey);
  try {
    await store.initialize();
    // Confirmation state expires after ten minutes. Prepared records older
    // than that can never be resumed. A mutation still executing after
    // fifteen minutes is conservatively ambiguous and must be reconciled.
    await store.recoverStale(10 * 60 * 1000, 15 * 60 * 1000);
    let connection = await store.load(config.quickbooksConnectionId);
    if (!connection && config.quickbooksBootstrapRealmId && config.quickbooksBootstrapRefreshToken) {
      await store.provision({
        id: config.quickbooksConnectionId,
        realmId: config.quickbooksBootstrapRealmId,
        environment: config.quickbooksBootstrapEnvironment!,
        refreshToken: config.quickbooksBootstrapRefreshToken,
      });
      connection = await store.load(config.quickbooksConnectionId);
    }
    if (!connection) {
      throw new Error(
        "QuickBooks connection is not provisioned; provide one-time bootstrap credentials or provision the database",
      );
    }
    if (connection.status !== "active") {
      throw new Error(`QuickBooks connection is ${connection.status}`);
    }

    configureQuickbooksClient({
      clientId: config.quickbooksClientId,
      clientSecret: config.quickbooksClientSecret,
      connectionId: config.quickbooksConnectionId,
      connectionStore: store,
      environment: connection.environment,
    });

    const authorizationPolicy = new ClaimBindingAuthorizationPolicy({
      bindingClaim: config.authBindingClaim,
      allowedValues: config.authAllowedBindingValues,
    });
    const requestStateCodec = createRequestStateCodec<MutationRequestState>({
      key: Buffer.from(config.requestStateKey, "base64"),
      ttlSeconds: 10 * 60,
      bind: (context) => {
        const claims = claimsFromContext(context);
        return [claims.iss, claims.sub, claims.client_id ?? claims.azp, context.mcpReq.method]
          .map((value) => typeof value === "string" ? value : "")
          .join("\0");
      },
    });

    return {
      services: {
        connectionId: config.quickbooksConnectionId,
        connectionStore: store,
        rateLimiter: store,
        authorizationPolicy,
        operations: store,
        requestStateCodec,
      },
      close: () => store.close(),
    };
  } catch (error) {
    await store.close().catch(() => undefined);
    throw error;
  }
}
