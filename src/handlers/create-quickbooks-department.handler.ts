import { resolveQboHandlerDependencies } from "../clients/quickbooks-client.js";
import type { QboHandlerDependencies } from "../runtime/contracts.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

export interface CreateDepartmentInput {
  name: string;
  parent_ref?: string;
  fully_qualified_name?: string;
}

export async function createQuickbooksDepartment(data: CreateDepartmentInput, dependencies?: QboHandlerDependencies): Promise<ToolResponse<any>> {
  try {
    const quickbooks = await resolveQboHandlerDependencies(dependencies).qbo;
    const payload: any = { Name: data.name };
    if (data.parent_ref) payload.ParentRef = { value: data.parent_ref };

    return new Promise((resolve) => {
      (quickbooks as any).createDepartment(payload, (err: any, created: any) => {
        if (err) resolve({ result: null, isError: true, error: formatError(err) });
        else resolve({ result: created, isError: false, error: null });
      });
    });
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}

