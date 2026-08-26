import { z } from "zod";
import type { QboHandlerDependencies } from "../runtime/contracts.js";

/**
 * The authority classes used by the protected HTTP resource server.
 *
 * UPDATE is deliberately represented as WRITE at the authorization boundary;
 * the configuration CRUD category is retained separately for the existing disable
 * environment variables.
 */
export type ToolAuthority = "read" | "write" | "delete";

export type ToolHandler<T extends z.ZodType = z.ZodType> = (
  args: { params: z.infer<T> },
  context?: unknown,
  dependencies?: QboHandlerDependencies,
) => unknown | Promise<unknown>;

export interface ToolDefinition<T extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: T;
  handler: ToolHandler<T>;
  /** Security authority is part of the source definition, not inferred at runtime. */
  authority: ToolAuthority;
}

export type RegisteredToolDefinition<T extends z.ZodType = z.ZodType> = ToolDefinition<T> & {
  authority: ToolAuthority;
  scope: `quickbooks.${ToolAuthority}`;
};
