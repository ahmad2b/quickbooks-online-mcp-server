import QuickBooks from "node-quickbooks";
import OAuthClient from "intuit-oauth";
import type {
  QuickBooksConnection,
  QuickBooksConnectionStore,
} from "../runtime/contracts.js";

type RefreshResult = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  x_refresh_token_expires_in?: number;
};

type QuickBooksClientConfig = {
  clientId: string;
  clientSecret: string;
  connectionId: string;
  connectionStore: QuickBooksConnectionStore;
  environment: "sandbox" | "production";
};

/**
 * HTTP-only QuickBooks client. Durable connection state is mandatory: no file
 * token store, browser flow, localhost callback, or process-only rotation path
 * exists in this runtime.
 */
export class QuickbooksClient {
  private static readonly TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
  private readonly oauthClient: OAuthClient;
  private accessToken?: string;
  private accessTokenExpiry?: Date;
  private refreshToken?: string;
  private realmId?: string;
  private quickbooksInstance?: QuickBooks;
  private refreshInFlight?: Promise<{ access_token: string; expires_in: number }>;
  private authInFlight?: Promise<QuickBooks>;

  constructor(private readonly config: QuickBooksClientConfig) {
    this.oauthClient = new OAuthClient({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      environment: config.environment,
      // Runtime refresh does not use a redirect URI. The library requires a
      // value in its constructor, so use an intentionally non-routable marker.
      redirectUri: "https://invalid.local/operator-provisioning-only",
    });
  }

  private isTokenExpiredOrExpiringSoon(): boolean {
    if (!this.accessToken || !this.accessTokenExpiry) return true;
    return this.accessTokenExpiry.getTime() <=
      Date.now() + QuickbooksClient.TOKEN_REFRESH_BUFFER_MS;
  }

  private applyConnection(connection: QuickBooksConnection): void {
    this.realmId = connection.realmId;
    this.refreshToken = connection.refreshToken;
    this.accessToken = connection.accessToken;
    this.accessTokenExpiry = connection.accessTokenExpiresAt;
  }

  private async loadConnection(): Promise<QuickBooksConnection> {
    const connection = await this.config.connectionStore.load(this.config.connectionId);
    if (!connection) throw new Error("QuickBooks connection is not provisioned");
    if (connection.status !== "active") throw new Error(`QuickBooks connection is ${connection.status}`);
    if (connection.environment !== this.config.environment) {
      throw new Error("QuickBooks connection environment does not match runtime configuration");
    }
    this.applyConnection(connection);
    return connection;
  }

  private classifyAuthInvalidation(raw: unknown): boolean {
    let current: unknown = raw;
    for (let depth = 0; depth < 4 && current != null; depth += 1) {
      const record = typeof current === "object" ? current as Record<string, unknown> : undefined;
      const message = (current instanceof Error ? current.message : String(current)).toLowerCase();
      const status = typeof record?.status === "number"
        ? record.status
        : Number(message.match(/status code (\d{3})\b/)?.[1]);
      if (message.includes("invalid_grant") || status === 400 || status === 401) return true;
      current = record?.cause;
    }
    return false;
  }

  private async performRefresh(refreshToken: string): Promise<RefreshResult> {
    const response = await this.oauthClient.refreshUsingToken(refreshToken);
    return response.token as unknown as RefreshResult;
  }

  async refreshAccessToken(): Promise<{ access_token: string; expires_in: number }> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.config.connectionStore
      .withRefreshLock(this.config.connectionId, async (current, persist) => {
        this.applyConnection(current);
        if (!this.isTokenExpiredOrExpiringSoon() && this.accessToken && this.accessTokenExpiry) {
          return {
            access_token: this.accessToken,
            expires_in: Math.max(1, Math.floor((this.accessTokenExpiry.getTime() - Date.now()) / 1000)),
          };
        }

        const token = await this.performRefresh(current.refreshToken);
        if (!token.access_token) throw new Error("QuickBooks refresh response did not contain an access token");
        const expiresIn = token.expires_in || 3600;
        const updated = await persist({
          accessToken: token.access_token,
          accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
          refreshToken: token.refresh_token || current.refreshToken,
          ...(typeof token.x_refresh_token_expires_in === "number"
            ? { refreshTokenExpiresAt: new Date(Date.now() + token.x_refresh_token_expires_in * 1000) }
            : current.refreshTokenExpiresAt
              ? { refreshTokenExpiresAt: current.refreshTokenExpiresAt }
              : {}),
        });
        // Persistence is deliberately before exposure: a rotated refresh token
        // that was not durably committed must fail the request.
        this.applyConnection(updated);
        return { access_token: token.access_token, expires_in: expiresIn };
      })
      .catch(async (error: unknown) => {
        if (this.classifyAuthInvalidation(error)) {
          await this.config.connectionStore
            .markReauthorizationRequired(this.config.connectionId)
            .catch(() => undefined);
          throw new Error("QuickBooks authorization requires operator reauthorization");
        }
        throw error;
      })
      .finally(() => {
        this.refreshInFlight = undefined;
      });
    return this.refreshInFlight;
  }

  async authenticate(): Promise<QuickBooks> {
    if (this.authInFlight) return this.authInFlight;
    this.authInFlight = (async () => {
      await this.loadConnection();
      if (this.isTokenExpiredOrExpiringSoon()) await this.refreshAccessToken();
      if (!this.accessToken || !this.refreshToken || !this.realmId) {
        throw new Error("QuickBooks connection credentials are incomplete");
      }
      this.quickbooksInstance = new QuickBooks(
        this.config.clientId,
        this.config.clientSecret,
        this.accessToken,
        false,
        this.realmId,
        this.config.environment === "sandbox",
        false,
        null,
        "2.0",
        this.refreshToken,
      );
      return this.quickbooksInstance;
    })().finally(() => {
      this.authInFlight = undefined;
    });
    return this.authInFlight;
  }

  static async getInstance(): Promise<QuickBooks> {
    const client = configuredClient();
    if (client.isTokenExpiredOrExpiringSoon() || !client.quickbooksInstance) {
      await client.authenticate();
    }
    return client.quickbooksInstance!;
  }

  static async getAuthCredentials(): Promise<{
    accessToken: string;
    realmId: string;
    isSandbox: boolean;
  }> {
    const client = configuredClient();
    if (client.isTokenExpiredOrExpiringSoon() || !client.accessToken || !client.realmId) {
      await client.authenticate();
    }
    if (!client.accessToken || !client.realmId) throw new Error("QuickBooks connection is unavailable");
    return {
      accessToken: client.accessToken,
      realmId: client.realmId,
      isSandbox: client.config.environment === "sandbox",
    };
  }

  getQuickbooks(): QuickBooks {
    if (!this.quickbooksInstance) throw new Error("QuickBooks connection is not authenticated");
    return this.quickbooksInstance;
  }
}

export let quickbooksClient: QuickbooksClient | undefined;

function configuredClient(): QuickbooksClient {
  if (!quickbooksClient) throw new Error("QuickBooks production runtime is not initialized");
  return quickbooksClient;
}

export function configureQuickbooksClient(config: QuickBooksClientConfig): void {
  quickbooksClient = new QuickbooksClient(config);
}
