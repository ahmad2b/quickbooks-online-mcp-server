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
  authJwksUrl?: URL;
  authIntrospectionUrl?: URL;
  authIntrospectionClientId?: string;
  authIntrospectionClientSecret?: string;
  listenHost: string;
  listenPort: number;
  allowedHosts: string[];
  allowedOrigins: string[];
  bodyLimit: string;
  requestTimeoutMs: number;
  rateLimitPerMinute: number;
  requestStateKey: string;
  operationFingerprintKey: string;
  operationFingerprintKeyVersion: string;
  authOrganizationClaim: string;
  authConnectionClaim: string;
  /** Opaque adapter references; transport is selected by DevRaftel deployment. */
  qboExecutionLeaseProvider: string;
  operationLedgerProvider: string;
  rateLimitProvider: string;
  workloadIdentity: string;
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

function parsePositiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number, errors: string[]): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) errors.push(name);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function validateBase64Key(
  value: string | undefined,
  name: string,
  expectedBytes: number,
  errors: string[],
): void {
  if (!value) return;
  try {
    const decoded = Buffer.from(value, "base64");
    if (
      decoded.length !== expectedBytes ||
      decoded.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")
    ) {
      errors.push(name);
    }
  } catch {
    errors.push(name);
  }
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
    if (uri.protocol !== "https:" || uri.pathname !== MCP_PATH || uri.search || uri.hash) {
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
  const authJwksUrl = parseHttpsUrl(env, "MCP_AUTH_JWKS_URL", errors, false);
  const authIntrospectionUrl = parseHttpsUrl(env, "MCP_AUTH_INTROSPECTION_URL", errors, false);
  if (!authJwksUrl && !authIntrospectionUrl) errors.push("MCP_AUTH_JWKS_URL|MCP_AUTH_INTROSPECTION_URL");
  if (authJwksUrl && authIntrospectionUrl) errors.push("MCP_AUTH_JWKS_URL|MCP_AUTH_INTROSPECTION_URL");

  const listenHost = env.MCP_HOST?.trim() || "127.0.0.1";
  const listenPort = parsePositiveInt(env, "MCP_PORT", 3000, errors);
  const allowedHosts = parseHostAllowlist(env.MCP_ALLOWED_HOSTS || resourceUri?.hostname, "MCP_ALLOWED_HOSTS", errors);
  const allowedOrigins = parseHostAllowlist(env.MCP_ALLOWED_ORIGINS, "MCP_ALLOWED_ORIGINS", errors);
  const bodyLimit = env.MCP_BODY_LIMIT?.trim() || "1mb";
  const requestTimeoutMs = parsePositiveInt(env, "MCP_REQUEST_TIMEOUT_MS", 30_000, errors);
  const rateLimitPerMinute = parsePositiveInt(env, "MCP_RATE_LIMIT_PER_MINUTE", 120, errors);
  const requestStateKey = required(env, "MCP_REQUEST_STATE_KEY", errors);
  const operationFingerprintKey = required(env, "MCP_OPERATION_FINGERPRINT_KEY", errors);
  const operationFingerprintKeyVersion = env.MCP_OPERATION_FINGERPRINT_KEY_VERSION?.trim() || "v1";
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(operationFingerprintKeyVersion)) {
    errors.push("MCP_OPERATION_FINGERPRINT_KEY_VERSION");
  }
  const authOrganizationClaim = required(env, "MCP_AUTH_ORGANIZATION_CLAIM", errors);
  const authConnectionClaim = required(env, "MCP_AUTH_CONNECTION_CLAIM", errors);
  if (authOrganizationClaim && authOrganizationClaim === authConnectionClaim) {
    errors.push("MCP_AUTH_ORGANIZATION_CLAIM|MCP_AUTH_CONNECTION_CLAIM");
  }
  const qboExecutionLeaseProvider = required(env, "QBO_EXECUTION_LEASE_PROVIDER", errors);
  const operationLedgerProvider = required(env, "OPERATION_LEDGER_PROVIDER", errors);
  const rateLimitProvider = required(env, "RATE_LIMIT_PROVIDER", errors);
  const workloadIdentity = required(env, "MCP_WORKLOAD_IDENTITY", errors);
  validateBase64Key(requestStateKey, "MCP_REQUEST_STATE_KEY", 32, errors);
  validateBase64Key(operationFingerprintKey, "MCP_OPERATION_FINGERPRINT_KEY", 32, errors);
  if (authIntrospectionUrl && (!env.MCP_AUTH_INTROSPECTION_CLIENT_ID || !env.MCP_AUTH_INTROSPECTION_CLIENT_SECRET)) {
    errors.push("MCP_AUTH_INTROSPECTION_CLIENT_ID|MCP_AUTH_INTROSPECTION_CLIENT_SECRET");
  }

  if (
    errors.length > 0 ||
    !resourceUri ||
    !authIssuer ||
    !authMetadataUrl ||
    !requestStateKey ||
    !operationFingerprintKey ||
    !authOrganizationClaim ||
    !authConnectionClaim ||
    !qboExecutionLeaseProvider ||
    !operationLedgerProvider ||
    !rateLimitProvider ||
    !workloadIdentity
  ) {
    throw new HttpConfigurationError([...new Set(errors)]);
  }

  return {
    resourceUri,
    authIssuer,
    authMetadataUrl,
    authJwksUrl,
    authIntrospectionUrl,
    authIntrospectionClientId: env.MCP_AUTH_INTROSPECTION_CLIENT_ID?.trim(),
    authIntrospectionClientSecret: env.MCP_AUTH_INTROSPECTION_CLIENT_SECRET?.trim(),
    listenHost,
    listenPort,
    allowedHosts,
    allowedOrigins,
    bodyLimit,
    requestTimeoutMs,
    rateLimitPerMinute,
    requestStateKey,
    operationFingerprintKey,
    operationFingerprintKeyVersion,
    authOrganizationClaim,
    authConnectionClaim,
    qboExecutionLeaseProvider,
    operationLedgerProvider,
    rateLimitProvider,
    workloadIdentity,
  };
}
