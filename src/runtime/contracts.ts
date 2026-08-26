import type { ToolAuthority } from "../types/tool-definition.js";
import type { ServerContext } from "@modelcontextprotocol/server";

export type QuickBooksEnvironment = "sandbox" | "production";

export type QuickBooksConnection = {
  id: string;
  realmId: string;
  environment: QuickBooksEnvironment;
  accessToken?: string;
  accessTokenExpiresAt?: Date;
  refreshToken: string;
  refreshTokenExpiresAt?: Date;
  version: number;
  status: "active" | "reauthorization_required" | "disabled";
};

export type QuickBooksTokenUpdate = {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt?: Date;
};

/** Durable authority for one deployment-to-company connection. */
export interface QuickBooksConnectionStore {
  load(connectionId: string): Promise<QuickBooksConnection | undefined>;
  provision(connection: Omit<QuickBooksConnection, "version" | "status">): Promise<void>;
  withRefreshLock<T>(
    connectionId: string,
    callback: (
      current: QuickBooksConnection,
      persist: (tokens: QuickBooksTokenUpdate) => Promise<QuickBooksConnection>,
    ) => Promise<T>,
  ): Promise<T>;
  markReauthorizationRequired(connectionId: string): Promise<void>;
}

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

/** Shared fixed-window limiter; adapters must make consume atomic. */
export interface RateLimiter {
  consume(key: string, limit: number, windowMs: number, now: number): Promise<RateLimitDecision>;
}

export type CallerIdentity = {
  issuer: string;
  subject: string;
  clientId: string;
  claims: Readonly<Record<string, unknown>>;
};

export type AuthorizationDecision =
  | { allowed: true; identity: CallerIdentity }
  | { allowed: false; reason: "missing_identity" | "tenant_binding_mismatch" };

/** Provider-neutral company binding policy. OAuth scopes are checked separately. */
export interface AuthorizationPolicy {
  authorize(claims: Readonly<Record<string, unknown>>): AuthorizationDecision;
}

export type OperationStatus = "prepared" | "executing" | "succeeded" | "failed" | "unknown";

export type OperationRecord = {
  id: string;
  connectionId: string;
  principalId: string;
  toolName: string;
  authority: Exclude<ToolAuthority, "read">;
  inputHash: string;
  status: OperationStatus;
};

export type PrepareOperationResult = {
  created: boolean;
  operationId: string;
  status: OperationStatus;
};

/** Durable audit/idempotency ledger for financial mutations. */
export interface OperationRepository {
  prepare(operation: OperationRecord): Promise<PrepareOperationResult>;
  transition(id: string, from: readonly OperationStatus[], to: OperationStatus): Promise<boolean>;
  recoverStale(preparedMaxAgeMs: number, executingMaxAgeMs: number): Promise<number>;
}

export type RuntimeServices = {
  connectionId: string;
  connectionStore: QuickBooksConnectionStore;
  rateLimiter: RateLimiter;
  authorizationPolicy: AuthorizationPolicy;
  operations: OperationRepository;
  requestStateCodec: {
    mint(payload: MutationRequestState, context: ServerContext): Promise<string>;
    verify(state: string, context: ServerContext): Promise<MutationRequestState>;
  };
};

export type MutationRequestState = {
  operationId: string;
  toolName: string;
  inputHash: string;
};
