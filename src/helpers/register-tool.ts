import { z } from "zod";
import {
  RegisteredToolDefinition,
  ToolAuthority,
  ToolDefinition,
} from "../types/tool-definition.js";

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

/**
 * Determines the configuration CRUD category of a tool based on its name prefix.
 * Unknown prefixes continue to default to READ for the local stdio disable
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
): { allowed: true } | { allowed: false; result: Record<string, unknown> } {
  const scopes = (context as AuthContext | undefined)?.http?.authInfo?.scopes;
  if (!scopes) return { allowed: true };

  const required = ["quickbooks.read", definition.scope];
  const uniqueRequired = [...new Set(required)];
  const missing = uniqueRequired.filter((scope) => !scopes.includes(scope));
  if (missing.length === 0) return { allowed: true };

  return {
    allowed: false,
    result: {
      isError: true,
      content: [{
        type: "text",
        text: `Insufficient scope. This operation requires: ${uniqueRequired.join(", ")}.`,
      }],
    },
  };
}

/**
 * Registers one definition through the modern SDK adapter. The callback
 * receives direct modern input, then adapts it once for the internal handlers
 * that expect `{ params }`. No legacy MCP API is exposed.
 */
export function RegisterTool<T extends z.ZodType>(
  server: unknown,
  toolDefinition: ToolDefinition<T>,
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
      const authorization = authorizeToolContext(definition, context);
      if (!authorization.allowed) return authorization.result;
      return definition.handler({ params: input as z.infer<T> }, context) as any;
    },
  );

  return true;
}
