import type { QboHandlerDependencies } from "../runtime/contracts.js";
import { deleteQuickbooksInvoice } from "../handlers/delete-quickbooks-invoice.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "delete_invoice";
const toolDescription = "Delete (void) an invoice in QuickBooks Online.";
const toolSchema = z.object({ idOrEntity: z.any() });

const toolHandler = async (args: any, _context?: unknown, dependencies?: QboHandlerDependencies) => {
  const response = await deleteQuickbooksInvoice(args.params.idOrEntity, dependencies);

  if (response.isError) {
    return { content: [{ type: "text" as const, text: `Error deleting invoice: ${response.error}` }] };
  }

  return {
    content: [
      { type: "text" as const, text: `Invoice deleted (voided):` },
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const DeleteInvoiceTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  authority: "delete",
  handler: toolHandler,
};
