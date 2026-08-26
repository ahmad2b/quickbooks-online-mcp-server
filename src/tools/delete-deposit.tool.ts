import type { QboHandlerDependencies } from "../runtime/contracts.js";
import { deleteQuickbooksDeposit } from "../handlers/delete-quickbooks-deposit.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "delete_deposit";
const toolDescription = "Delete a deposit in QuickBooks Online.";
const toolSchema = z.object({ idOrEntity: z.any() });

const toolHandler = async (args: any, _context?: unknown, dependencies?: QboHandlerDependencies) => {
  const response = await deleteQuickbooksDeposit(args.params.idOrEntity, dependencies);
  if (response.isError) return { content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
  return { content: [{ type: "text" as const, text: `Deposit deleted:` }, { type: "text" as const, text: JSON.stringify(response.result) }] };
};

export const DeleteDepositTool: ToolDefinition<typeof toolSchema> = { name: toolName, description: toolDescription, schema: toolSchema,
  authority: "delete",  handler: toolHandler };
