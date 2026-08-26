import type { QboHandlerDependencies } from "../runtime/contracts.js";
import { getQuickbooksPurchaseOrder } from "../handlers/get-quickbooks-purchase-order.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "get_purchase_order";
const toolDescription = "Get a single purchase order by ID from QuickBooks Online.";
const toolSchema = z.object({ id: z.string().min(1).describe("Purchase Order ID") });

const toolHandler = async ({ params }: any, _context?: unknown, dependencies?: QboHandlerDependencies) => {
  const response = await getQuickbooksPurchaseOrder(params.id, dependencies);
  if (response.isError) {
    return { content: [{ type: "text" as const, text: `Error getting purchase order: ${response.error}` }] };
  }
  return {
    content: [
      { type: "text" as const, text: `Purchase order found:` },
      { type: "text" as const, text: JSON.stringify(response.result, null, 2) },
    ],
  };
};

export const GetPurchaseOrderTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  authority: "read",
  handler: toolHandler,
};
