import { resolveQboHandlerDependencies } from "../clients/quickbooks-client.js";
import type { QboHandlerDependencies } from "../runtime/contracts.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

/**
 * Get an employee by ID from QuickBooks Online
 */
export async function getQuickbooksEmployee(id: string, dependencies?: QboHandlerDependencies): Promise<ToolResponse<any>> {
  try {
    const quickbooks = await resolveQboHandlerDependencies(dependencies).qbo;

    return new Promise((resolve) => {
      quickbooks.getEmployee(id, (err: any, employee: any) => {
        if (err) {
          resolve({
            result: null,
            isError: true,
            error: formatError(err),
          });
        } else {
          resolve({
            result: employee,
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