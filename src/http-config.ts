import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

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
  quickbooksEnvironment: "sandbox" | "production";
  quickbooksClientId: string;
  quickbooksClientSecret: string;
  quickbooksRealmId: string;
  quickbooksRefreshToken: string;
  tokenStorePath: string;
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

function fromStoreOrEnvironment(
  env: NodeJS.ProcessEnv,
  store: Record<string, string>,
  name: string,
  errors: string[],
): string | undefined {
  const value = store[name]?.trim() || env[name]?.trim();
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

function parseCsv(value: string | undefined, name: string, errors: string[]): string[] {
  if (!value?.trim()) {
    errors.push(name);
    return [];
  }
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (values.length === 0 || values.some((item) => item === "*")) errors.push(name);
  return values;
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
  const raw = parseCsv(value, name, errors);
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
 * Validate all static HTTP requirements before creating a listener. Values are
 * never included in the thrown error, so startup diagnostics do not disclose
 * credentials or resource identifiers beyond variable names.
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

  const tokenStorePath = required(env, "QUICKBOOKS_TOKEN_STORE_PATH", errors);

  let tokenStoreEnv: Record<string, string> = {};
  if (tokenStorePath && path.isAbsolute(tokenStorePath)) {
    try {
      tokenStoreEnv = dotenv.parse(fs.readFileSync(tokenStorePath));
    } catch {
      // The path/access error is recorded below; do not expose filesystem
      // details in startup diagnostics.
    }
  }

  // The runtime client loads this same file with dotenv override semantics, so
  // the startup validator must use identical precedence. This is especially
  // important for the realm and refresh token, which rotate in the store.
  const quickbooksClientId = fromStoreOrEnvironment(env, tokenStoreEnv, "QUICKBOOKS_CLIENT_ID", errors);
  const quickbooksClientSecret = fromStoreOrEnvironment(env, tokenStoreEnv, "QUICKBOOKS_CLIENT_SECRET", errors);
  const quickbooksRealmId = fromStoreOrEnvironment(env, tokenStoreEnv, "QUICKBOOKS_REALM_ID", errors);
  const quickbooksRefreshToken = fromStoreOrEnvironment(env, tokenStoreEnv, "QUICKBOOKS_REFRESH_TOKEN", errors);
  const quickbooksEnvironment = tokenStoreEnv.QUICKBOOKS_ENVIRONMENT?.trim() || env.QUICKBOOKS_ENVIRONMENT?.trim() || "sandbox";
  if (quickbooksEnvironment !== "sandbox" && quickbooksEnvironment !== "production") {
    errors.push("QUICKBOOKS_ENVIRONMENT");
  }

  if (tokenStorePath && !path.isAbsolute(tokenStorePath)) errors.push("QUICKBOOKS_TOKEN_STORE_PATH");
  if (tokenStorePath && path.isAbsolute(tokenStorePath)) {
    try {
      const stat = fs.statSync(tokenStorePath);
      if (!stat.isFile() || (stat.mode & 0o077) !== 0) errors.push("QUICKBOOKS_TOKEN_STORE_PATH");
      fs.accessSync(tokenStorePath, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
      errors.push("QUICKBOOKS_TOKEN_STORE_PATH");
    }
  }
  if (authIntrospectionUrl && (!env.MCP_AUTH_INTROSPECTION_CLIENT_ID || !env.MCP_AUTH_INTROSPECTION_CLIENT_SECRET)) {
    errors.push("MCP_AUTH_INTROSPECTION_CLIENT_ID|MCP_AUTH_INTROSPECTION_CLIENT_SECRET");
  }

  if (errors.length > 0 || !resourceUri || !authIssuer || !authMetadataUrl || !quickbooksClientId || !quickbooksClientSecret || !quickbooksRealmId || !quickbooksRefreshToken || !tokenStorePath) {
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
    quickbooksEnvironment: quickbooksEnvironment as "sandbox" | "production",
    quickbooksClientId,
    quickbooksClientSecret,
    quickbooksRealmId,
    quickbooksRefreshToken,
    tokenStorePath,
  };
}
