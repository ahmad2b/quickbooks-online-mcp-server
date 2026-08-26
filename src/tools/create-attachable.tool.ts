import { createQuickbooksAttachable } from "../handlers/create-quickbooks-attachable.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "create_attachable";
const toolDescription =
  "Create an attachable in QuickBooks Online. Small files may be supplied inline as base64; omitting content creates a metadata-only record. Server filesystem paths and server-side URL fetching are intentionally unavailable on the remote service.";

const toolSchema = z.object({
  file_name: z.string().min(1).describe("File name including extension (e.g., 'receipt.pdf')."),
  note: z.string().optional().describe("Optional note describing the attachment."),
  category: z.string().optional().describe("Optional QBO attachment category."),
  content_type: z
    .string()
    .optional()
    .describe(
      "MIME content type. Optional; inferred from file_name when omitted."
    ),
  base64_content: z
    .string()
    .max(2_796_204)
    .optional()
    .describe(
      "Base64-encoded file bytes. Maximum decoded size is 2 MiB so the complete MCP request remains within the remote HTTP body limit. Omit to create a metadata-only attachment."
    ),
  attachable_ref: z
    .object({
      entity_ref_type: z.string().describe("Entity type (e.g., 'Invoice', 'Bill', 'Purchase')."),
      entity_ref_value: z.string().describe("Entity ID to attach to."),
      include_on_send: z
        .boolean()
        .optional()
        .describe("If true, include this attachment when the parent entity is emailed to a customer."),
    })
    .optional()
    .describe("Optional reference to a QBO entity this file is attached to."),
}).strict();

const toolHandler = async ({ params }: any) => {
  const response = await createQuickbooksAttachable(params);
  if (response.isError) return { content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
  return {
    content: [
      { type: "text" as const, text: `Attachable created:` },
      { type: "text" as const, text: JSON.stringify(response.result, null, 2) },
    ],
  };
};

export const CreateAttachableTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
