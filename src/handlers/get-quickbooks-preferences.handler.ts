import { resolveQboHandlerDependencies } from "../clients/quickbooks-client.js";
import type { QboHandlerDependencies } from "../runtime/contracts.js";
import { formatError } from "../helpers/format-error.js";
import { ToolResponse } from "../types/tool-response.js";

export async function getQuickbooksPreferences(dependencies?: QboHandlerDependencies): Promise<ToolResponse<any>> {
  try {
    const quickbooks = await resolveQboHandlerDependencies(dependencies).qbo;

    return new Promise((resolve) => {
      (quickbooks as any).getPreferences((err: any, preferences: any) => {
        if (err) resolve({ result: null, isError: true, error: formatError(err) });
        else resolve({ result: preferences, isError: false, error: null });
      });
    });
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
