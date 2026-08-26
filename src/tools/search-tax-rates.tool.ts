import type { QboHandlerDependencies } from "../runtime/contracts.js";
import { searchQuickbooksTaxRates } from "../handlers/search-quickbooks-tax-rates.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "search_tax_rates";
const toolDescription = "Search for tax rates in QuickBooks Online with optional filters.";
const toolSchema = z.object({
  name: z.string().optional().describe("Filter by tax rate name"),
  active: z.boolean().optional().describe("Filter by active status"),
  limit: z.number().optional().describe("Maximum results to return"),
});

const toolHandler = async ({ params }: any, _context?: unknown, dependencies?: QboHandlerDependencies) => {
  const response = await searchQuickbooksTaxRates(params, dependencies);
  if (response.isError) return { content: [{ type: "text" as const, text: `Error: ${response.error}` }] };
  return { content: [{ type: "text" as const, text: `Found ${response.result.length} tax rates:` }, { type: "text" as const, text: JSON.stringify(response.result, null, 2) }] };
};

export const SearchTaxRatesTool: ToolDefinition<typeof toolSchema> = { name: toolName, description: toolDescription, schema: toolSchema,
  authority: "read",  handler: toolHandler };
