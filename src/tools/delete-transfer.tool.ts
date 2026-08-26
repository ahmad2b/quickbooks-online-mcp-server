import type { QboHandlerDependencies } from "../runtime/contracts.js";
import { deleteQuickbooksTransfer } from "../handlers/delete-quickbooks-transfer.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "delete_transfer";
const toolDescription = "Delete a transfer in QuickBooks Online.";
const toolSchema = z.object({ idOrEntity: z.any() });

const toolHandler = async (args: any, _context?: unknown, dependencies?: QboHandlerDependencies) => {
  const response = await deleteQuickbooksTransfer(args.params.idOrEntity, dependencies);
  if (response.isError) return { content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
  return { content: [{ type: "text" as const, text: `Transfer deleted:` }, { type: "text" as const, text: JSON.stringify(response.result) }] };
};

export const DeleteTransferTool: ToolDefinition<typeof toolSchema> = { name: toolName, description: toolDescription, schema: toolSchema,
  authority: "delete",  handler: toolHandler };
