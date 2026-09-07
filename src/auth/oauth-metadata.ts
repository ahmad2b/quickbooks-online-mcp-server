import type { OAuthMetadata } from "@modelcontextprotocol/server";
import { HttpConfigurationError, type HttpConfig } from "../http-config.js";

export type OAuthMetadataLoadOptions = {
  fetchImpl?: typeof fetch;
  metadata?: OAuthMetadata;
};

function metadataError(variable = "MCP_AUTH_METADATA_URL"): HttpConfigurationError {
  return new HttpConfigurationError([variable]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validate only the RFC 8414 fields the MCP SDK requires and the issuer
 * binding this resource server is permitted to accept. The complete metadata
 * object is then passed through to the SDK metadata router. The configured
 * authorization server owns its metadata; this application does not invent
 * or proxy token endpoints.
 */
export function validateOAuthMetadata(value: unknown, expectedIssuer: string): OAuthMetadata {
  if (!isRecord(value)) throw metadataError();
  if (value.issuer !== expectedIssuer) throw metadataError("MCP_AUTH_ISSUER");
  if (!isHttpsUrl(value.authorization_endpoint) || !isHttpsUrl(value.token_endpoint)) {
    throw metadataError();
  }
  if (!Array.isArray(value.response_types_supported) ||
      value.response_types_supported.length === 0 ||
      value.response_types_supported.some((item) => typeof item !== "string")) {
    throw metadataError();
  }

  for (const field of ["registration_endpoint", "service_documentation", "revocation_endpoint"]) {
    if (field in value && value[field] !== undefined && !isHttpsUrl(value[field])) {
      throw metadataError();
    }
  }
  if ("scopes_supported" in value && value.scopes_supported !== undefined &&
      (!Array.isArray(value.scopes_supported) || value.scopes_supported.some((item) => typeof item !== "string"))) {
    throw metadataError();
  }

  return value as OAuthMetadata;
}

async function fetchMetadata(url: URL, expectedIssuer: string, fetchImpl: typeof fetch): Promise<OAuthMetadata> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw metadataError();
    return validateOAuthMetadata(await response.json(), expectedIssuer);
  } catch (error) {
    if (error instanceof HttpConfigurationError) throw error;
    throw metadataError();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Load the configured authorization server's RFC 8414 or OIDC discovery
 * document at startup. Production uses an explicit HTTPS URL; there is no
 * guessed discovery path or fallback authorization server.
 */
export async function loadOAuthMetadata(
  config: HttpConfig,
  options: OAuthMetadataLoadOptions = {},
): Promise<OAuthMetadata> {
  if (options.metadata) return validateOAuthMetadata(options.metadata, config.authIssuer);
  // Only oauth mode publishes authorization-server metadata.
  if (!config.authMetadataUrl) throw metadataError();
  return fetchMetadata(config.authMetadataUrl, config.authIssuer, options.fetchImpl ?? fetch);
}
