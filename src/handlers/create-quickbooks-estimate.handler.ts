import { resolveQboHandlerDependencies } from "../clients/quickbooks-client.js";
import type { QboHandlerDependencies } from "../runtime/contracts.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

/**
 * Create an estimate in QuickBooks Online
 */
export async function createQuickbooksEstimate(estimateData: any, dependencies?: QboHandlerDependencies): Promise<ToolResponse<any>> {
  try {
    const quickbooks = await resolveQboHandlerDependencies(dependencies).qbo;

    return new Promise((resolve) => {
      quickbooks.createEstimate(estimateData, (err: any, estimate: any) => {
        if (err) {
          resolve({
            result: null,
            isError: true,
            error: formatError(err),
          });
        } else {
          resolve({
            result: estimate,
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
