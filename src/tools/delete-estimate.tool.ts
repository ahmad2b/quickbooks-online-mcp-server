import type { QboHandlerDependencies } from "../runtime/contracts.js";
import { deleteQuickbooksEstimate } from "../handlers/delete-quickbooks-estimate.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "delete_estimate";
const toolDescription = "Delete (void) an estimate in QuickBooks Online.";
const toolSchema = z.object({ idOrEntity: z.any() });

const toolHandler = async (args: any, _context?: unknown, dependencies?: QboHandlerDependencies) => {
  const response = await deleteQuickbooksEstimate(args.params.idOrEntity, dependencies);
  if (response.isError) {
    return { content: [{ type: "text" as const, text: `Error deleting estimate: ${response.error}` }] };
  }
  return {
    content: [
      { type: "text" as const, text: `Estimate deleted:` },
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const DeleteEstimateTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  authority: "delete",
  handler: toolHandler,
};