import type { QboHandlerDependencies } from "../runtime/contracts.js";
import { deleteQuickbooksPayment } from "../handlers/delete-quickbooks-payment.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "delete_payment";
const toolDescription = "Delete (void) a payment in QuickBooks Online.";
const toolSchema = z.object({ idOrEntity: z.any() });

const toolHandler = async (args: any, _context?: unknown, dependencies?: QboHandlerDependencies) => {
  const response = await deleteQuickbooksPayment(args.params.idOrEntity, dependencies);

  if (response.isError) {
    return { content: [{ type: "text" as const, text: `Error deleting payment: ${response.error}` }] };
  }

  return {
    content: [
      { type: "text" as const, text: `Payment deleted:` },
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const DeletePaymentTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  authority: "delete",
  handler: toolHandler,
};
