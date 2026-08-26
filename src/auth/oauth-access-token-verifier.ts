import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import {
  AuthInfo,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

export type OAuthAccessTokenVerifierOptions = {
  issuer: string;
  resourceUri: string;
  jwksUrl?: string;
  introspectionUrl?: string;
  introspectionClientId?: string;
  introspectionClientSecret?: string;
  fetchImpl?: typeof fetch;
};

function invalidToken(message = "The access token is invalid"): OAuthError {
  return new OAuthError(OAuthErrorCode.InvalidToken, message);
}

function verificationUnavailable(): OAuthError {
  return new OAuthError(
    OAuthErrorCode.TemporarilyUnavailable,
    "The authorization server is temporarily unavailable",
  );
}

function stringScopes(payload: Record<string, unknown>): string[] {
  const scope = payload.scope;
  if (typeof scope === "string") return scope.split(/\s+/).filter(Boolean);
  if (Array.isArray(scope) && scope.every((item) => typeof item === "string")) return scope as string[];

  const scopes = payload.scopes;
  if (Array.isArray(scopes) && scopes.every((item) => typeof item === "string")) return scopes as string[];
  return [];
}

function audienceMatches(value: unknown, expected: string): boolean {
  if (typeof value === "string") return value === expected;
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string") && value.includes(expected);
}

function authInfoFromPayload(token: string, payload: JWTPayload, resourceUri: string): AuthInfo {
  const claims = payload as JWTPayload & { client_id?: unknown; azp?: unknown };
  const issuer = payload.iss;
  if (issuer === undefined || typeof issuer !== "string") throw invalidToken("The access token has no issuer");
  if (!audienceMatches(payload.aud, resourceUri)) throw invalidToken("The access token audience is not this MCP resource");
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) throw invalidToken("The access token has no expiry");

  const clientId = typeof claims.client_id === "string" && claims.client_id.length > 0
    ? claims.client_id
    : typeof claims.azp === "string" && claims.azp.length > 0
      ? claims.azp
      : undefined;
  if (!clientId) throw invalidToken("The access token has no client identity");
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw invalidToken("The access token has no subject identity");
  }

  return {
    token,
    clientId,
    scopes: stringScopes(payload as Record<string, unknown>),
    expiresAt: payload.exp,
    resource: new URL(resourceUri),
    // Preserve subject, client, and provider-specific tenant claims as distinct
    // inputs to the provider-neutral authorization policy. Never collapse sub
    // into clientId: they represent different security principals.
    extra: { issuer, claims: { ...payload, client_id: claims.client_id, azp: claims.azp } },
  };
}

function assertIntrospectionPayload(
  token: string,
  payload: Record<string, unknown>,
  options: OAuthAccessTokenVerifierOptions,
): AuthInfo {
  if (payload.active !== true) throw invalidToken("The access token is inactive");
  // The configured authenticated introspection endpoint establishes the
  // issuer for opaque tokens. If the response also carries `iss`, it must
  // exactly match that configured issuer.
  if (payload.iss !== undefined && payload.iss !== options.issuer) {
    throw invalidToken("The access token issuer is invalid");
  }
  if (!audienceMatches(payload.aud, options.resourceUri)) throw invalidToken("The access token audience is not this MCP resource");
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) throw invalidToken("The access token has no expiry");
  if (payload.exp <= Math.floor(Date.now() / 1000)) throw invalidToken("The access token is expired");
  if (payload.nbf !== undefined && (typeof payload.nbf !== "number" || !Number.isFinite(payload.nbf))) {
    throw invalidToken("The access token not-before claim is invalid");
  }
  if (typeof payload.nbf === "number" && payload.nbf > Math.floor(Date.now() / 1000)) throw invalidToken("The access token is not active yet");

  const clientId = typeof payload.client_id === "string" && payload.client_id.length > 0
    ? payload.client_id
    : typeof payload.azp === "string" && payload.azp.length > 0
      ? payload.azp
      : undefined;
  if (!clientId) throw invalidToken("The access token has no client identity");
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw invalidToken("The access token has no subject identity");
  }

  return {
    token,
    clientId,
    scopes: stringScopes(payload),
    expiresAt: payload.exp,
    resource: new URL(options.resourceUri),
    extra: { issuer: options.issuer, claims: { ...payload, iss: options.issuer } },
  };
}

/**
 * OAuth resource-server verifier. JWT/JWKS and opaque-token introspection are
 * explicit configuration choices; the server never guesses a token format or
 * forwards the MCP bearer token to Intuit.
 */
export class OAuthAccessTokenVerifier implements OAuthTokenVerifier {
  private readonly remoteJwks?: ReturnType<typeof createRemoteJWKSet>;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OAuthAccessTokenVerifierOptions) {
    if (!options.jwksUrl && !options.introspectionUrl) {
      throw new Error("Configure MCP_AUTH_JWKS_URL or MCP_AUTH_INTROSPECTION_URL for access-token verification");
    }
    if (options.jwksUrl) this.remoteJwks = createRemoteJWKSet(new URL(options.jwksUrl));
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (!token || /\s/.test(token)) throw invalidToken();

    // JWT verification is used only when an explicit JWKS URL is configured.
    // The audience and issuer are always exact, and jose validates exp/nbf and
    // the signature before claims are converted into AuthInfo.
    if (this.remoteJwks && token.split(".").length === 3) {
      try {
        const verified = await jwtVerify(token, this.remoteJwks, {
          issuer: this.options.issuer,
          audience: this.options.resourceUri,
        });
        return authInfoFromPayload(token, verified.payload, this.options.resourceUri);
      } catch (error) {
        if (OAuthError.isInstance(error)) throw error;
        throw invalidToken();
      }
    }

    if (!this.options.introspectionUrl) throw invalidToken("The access token format is not configured");
    return this.introspect(token);
  }

  private async introspect(token: string): Promise<AuthInfo> {
    const clientId = this.options.introspectionClientId;
    const clientSecret = this.options.introspectionClientSecret;
    if (!clientId || !clientSecret) throw invalidToken("Introspection client credentials are not configured");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetchImpl(this.options.introspectionUrl!, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({ token, token_type_hint: "access_token" }),
        signal: controller.signal,
      });
      if (response.status === 400 || response.status === 401) throw invalidToken();
      if (!response.ok) throw verificationUnavailable();
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw invalidToken();
      return assertIntrospectionPayload(token, payload as Record<string, unknown>, this.options);
    } catch (error) {
      if (OAuthError.isInstance(error)) throw error;
      throw verificationUnavailable();
    } finally {
      clearTimeout(timeout);
    }
  }
}
