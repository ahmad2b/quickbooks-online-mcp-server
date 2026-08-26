import { resolveQboHandlerDependencies } from "../clients/quickbooks-client.js";
import type { QboHandlerDependencies } from "../runtime/contracts.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

/**
 * Delete a bill in QuickBooks Online
 */
export async function deleteQuickbooksBill(bill: any, dependencies?: QboHandlerDependencies): Promise<ToolResponse<any>> {
  try {
    const quickbooks = await resolveQboHandlerDependencies(dependencies).qbo;

    return new Promise((resolve) => {
      quickbooks.deleteBill(bill, (err: any, deletedBill: any) => {
        if (err) {
          resolve({
            result: null,
            isError: true,
            error: formatError(err),
          });
        } else {
          resolve({
            result: deletedBill,
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
