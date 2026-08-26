import crypto from "node:crypto";
import { acceptedContent, inputRequired, type ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  RegisteredToolDefinition,
  ToolAuthority,
  ToolDefinition,
} from "../types/tool-definition.js";
import type { RuntimeServices } from "../runtime/contracts.js";

/**
 * Defines CRUD categories for the existing environment-based disable policy.
 */
export const CRUD_CATEGORY = {
  WRITE: "WRITE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  READ: "READ",
} as const;

export type CrudCategory = typeof CRUD_CATEGORY[keyof typeof CRUD_CATEGORY];

/**
 * Maps each CRUD category to its corresponding environment variable for
 * disabling tools.
 */
export const DISABLE_ENV = {
  [CRUD_CATEGORY.WRITE]: "QUICKBOOKS_DISABLE_WRITE",
  [CRUD_CATEGORY.UPDATE]: "QUICKBOOKS_DISABLE_UPDATE",
  [CRUD_CATEGORY.DELETE]: "QUICKBOOKS_DISABLE_DELETE",
} as const;

/**
 * Maps every non-READ verb prefix to its category. Existing tool identifiers
 * use both underscore and hyphen separators.
 */
export const PREFIX_CATEGORY_MAP: Record<string, CrudCategory> = {
  "create_": CRUD_CATEGORY.WRITE,
  "create-": CRUD_CATEGORY.WRITE,
  "update_": CRUD_CATEGORY.UPDATE,
  "update-": CRUD_CATEGORY.UPDATE,
  "delete_": CRUD_CATEGORY.DELETE,
  "delete-": CRUD_CATEGORY.DELETE,
};

const READ_PREFIXES = ["get_", "get-", "read_", "read-", "search_", "search-"];
const MUTATION_CONFIRMATION_SCHEMA = z.object({
  confirm: z.boolean().describe("Set true to execute this financial mutation."),
});

/**
 * Determines the configuration CRUD category of a tool based on its name prefix.
 * Unknown prefixes continue to default to READ for the configuration disable
 * behavior. Network registration uses getToolAuthority(), which is strict.
 */
export function getCrudCategory(toolName: string): CrudCategory {
  for (const [prefix, category] of Object.entries(PREFIX_CATEGORY_MAP)) {
    if (toolName.startsWith(prefix)) return category;
  }
  return CRUD_CATEGORY.READ;
}

/**
 * Converts an explicitly recognized tool-name prefix into the authority class
 * used by OAuth scope checks. Unknown or missing prefixes fail closed.
 */
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

export function materializeToolDefinition<T extends z.ZodType>(
  toolDefinition: ToolDefinition<T>,
): RegisteredToolDefinition<T> {
  const derived = getToolAuthority(toolDefinition.name);
  const authority = toolDefinition.authority ?? derived;

  if (!authority || !derived) {
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

/** Checks if a tool is disabled based on its configuration CRUD category. */
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
};

/**
 * Returns a tool result for a scope denial. HTTP callers are denied by the
 * boundary middleware before dispatch; this second check prevents a future
 * adapter from accidentally bypassing the same policy.
 */
export function authorizeToolContext(
  definition: RegisteredToolDefinition,
  context: unknown,
  services?: RuntimeServices,
): { allowed: true } | { allowed: false; result: Record<string, unknown> } {
  const authInfo = (context as AuthContext | undefined)?.http?.authInfo;
  const scopes = authInfo?.scopes;
  if (!scopes || !services) {
    return {
      allowed: false,
      result: safeToolError("This operation requires an authenticated HTTP context."),
    };
  }

  const required = ["quickbooks.read", definition.scope];
  const uniqueRequired = [...new Set(required)];
  const missing = uniqueRequired.filter((scope) => !scopes.includes(scope));
  if (missing.length > 0) {
    return {
      allowed: false,
      result: safeToolError("The caller is not authorized for this operation."),
    };
  }

  const claims = authInfo.extra?.claims;
  const decision = services.authorizationPolicy.authorize(
    claims && typeof claims === "object" && !Array.isArray(claims)
      ? claims as Record<string, unknown>
      : {},
  );
  if (!decision.allowed) {
    return { allowed: false, result: safeToolError("The caller is not authorized for this QuickBooks company.") };
  }
  return { allowed: true };
}

function safeToolError(message = "The operation could not be completed."): Record<string, unknown> {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function hashInput(input: unknown): string {
  return crypto.createHash("sha256").update(canonicalJson(input)).digest("hex");
}

function claimsFromContext(context: ServerContext): Record<string, unknown> {
  const claims = context.http?.authInfo?.extra?.claims;
  return claims && typeof claims === "object" && !Array.isArray(claims)
    ? claims as Record<string, unknown>
    : {};
}

function principalId(context: ServerContext): string {
  const claims = claimsFromContext(context);
  return crypto.createHash("sha256")
    .update(`${String(claims.iss ?? "")}\0${String(claims.sub ?? "")}\0${String(claims.client_id ?? claims.azp ?? "")}`)
    .digest("hex");
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

/**
 * Registers one definition through the modern SDK adapter. The callback
 * receives direct modern input, then adapts it once for the internal handlers
 * that expect `{ params }`. No legacy MCP API is exposed.
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
      const authorization = authorizeToolContext(definition, context, services);
      if (!authorization.allowed) return authorization.result;
      const serverContext = context as ServerContext;
      if (definition.authority === "read") {
        try {
          return normalizeToolResult(
            await definition.handler({ params: input as z.infer<T> }, context),
          ) as any;
        } catch {
          return safeToolError() as any;
        }
      }

      const inputHash = hashInput(input);
      const priorState = serverContext.mcpReq.requestState<{
        operationId: string;
        toolName: string;
        inputHash: string;
      }>();
      if (!priorState) {
        const operationId = crypto.randomUUID();
        const prepared = await services!.operations.prepare({
          id: operationId,
          connectionId: services!.connectionId,
          principalId: principalId(serverContext),
          toolName: definition.name,
          authority: definition.authority,
          inputHash,
          status: "prepared",
        });
        if (!prepared.created) {
          return safeToolError(
            `A matching operation is still ${prepared.status}. Reconcile operation ${prepared.operationId} before retrying.`,
          ) as any;
        }
        const requestState = await services!.requestStateCodec.mint({
          operationId,
          toolName: definition.name,
          inputHash,
        }, serverContext);
        return inputRequired({
          inputRequests: {
            confirm: inputRequired.elicit({
              message: `Confirm ${definition.name} against the configured QuickBooks company.`,
              requestedSchema: MUTATION_CONFIRMATION_SCHEMA,
            }),
          },
          requestState,
        });
      }

      if (priorState.toolName !== definition.name || priorState.inputHash !== inputHash) {
        return safeToolError("The confirmation does not match this operation.") as any;
      }
      const confirmation = acceptedContent(
        serverContext.mcpReq.inputResponses,
        "confirm",
        MUTATION_CONFIRMATION_SCHEMA,
      );
      if (confirmation?.confirm !== true) {
        await services!.operations.transition(priorState.operationId, ["prepared"], "failed");
        return safeToolError("The operation was not confirmed.") as any;
      }
      const claimed = await services!.operations.transition(
        priorState.operationId,
        ["prepared"],
        "executing",
      );
      if (!claimed) return safeToolError("This operation has already been processed.") as any;

      try {
        const result = normalizeToolResult(
          await definition.handler({ params: input as z.infer<T> }, context),
        );
        await services!.operations.transition(
          priorState.operationId,
          ["executing"],
          resultIsError(result) ? "failed" : "succeeded",
        );
        return result as any;
      } catch {
        // Once handler dispatch begins, a transport timeout or thrown callback
        // cannot prove whether QuickBooks committed the mutation. Record the
        // ambiguity and prohibit blind automatic replay.
        await services!.operations.transition(priorState.operationId, ["executing"], "unknown");
        return safeToolError(
          `The operation outcome is unknown. Reconcile operation ${priorState.operationId} before retrying.`,
        ) as any;
      }
    },
  );

  return true;
}
