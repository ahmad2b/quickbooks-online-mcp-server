import type QuickBooks from "node-quickbooks";

export type QuickBooksEnvironment = "sandbox" | "production";

export type QuickBooksScope =
  | "quickbooks.read"
  | "quickbooks.write"
  | "quickbooks.delete";

/**
 * The only caller context a business handler may receive. It is assembled once
 * from verified authorization claims and never from request headers or tool
 * input. A connection is resolved separately by QboExecutionLeaseProvider.
 */
export type ExecutionContext = Readonly<{
  requestId: string;
  issuer: string;
  subjectId: string;
  oauthClientId: string;
  organizationId: string;
  companyId: string;
  agentId?: string;
  environment?: "sandbox";
  scopes: ReadonlySet<QuickBooksScope>;
}>;

/** Short-lived trusted connection-service material; refresh tokens never cross this port. */
export type QboExecutionLease = Readonly<{
  leaseId: string;
  qboConnectionId: string;
  accessToken: string;
  realmId: string;
  environment: QuickBooksEnvironment;
  expiresAt: Date;
  credentialVersion: string;
}>;

/**
 * Provider port; transport and workload authentication live outside MCP. The
 * provider resolves the authorized connection from the caller context and
 * returns it only in the trusted, short-lived lease.
 */
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
  /** Trusted connection binding returned by the lease provider. */
  readonly qboConnectionId: string;
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

export type CallerIdentity = {
  issuer: string;
  subject: string;
  clientId: string;
  organizationId: string;
  agentId?: string;
  companyId?: string;
  environment?: "sandbox";
};

export type AuthorizationDecision =
  | { allowed: true; identity: CallerIdentity }
  | {
      allowed: false;
      reason:
        | "missing_identity"
        | "missing_organization"
        | "ambiguous_organization"
        | "missing_agent_binding";
    };

/** Provider-neutral caller/organization policy. OAuth scopes are checked separately. */
export interface AuthorizationPolicy {
  authorize(claims: Readonly<Record<string, unknown>>): AuthorizationDecision;
}

/** All execution dependencies are injected; no deployment-level company exists. */
export type RuntimeServices = {
  qboClientFactory: QboClientFactory;
  authorizationPolicy: AuthorizationPolicy;
};
