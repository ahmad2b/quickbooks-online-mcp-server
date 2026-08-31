import { z } from "zod";
import { QboExecutionError } from "../clients/quickbooks-client.js";
import type {
  ExecutionContext,
  QboExecutionLease,
  QboExecutionLeaseProvider,
  QuickBooksEnvironment,
} from "../runtime/contracts.js";

const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_SAFETY_MARGIN_MS = 5_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const bindingSchema = z.object({
  organization_id: z.string().min(1).max(256),
  company_id: z.string().regex(UUID),
  qbo_connection_id: z.string().regex(UUID),
  environment: z.enum(["sandbox", "production"]),
  credential_version: z.string().min(1).max(128),
}).strict();

const leaseSchema = bindingSchema.extend({
  lease_id: z.string().regex(UUID),
  access_token: z.string().min(1).max(16_384),
  realm_id: z.string().min(1).max(128),
  expires_at: z.string().min(1).max(64),
}).strict();

export type FinanceExecutionLeaseProviderOptions = Readonly<{
  baseUrl: string | URL;
  workloadToken: string;
  environment: QuickBooksEnvironment;
  timeoutMs?: number;
  safetyMarginMs?: number;
  fetchImpl?: typeof fetch;
}>;

function unavailable(): QboExecutionError {
  return new QboExecutionError(
    "QBO_EXECUTION_LEASE_UNAVAILABLE",
    "The QuickBooks execution lease is unavailable",
  );
}

function invalid(): QboExecutionError {
  return new QboExecutionError(
    "QBO_EXECUTION_LEASE_INVALID",
    "The QuickBooks execution lease is invalid",
  );
}

function validBaseUrl(
  input: string | URL,
  environment: QuickBooksEnvironment,
): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Finance QuickBooks internal URL is invalid");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    (environment === "production" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new Error("Finance QuickBooks internal URL is invalid");
  }
  url.pathname = "/";
  return url;
}

function validWorkloadToken(value: string): string {
  if (
    value.length < 32 ||
    /\s/.test(value) ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new Error("Finance QuickBooks workload token is invalid");
  }
  return value;
}

function validPositiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const normalized = value ?? fallback;
  if (!Number.isInteger(normalized) || normalized <= 0 || normalized > 120_000) {
    throw new Error(`${name} is invalid`);
  }
  return normalized;
}

function requestBody(
  context: ExecutionContext,
  environment: QuickBooksEnvironment,
): Record<string, unknown> {
  return {
    request_id: context.requestId,
    organization_id: context.organizationId,
    company_id: context.companyId,
    environment,
    caller: {
      issuer: context.issuer,
      subject_id: context.subjectId,
      oauth_client_id: context.oauthClientId,
      scopes: [...context.scopes].sort(),
      ...(context.agentId ? { agent_id: context.agentId } : {}),
    },
  };
}

export class FinanceExecutionLeaseProvider implements QboExecutionLeaseProvider {
  private readonly baseUrl: URL;
  private readonly workloadToken: string;
  private readonly environment: QuickBooksEnvironment;
  private readonly timeoutMs: number;
  private readonly safetyMarginMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FinanceExecutionLeaseProviderOptions) {
    this.environment = options.environment;
    this.baseUrl = validBaseUrl(options.baseUrl, options.environment);
    this.workloadToken = validWorkloadToken(options.workloadToken);
    this.timeoutMs = validPositiveInteger(
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      "Finance QuickBooks timeout",
    );
    this.safetyMarginMs = validPositiveInteger(
      options.safetyMarginMs,
      DEFAULT_SAFETY_MARGIN_MS,
      "Finance QuickBooks lease safety margin",
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async acquire(context: ExecutionContext): Promise<QboExecutionLease> {
    const payload = await this.post("execution-lease", context);
    const parsed = leaseSchema.safeParse(payload);
    if (!parsed.success) throw invalid();
    this.assertBinding(parsed.data, context);
    const expiresAt = new Date(parsed.data.expires_at);
    if (
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt.getTime() <= Date.now() + this.safetyMarginMs
    ) {
      throw invalid();
    }
    return Object.freeze({
      leaseId: parsed.data.lease_id,
      qboConnectionId: parsed.data.qbo_connection_id,
      accessToken: parsed.data.access_token,
      realmId: parsed.data.realm_id,
      environment: parsed.data.environment,
      expiresAt,
      credentialVersion: parsed.data.credential_version,
    });
  }

  async release(_lease: QboExecutionLease, _context: ExecutionContext): Promise<void> {
    // The lease is logical and single-use in v1. Dropping request references is
    // sufficient; Finance exposes no release network operation.
  }

  private assertBinding(
    value: z.infer<typeof bindingSchema>,
    context: ExecutionContext,
  ): void {
    if (
      value.organization_id !== context.organizationId ||
      value.company_id !== context.companyId ||
      value.environment !== this.environment
    ) {
      throw invalid();
    }
  }

  private async post(path: string, context: ExecutionContext): Promise<unknown> {
    const url = new URL(`internal/v1/quickbooks/${path}`, this.baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.workloadToken}`,
        },
        body: JSON.stringify(requestBody(context, this.environment)),
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw unavailable();
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.startsWith("application/json")) throw invalid();
      const text = await response.text();
      if (!text || text.length > MAX_RESPONSE_BYTES) throw invalid();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw invalid();
      }
    } catch (error) {
      if (error instanceof QboExecutionError) throw error;
      throw unavailable();
    } finally {
      clearTimeout(timeout);
    }
  }
}

function required(
  env: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

export function financeExecutionLeaseProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): FinanceExecutionLeaseProvider {
  const provider = required(env, "QBO_EXECUTION_LEASE_PROVIDER");
  if (provider !== "finance-http") {
    throw new Error("QBO_EXECUTION_LEASE_PROVIDER must be finance-http");
  }
  const environment = required(env, "FINANCE_QUICKBOOKS_ENVIRONMENT");
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("FINANCE_QUICKBOOKS_ENVIRONMENT is invalid");
  }
  const timeoutRaw = env.FINANCE_QUICKBOOKS_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : DEFAULT_TIMEOUT_MS;
  return new FinanceExecutionLeaseProvider({
    baseUrl: required(env, "FINANCE_QUICKBOOKS_INTERNAL_URL"),
    workloadToken: required(env, "FINANCE_QUICKBOOKS_WORKLOAD_TOKEN"),
    environment,
    timeoutMs,
    fetchImpl,
  });
}
