import type { QboHandlerDependencies } from "../runtime/contracts.js";
import { deleteQuickbooksRefundReceipt } from "../handlers/delete-quickbooks-refund-receipt.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "delete_refund_receipt";
const toolDescription = "Delete (void) a refund receipt in QuickBooks Online.";
const toolSchema = z.object({ idOrEntity: z.any() });

const toolHandler = async (args: any, _context?: unknown, dependencies?: QboHandlerDependencies) => {
  const response = await deleteQuickbooksRefundReceipt(args.params.idOrEntity, dependencies);
  if (response.isError) {
    return { content: [{ type: "text" as const, text: `Error deleting refund receipt: ${response.error}` }] };
  }
  return {
    content: [
      { type: "text" as const, text: `Refund receipt deleted:` },
      { type: "text" as const, text: JSON.stringify(response.result) },
    ],
  };
};

export const DeleteRefundReceiptTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  authority: "delete",
  handler: toolHandler,
};
