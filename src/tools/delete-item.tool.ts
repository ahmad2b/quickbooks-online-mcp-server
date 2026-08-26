import type { QboHandlerDependencies } from "../runtime/contracts.js";
import { deleteQuickbooksItem } from "../handlers/delete-quickbooks-item.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "delete_item";
const toolDescription = "Delete (make inactive) an item in QuickBooks Online.";
const toolSchema = z.object({ idOrEntity: z.any() });

const toolHandler = async (args: any, _context?: unknown, dependencies?: QboHandlerDependencies) => {
  const response = await deleteQuickbooksItem(args.params.idOrEntity, dependencies);

  if (response.isError) {
    return { content: [{ type: "text" as const, text: `Error deleting item: ${response.error}` }] };
  }

  return {
    content: [
      { type: "text" as const, text: `Item deleted (made inactive):` },
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const DeleteItemTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  authority: "delete",
  handler: toolHandler,
};
