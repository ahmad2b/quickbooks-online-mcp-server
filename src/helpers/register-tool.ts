import crypto from "node:crypto";
import type { ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  RegisteredToolDefinition,
  ToolAuthority,
  ToolDefinition,
} from "../types/tool-definition.js";
import type {
  ExecutionContext,
  QboHandlerDependencies,
  RuntimeServices,
} from "../runtime/contracts.js";
import { QboExecutionError } from "../clients/quickbooks-client.js";

/** Defines CRUD categories for deployment-wide emergency brakes. */
export const CRUD_CATEGORY = {
  WRITE: "WRITE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  READ: "READ",
} as const;

export type CrudCategory = typeof CRUD_CATEGORY[keyof typeof CRUD_CATEGORY];

export const DISABLE_ENV = {
  [CRUD_CATEGORY.WRITE]: "QUICKBOOKS_DISABLE_WRITE",
  [CRUD_CATEGORY.UPDATE]: "QUICKBOOKS_DISABLE_UPDATE",
  [CRUD_CATEGORY.DELETE]: "QUICKBOOKS_DISABLE_DELETE",
} as const;

export const PREFIX_CATEGORY_MAP: Record<string, CrudCategory> = {
  "create_": CRUD_CATEGORY.WRITE,
  "create-": CRUD_CATEGORY.WRITE,
  "update_": CRUD_CATEGORY.UPDATE,
  "update-": CRUD_CATEGORY.UPDATE,
  "delete_": CRUD_CATEGORY.DELETE,
  "delete-": CRUD_CATEGORY.DELETE,
};

const READ_PREFIXES = ["get_", "get-", "read_", "read-", "search_", "search-"];
const FORBIDDEN_EXECUTION_KEYS = new Set([
  "tenant",
  "tenantid",
  "organization",
  "organizationid",
  "orgid",
  "connection",
  "connectionid",
  "qboconnection",
  "qboconnectionid",
  "company",
  "companyid",
  "companyidentifier",
  "realm",
  "realmid",
  "environment",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "filepath",
  "outputpath",
  "fileurl",
  "overwrite",
]);

export const FORBIDDEN_EXECUTION_INPUT_MESSAGE =
  "Organization, company, connection, realm, environment, credential, and server-file fields are not accepted as tool input.";

export const DEVRAFTEL_ORGANIZATION_ID_META_KEY =
  "com.devraftel.finance/organization_id";
export const DEVRAFTEL_COMPANY_ID_META_KEY = "com.devraftel.finance/company_id";
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function getCrudCategory(toolName: string): CrudCategory {
  for (const [prefix, category] of Object.entries(PREFIX_CATEGORY_MAP)) {
    if (toolName.startsWith(prefix)) return category;
  }
  return CRUD_CATEGORY.READ;
}

export function getToolAuthority(toolName: string): ToolAuthority | undefined {
  const category = getCrudCategory(toolName);
  if (category === CRUD_CATEGORY.WRITE || category === CRUD_CATEGORY.UPDATE) return "write";
  if (category === CRUD_CATEGORY.DELETE) return "delete";
  if (READ_PREFIXES.some((prefix) => toolName.startsWith(prefix))) return "read";
  return undefined;
}

export function scopeForAuthority(authority: ToolAuthority): `quickbooks.${ToolAuthority}` {
  return `quickbooks.${authority}`;
}

/**
 * Materialize one definition and verify explicit authority metadata. Prefixes
 * remain a migration assertion for the incident kill-switch classification,
 * never a substitute for the security metadata required by the registry.
 */
export function materializeToolDefinition<T extends z.ZodType>(
  toolDefinition: ToolDefinition<T>,
): RegisteredToolDefinition<T> {
  const derived = getToolAuthority(toolDefinition.name);
  const authority = toolDefinition.authority;
  if (!authority) {
    throw new Error(`Tool ${toolDefinition.name} is missing explicit authority metadata`);
  }
  if (!derived) {
    throw new Error(`Tool ${toolDefinition.name} has no recognized authority class`);
  }
  if (authority !== derived) {
    throw new Error(
      `Tool ${toolDefinition.name} authority mismatch: registered ${authority}, expected ${derived}`,
    );
  }
  return {
    ...toolDefinition,
    authority,
    scope: scopeForAuthority(authority),
  };
}

export function isToolDisabled(toolName: string): boolean {
  const category = getCrudCategory(toolName);
  if (category === CRUD_CATEGORY.READ) return false;
  return process.env[DISABLE_ENV[category]] === "true";
}

type ModernToolConfig = {
  title?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, boolean>;
};

type ModernServer = {
  registerTool: (
    name: string,
    config: ModernToolConfig,
    callback: (input: unknown, context: unknown) => unknown,
  ) => unknown;
};

type AuthContext = {
  http?: {
    authInfo?: {
      scopes?: readonly string[];
      extra?: Record<string, unknown>;
    };
  };
  mcpReq?: {
    id?: string | number;
    method?: string;
  };
};

function claimsFromContext(context: ServerContext): Readonly<Record<string, unknown>> {
  const claims = context.http?.authInfo?.extra?.claims;
  return claims && typeof claims === "object" && !Array.isArray(claims)
    ? claims as Readonly<Record<string, unknown>>
    : {};
}

function metadataValue(meta: unknown, key: string): unknown {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  return (meta as Record<string, unknown>)[key];
}

/**
 * TEMPORARY unauthenticated-mode organization selector. It is transport
 * metadata, not model-visible tool input, and Finance remains the authority
 * that resolves whether the organization/company has an active connection.
 */
export function organizationIdFromMeta(meta: unknown): string | undefined {
  const raw = metadataValue(meta, DEVRAFTEL_ORGANIZATION_ID_META_KEY);
  if (
    typeof raw !== "string" ||
    raw !== raw.trim() ||
    raw.length === 0 ||
    raw.length > 256
  ) {
    return undefined;
  }
  return raw;
}

/** Read the Company selector injected by client runtime code. */
export function companyIdFromServerContext(context: ServerContext): string | undefined {
  const raw = metadataValue(context.mcpReq?._meta, DEVRAFTEL_COMPANY_ID_META_KEY);
  if (typeof raw !== "string" || raw !== raw.trim()) return undefined;
  const normalized = raw.toLowerCase();
  return CANONICAL_UUID_PATTERN.test(normalized) ? normalized : undefined;
}

/** Build the immutable context once from verified AuthInfo claims. */
export function executionContextFromServerContext(
  context: ServerContext,
  services: RuntimeServices,
): ExecutionContext | undefined {
  const authInfo = context.http?.authInfo;
  const decision = services.authorizationPolicy.authorize(claimsFromContext(context));
  if (!decision.allowed) return undefined;
  const identity = decision.identity;
  const companyId = companyIdFromServerContext(context);
  if (!companyId) return undefined;
  if (identity.agentId && identity.environment !== "sandbox") return undefined;
  // The verifier is responsible for cryptographic validation, but the
  // execution seam still refuses an inconsistent AuthInfo object. This keeps
  // custom test/deployment verifiers from substituting a different principal
  // for the client identity represented by the signed claims.
  if (!authInfo || authInfo.clientId !== identity.clientId) return undefined;
  const scopes = new Set(
    (context.http?.authInfo?.scopes ?? []).filter(
      (scope): scope is "quickbooks.read" | "quickbooks.write" | "quickbooks.delete" =>
        scope === "quickbooks.read" || scope === "quickbooks.write" || scope === "quickbooks.delete",
    ),
  );
  const requestId = context.mcpReq?.id === undefined
    ? crypto.randomUUID()
    : String(context.mcpReq.id);
  return Object.freeze({
    requestId,
    issuer: identity.issuer,
    subjectId: identity.subject,
    oauthClientId: identity.clientId,
    organizationId: identity.organizationId,
    companyId,
    ...(identity.agentId
      ? { agentId: identity.agentId, environment: identity.environment }
      : {}),
    scopes,
  });
}

export function authorizeToolContext(
  definition: RegisteredToolDefinition,
  context: unknown,
  services?: RuntimeServices,
): { allowed: true; execution: ExecutionContext } | { allowed: false; result: Record<string, unknown> } {
  const authInfo = (context as AuthContext | undefined)?.http?.authInfo;
  const scopes = authInfo?.scopes;
  if (!scopes || !services) {
    return {
      allowed: false,
      result: safeToolError("MCP_TOOL_NOT_AUTHORIZED", "This operation requires an authenticated HTTP context."),
    };
  }

  const required = ["quickbooks.read", definition.scope];
  const missing = [...new Set(required)].filter((scope) => !scopes.includes(scope));
  if (missing.length > 0) {
    return {
      allowed: false,
      result: safeToolError("MCP_TOOL_NOT_AUTHORIZED", "The caller is not authorized for this operation."),
    };
  }

  const execution = executionContextFromServerContext(context as ServerContext, services);
  if (!execution) {
    return {
      allowed: false,
      result: safeToolError("MCP_TOOL_NOT_AUTHORIZED", "The caller is not authorized for this QuickBooks connection."),
    };
  }
  return { allowed: true, execution };
}

function safeToolError(code: string, message = "The operation could not be completed."): Record<string, unknown> {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    _meta: { errorCode: code },
  };
}

function resultIsError(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const record = result as { isError?: unknown; content?: unknown };
  if (record.isError === true) return true;
  if (!Array.isArray(record.content)) return false;
  return record.content.some((item) => {
    if (!item || typeof item !== "object") return false;
    const text = (item as { text?: unknown }).text;
    return typeof text === "string" && /^error(?:\b|:)/i.test(text.trim());
  });
}

function normalizeToolResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  if (!resultIsError(result)) return result;
  return { ...(result as Record<string, unknown>), isError: true };
}

export function hasForbiddenExecutionField(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => hasForbiddenExecutionField(item, seen));
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    return FORBIDDEN_EXECUTION_KEYS.has(normalized) || hasForbiddenExecutionField(item, seen);
  });
}

async function executeWithLease(
  definition: RegisteredToolDefinition,
  input: unknown,
  context: ServerContext,
  execution: ExecutionContext,
  services: RuntimeServices,
): Promise<unknown> {
  const lease = await services.qboClientFactory.create(execution);
  try {
    const dependencies: QboHandlerDependencies = Object.freeze({
      execution,
      qbo: lease.qbo,
      rawQbo: lease.rawQbo,
    });
    return await definition.handler(
      { params: input as z.infer<typeof definition.schema> },
      context,
      dependencies,
    );
  } finally {
    await lease.close().catch(() => undefined);
  }
}

function qboErrorResult(error: unknown): Record<string, unknown> {
  if (error instanceof QboExecutionError) return safeToolError(error.code, error.message);
  return safeToolError("QBO_EXECUTION_LEASE_UNAVAILABLE", "The QuickBooks execution lease is unavailable.");
}

/**
 * Registers one definition through the modern SDK adapter. Every successful
 * execution obtains one request-scoped lease after authorization.
 */
export function RegisterTool<T extends z.ZodType>(
  server: unknown,
  toolDefinition: ToolDefinition<T>,
  services?: RuntimeServices,
): boolean {
  const registrationServer = server as ModernServer;
  const definition = materializeToolDefinition(toolDefinition);
  if (isToolDisabled(definition.name)) return false;
  if (typeof registrationServer.registerTool !== "function") {
    throw new Error(`Server does not support modern tool registration for ${definition.name}`);
  }

  const readOnly = definition.authority === "read";
  registrationServer.registerTool(
    definition.name,
    {
      title: definition.name,
      description: definition.description,
      inputSchema: definition.schema,
      annotations: {
        readOnlyHint: readOnly,
        destructiveHint: !readOnly,
        idempotentHint: readOnly,
        openWorldHint: true,
      },
    },
    async (input, context) => {
      if (hasForbiddenExecutionField(input)) {
        return safeToolError("MCP_TOOL_NOT_AUTHORIZED", FORBIDDEN_EXECUTION_INPUT_MESSAGE);
      }
      const authorization = authorizeToolContext(definition, context, services);
      if (!authorization.allowed) return authorization.result;
      const serverContext = context as ServerContext;
      const execution = authorization.execution;

      try {
        return normalizeToolResult(
          await executeWithLease(definition, input, serverContext, execution, services!),
        ) as any;
      } catch (error) {
        return qboErrorResult(error) as any;
      }
    },
  );
  return true;
}
