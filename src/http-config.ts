export const MCP_PATH = "/mcp";
export const MCP_PROTOCOL_VERSION = "2026-07-28";
export const QUICKBOOKS_SCOPES = [
  "quickbooks.read",
  "quickbooks.write",
  "quickbooks.delete",
] as const;

export type HttpConfig = {
  resourceUri: URL;
  authIssuer: string;
  authMetadataUrl: URL;
  authIntrospectionUrl: URL;
  authIntrospectionClientId: string;
  authIntrospectionClientSecret: string;
  listenHost: string;
  listenPort: number;
  allowedHosts: string[];
  allowedOrigins: string[];
  bodyLimit: string;
  requestTimeoutMs: number;
  authOrganizationClaim: string;
  /**
   * OAuth client ids permitted to reach this resource server. AuthCo will mint
   * a token for this resource for any client a user consents to, so the
   * audience alone does not say who is calling. Empty only in temporary
   * unauthenticated mode, where there is no caller identity to allow.
   */
  allowedClientIds: readonly string[];
  /** TEMPORARY sandbox-only escape hatch. Defaults off. */
  temporaryUnauthenticatedMode: boolean;
  /** Opaque adapter references; transport is selected by DevRaftel deployment. */
  qboExecutionLeaseProvider: string;
};

export class HttpConfigurationError extends Error {
  constructor(public readonly missingOrInvalid: readonly string[]) {
    super(`HTTP configuration invalid: ${missingOrInvalid.join(", ")}`);
    this.name = "HttpConfigurationError";
  }
}

function required(env: NodeJS.ProcessEnv, name: string, errors: string[]): string | undefined {
  const value = env[name]?.trim();
  if (!value) errors.push(name);
  return value || undefined;
}

function parseBoolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean, errors: string[]): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  errors.push(name);
  return fallback;
}

function parsePositiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number, errors: string[]): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) errors.push(name);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function parseClientAllowlist(
  value: string | undefined,
  name: string,
  errors: string[],
  requiredValue: boolean,
): string[] {
  const entries = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    if (requiredValue) errors.push(name);
    return [];
  }
  // A wildcard would silently restore the "any consented client" hole this
  // allowlist exists to close.
  if (entries.some((entry) => entry === "*")) errors.push(name);
  return entries;
}

function hostnameFromAllowlistValue(value: string): string | undefined {
  try {
    const url = value.includes("://") ? new URL(value) : new URL(`https://${value}`);
    if (!url.hostname || url.pathname !== "/" || url.search || url.hash) return undefined;
    return url.hostname;
  } catch {
    return undefined;
  }
}

function parseHostAllowlist(value: string | undefined, name: string, errors: string[]): string[] {
  if (!value?.trim()) {
    errors.push(name);
    return [];
  }
  const raw = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (raw.length === 0 || raw.some((item) => item === "*")) errors.push(name);
  const hosts = raw.map(hostnameFromAllowlistValue);
  if (hosts.some((host) => !host)) errors.push(name);
  return hosts.filter((host): host is string => Boolean(host));
}

function parseHttpsUrl(
  env: NodeJS.ProcessEnv,
  name: string,
  errors: string[],
  requiredValue = true,
): URL | undefined {
  const raw = requiredValue ? required(env, name, errors) : env[name]?.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") errors.push(name);
    return url;
  } catch {
    errors.push(name);
    return undefined;
  }
}

function parseHttpsIssuer(env: NodeJS.ProcessEnv, errors: string[]): string | undefined {
  const raw = required(env, "MCP_AUTH_ISSUER", errors);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hash) errors.push("MCP_AUTH_ISSUER");
    return raw;
  } catch {
    errors.push("MCP_AUTH_ISSUER");
    return undefined;
  }
}

function parseResourceUri(env: NodeJS.ProcessEnv, errors: string[]): URL | undefined {
  const raw = required(env, "MCP_RESOURCE_URI", errors);
  if (!raw) return undefined;
  try {
    const uri = new URL(raw);
    if (
      uri.protocol !== "https:" ||
      uri.pathname !== MCP_PATH ||
      uri.search ||
      uri.hash
    ) {
      errors.push("MCP_RESOURCE_URI");
    }
    return uri;
  } catch {
    errors.push("MCP_RESOURCE_URI");
    return undefined;
  }
}

/**
 * Validate static HTTP/resource-server configuration before opening a
 * listener. Customer credentials and database configuration are intentionally
 * not accepted by this data plane.
 */
export function loadHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  const errors: string[] = [];
  const resourceUri = parseResourceUri(env, errors);
  const authIssuer = parseHttpsIssuer(env, errors);
  const authMetadataUrl = parseHttpsUrl(env, "MCP_AUTH_METADATA_URL", errors);
  const authIntrospectionUrl = parseHttpsUrl(env, "MCP_AUTH_INTROSPECTION_URL", errors);
  if (env.MCP_AUTH_JWKS_URL?.trim()) errors.push("MCP_AUTH_JWKS_URL");
  const authIntrospectionClientId = required(env, "MCP_AUTH_INTROSPECTION_CLIENT_ID", errors);
  const authIntrospectionClientSecret = required(env, "MCP_AUTH_INTROSPECTION_CLIENT_SECRET", errors);

  const listenHost = env.MCP_HOST?.trim() || "127.0.0.1";
  const listenPort = parsePositiveInt(env, "MCP_PORT", 3000, errors);
  const allowedHosts = parseHostAllowlist(env.MCP_ALLOWED_HOSTS || resourceUri?.hostname, "MCP_ALLOWED_HOSTS", errors);
  const allowedOrigins = parseHostAllowlist(env.MCP_ALLOWED_ORIGINS, "MCP_ALLOWED_ORIGINS", errors);
  const bodyLimit = env.MCP_BODY_LIMIT?.trim() || "1mb";
  const requestTimeoutMs = parsePositiveInt(env, "MCP_REQUEST_TIMEOUT_MS", 30_000, errors);
  const authOrganizationClaim = required(env, "MCP_AUTH_ORGANIZATION_CLAIM", errors);
  const temporaryUnauthenticatedMode = parseBoolean(
    env,
    "MCP_TEMPORARY_UNAUTHENTICATED_MODE",
    false,
    errors,
  );
  const allowedClientIds = parseClientAllowlist(
    env.MCP_AUTH_ALLOWED_CLIENT_IDS,
    "MCP_AUTH_ALLOWED_CLIENT_IDS",
    errors,
    !temporaryUnauthenticatedMode,
  );
  if (
    temporaryUnauthenticatedMode &&
    env.FINANCE_QUICKBOOKS_ENVIRONMENT?.trim().toLowerCase() !== "sandbox"
  ) {
    errors.push("FINANCE_QUICKBOOKS_ENVIRONMENT");
  }
  const qboExecutionLeaseProvider = required(env, "QBO_EXECUTION_LEASE_PROVIDER", errors);
  if (
    errors.length > 0 ||
    !resourceUri ||
    !authIssuer ||
    !authMetadataUrl ||
    !authIntrospectionUrl ||
    !authIntrospectionClientId ||
    !authIntrospectionClientSecret ||
    !authOrganizationClaim ||
    !qboExecutionLeaseProvider
  ) {
    throw new HttpConfigurationError([...new Set(errors)]);
  }

  return {
    resourceUri,
    authIssuer,
    authMetadataUrl,
    authIntrospectionUrl,
    authIntrospectionClientId,
    authIntrospectionClientSecret,
    listenHost,
    listenPort,
    allowedHosts,
    allowedOrigins,
    bodyLimit,
    requestTimeoutMs,
    authOrganizationClaim,
    allowedClientIds,
    temporaryUnauthenticatedMode,
    qboExecutionLeaseProvider,
  };
}
