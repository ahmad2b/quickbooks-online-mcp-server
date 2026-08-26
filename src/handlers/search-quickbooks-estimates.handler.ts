import { resolveQboHandlerDependencies } from "../clients/quickbooks-client.js";
import type { QboHandlerDependencies } from "../runtime/contracts.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

/**
 * Search estimates from QuickBooks Online using the supplied criteria.
 * The criteria object is passed directly to node‑quickbooks `findEstimates`.
 */
export async function searchQuickbooksEstimates(criteria: object | Array<Record<string, any>> = {}, dependencies?: QboHandlerDependencies): Promise<ToolResponse<any[]>> {
  try {
    const quickbooks = await resolveQboHandlerDependencies(dependencies).qbo;

    return new Promise((resolve) => {
      (quickbooks as any).findEstimates(criteria as any, (err: any, estimates: any) => {
        if (err) {
          resolve({
            result: null,
            isError: true,
            error: formatError(err),
          });
        } else {
          resolve({
            result:
              estimates?.QueryResponse?.Estimate ??
              estimates?.QueryResponse?.totalCount ??
              [],
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
