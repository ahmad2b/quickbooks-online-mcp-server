import { resolveQboHandlerDependencies } from "../clients/quickbooks-client.js";
import type { QboHandlerDependencies } from "../runtime/contracts.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getQuickbooksRefundReceipt(id: string, dependencies?: QboHandlerDependencies): Promise<ToolResponse<any>> {
  try {
    const quickbooks = await resolveQboHandlerDependencies(dependencies).qbo;

    return new Promise((resolve) => {
      (quickbooks as any).getRefundReceipt(id, (err: any, refundReceipt: any) => {
        if (err) {
          resolve({ result: null, isError: true, error: formatError(err) });
        } else {
          resolve({ result: refundReceipt, isError: false, error: null });
        }
      });
    });
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
