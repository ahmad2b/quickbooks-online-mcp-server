import type { QboHandlerDependencies } from "../runtime/contracts.js";
import { updateQuickbooksAttachable } from "../handlers/update-quickbooks-attachable.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "update_attachable";
const toolDescription =
  "Update an existing attachable's metadata in QuickBooks Online. This cannot replace uploaded file bytes; create a new attachable and delete the old one to replace content.";
const toolSchema = z.object({
  id: z.string().min(1).describe("Attachable ID"),
  sync_token: z.string().min(1).describe("Sync token for concurrency"),
  file_name: z.string().optional().describe("Updated file name"),
  content_type: z.string().optional().describe("Updated MIME content type metadata."),
  note: z.string().optional().describe("Updated note"),
  category: z.string().optional().describe("Updated category"),
}).strict();

const toolHandler = async ({ params }: any, _context?: unknown, dependencies?: QboHandlerDependencies) => {
  const response = await updateQuickbooksAttachable(params, dependencies);
  if (response.isError) return { content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
  return { content: [{ type: "text" as const, text: `Attachable updated:` }, { type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
};

export const UpdateAttachableTool: ToolDefinition<typeof toolSchema> = { name: toolName, description: toolDescription, schema: toolSchema,
  authority: "write",  handler: toolHandler };
