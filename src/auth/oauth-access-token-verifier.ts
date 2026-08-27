import {
  AuthInfo,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

export type OAuthAccessTokenVerifierOptions = {
  issuer: string;
  resourceUri: string;
  introspectionUrl: string;
  introspectionClientId: string;
  introspectionClientSecret: string;
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
  return Array.isArray(value) &&
    value.length === 1 &&
    value[0] === expected;
}

function assertIntrospectionPayload(
  token: string,
  payload: Record<string, unknown>,
  options: OAuthAccessTokenVerifierOptions,
): AuthInfo {
  if (payload.active !== true) throw invalidToken("The access token is inactive");
  if (typeof payload.iss !== "string" || payload.iss !== options.issuer) {
    throw invalidToken("The access token issuer is invalid");
  }
  if (!audienceMatches(payload.aud, options.resourceUri)) throw invalidToken("The access token audience is not exactly this MCP resource");
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
 * OAuth resource-server verifier. Every access token is checked with AuthCo so
 * current organization membership and revocation state are enforced on every
 * MCP request. The bearer token is never forwarded to Intuit or Finance.
 */
export class OAuthAccessTokenVerifier implements OAuthTokenVerifier {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OAuthAccessTokenVerifierOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (!token || /\s/.test(token)) throw invalidToken();
    return this.introspect(token);
  }

  private async introspect(token: string): Promise<AuthInfo> {
    const clientId = this.options.introspectionClientId;
    const clientSecret = this.options.introspectionClientSecret;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetchImpl(this.options.introspectionUrl, {
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
