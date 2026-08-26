import type { QboHandlerDependencies } from "../runtime/contracts.js";
import { getQuickbooksRefundReceipt } from "../handlers/get-quickbooks-refund-receipt.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "get_refund_receipt";
const toolDescription = "Get a single refund receipt by ID from QuickBooks Online.";
const toolSchema = z.object({
  id: z.string().min(1).describe("The QuickBooks Refund Receipt ID"),
});

const toolHandler = async ({ params }: any, _context?: unknown, dependencies?: QboHandlerDependencies) => {
  const response = await getQuickbooksRefundReceipt(params.id, dependencies);
  if (response.isError) {
    return { content: [{ type: "text" as const, text: `Error getting refund receipt: ${response.error}` }] };
  }
  return {
    content: [
      { type: "text" as const, text: `Refund receipt found:` },
      { type: "text" as const, text: JSON.stringify(response.result, null, 2) },
    ],
  };
};

export const GetRefundReceiptTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  authority: "read",
  handler: toolHandler,
};
