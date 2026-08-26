import { resolveQboHandlerDependencies } from "../clients/quickbooks-client.js";
import type { QboHandlerDependencies } from "../runtime/contracts.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export async function getQuickbooksCompanyInfo(companyId?: string, dependencies?: QboHandlerDependencies): Promise<ToolResponse<any>> {
  try {
    const quickbooks = await resolveQboHandlerDependencies(dependencies).qbo;
    const id = companyId || (quickbooks as any).realmId;

    return new Promise((resolve) => {
      (quickbooks as any).getCompanyInfo(id, (err: any, info: any) => {
        if (err) resolve({ result: null, isError: true, error: formatError(err) });
        else resolve({ result: info, isError: false, error: null });
      });
    });
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
