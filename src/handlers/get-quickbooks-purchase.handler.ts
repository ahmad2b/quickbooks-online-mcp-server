import { resolveQboHandlerDependencies } from "../clients/quickbooks-client.js";
import type { QboHandlerDependencies } from "../runtime/contracts.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

/**
 * Get a purchase by ID from QuickBooks Online
 */
export async function getQuickbooksPurchase(id: string, dependencies?: QboHandlerDependencies): Promise<ToolResponse<any>> {
  try {
    const quickbooks = await resolveQboHandlerDependencies(dependencies).qbo;

    return new Promise((resolve) => {
      quickbooks.getPurchase(id, (err: any, purchase: any) => {
        if (err) {
          resolve({
            result: null,
            isError: true,
            error: formatError(err),
          });
        } else {
          resolve({
            result: purchase,
            isError: false,
            error: null,
          });
        }
      });
    });
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error),
    };
  }
} 