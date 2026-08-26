import type QuickBooks from "node-quickbooks";
import type { ServerContext } from "@modelcontextprotocol/server";
import type { ToolAuthority } from "../types/tool-definition.js";

export type QuickBooksEnvironment = "sandbox" | "production";

export type QuickBooksScope =
  | "quickbooks.read"
  | "quickbooks.write"
  | "quickbooks.delete";

/**
 * The only tenant/connection context a business handler may receive. It is
 * assembled once from verified authorization claims and never from request
 * headers or tool input.
 */
export type ExecutionContext = Readonly<{
  requestId: string;
  issuer: string;
  subjectId: string;
  oauthClientId: string;
  organizationId: string;
  qboConnectionId: string;
  scopes: ReadonlySet<QuickBooksScope>;
}>;

/** Short-lived connection-service material; refresh tokens never cross this port. */
export type QboExecutionLease = Readonly<{
  leaseId: string;
  qboConnectionId: string;
  accessToken: string;
  realmId: string;
  environment: QuickBooksEnvironment;
  expiresAt: Date;
  credentialVersion: string;
}>;

/** Provider port; transport and workload authentication live outside MCP. */
export interface QboExecutionLeaseProvider {
  acquire(context: ExecutionContext): Promise<QboExecutionLease>;
  release?(lease: QboExecutionLease, context: ExecutionContext): Promise<void>;
}

/** Minimal raw QBO context for endpoints not wrapped by node-quickbooks. */
export type QboRawClient = Readonly<{
  accessToken: string;
  realmId: string;
  environment: QuickBooksEnvironment;
}>;

/** Request-scoped SDK/raw-client pair and lease lifecycle. */
export interface QboClientLease {
  readonly qbo: QuickBooks;
  readonly rawQbo: QboRawClient;
  readonly leaseId: string;
  readonly expiresAt: Date;
  close(): Promise<void>;
}

export interface QboClientFactory {
  create(context: ExecutionContext): Promise<QboClientLease>;
}

/** Explicit dependencies passed to each QuickBooks business handler. */
export type QboHandlerDependencies = Readonly<{
  execution: ExecutionContext;
  qbo: QuickBooks;
  rawQbo: QboRawClient;
}>;

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

/** Shared limiter; implementations must make consume atomic across replicas. */
export interface RateLimiter {
  consume(key: string, limit: number, windowMs: number, now: number): Promise<RateLimitDecision>;
}

export type CallerIdentity = {
  issuer: string;
  subject: string;
  clientId: string;
  organizationId: string;
  qboConnectionId: string;
  claims: Readonly<Record<string, unknown>>;
};

export type AuthorizationDecision =
  | { allowed: true; identity: CallerIdentity }
  | {
      allowed: false;
      reason:
        | "missing_identity"
        | "missing_organization"
        | "missing_connection"
        | "ambiguous_organization"
        | "ambiguous_connection";
    };

/** Provider-neutral connection-grant policy. OAuth scopes are checked separately. */
export interface AuthorizationPolicy {
  authorize(claims: Readonly<Record<string, unknown>>): AuthorizationDecision;
}

export type OperationStatus = "prepared" | "executing" | "succeeded" | "failed" | "unknown";

export type OperationRecord = {
  id: string;
  requestId: string;
  organizationId: string;
  connectionId: string;
  principalId: string;
  toolName: string;
  authority: Exclude<ToolAuthority, "read">;
  inputFingerprint: string;
  fingerprintKeyVersion: string;
  status: OperationStatus;
};

export type PrepareOperationResult = {
  created: boolean;
  operationId: string;
  status: OperationStatus;
};

/** Durable financial idempotency/ambiguity port. */
export interface OperationLedger {
  prepare(operation: OperationRecord): Promise<PrepareOperationResult>;
  transition(id: string, from: readonly OperationStatus[], to: OperationStatus): Promise<boolean>;
  recoverStale(preparedMaxAgeMs: number, executingMaxAgeMs: number): Promise<number>;
}

export type MutationRequestState = {
  operationId: string;
  toolName: string;
  inputFingerprint: string;
};

/** All execution dependencies are injected; no deployment-level company exists. */
export type RuntimeServices = {
  qboClientFactory: QboClientFactory;
  rateLimiter: RateLimiter;
  authorizationPolicy: AuthorizationPolicy;
  operationLedger: OperationLedger;
  operationFingerprint: {
    key: Uint8Array;
    keyVersion: string;
  };
  requestStateCodec: {
    mint(payload: MutationRequestState, context: ServerContext): Promise<string>;
    verify(state: string, context: ServerContext): Promise<MutationRequestState>;
  };
};
