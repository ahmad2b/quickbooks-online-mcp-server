import { getQuickbooksInvoicePdf } from "../handlers/get-quickbooks-invoice-pdf.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "get_invoice_pdf";
const toolDescription =
  "Download a small QuickBooks Online invoice PDF inline as base64. The remote service never writes server filesystem paths. PDFs above the configured remote response cap are rejected until a private artifact-store adapter is configured.";

const toolSchema = z.object({
  invoice_id: z.string().min(1, { message: "Invoice ID is required" }),
}).strict();

const toolHandler = async ({ params }: { params: z.infer<typeof toolSchema> }) => {
  const { invoice_id } = params;
  const response = await getQuickbooksInvoicePdf(invoice_id);
  if (response.isError || !response.result) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Unable to download invoice ${invoice_id} as PDF.` }],
    };
  }
  const pdf = response.result;
  return {
    content: [
      { type: "text" as const, text: `Invoice ${invoice_id} PDF (${pdf.length} bytes, base64):` },
      { type: "text" as const, text: pdf.toString("base64") },
    ],
  };
};

export const GetInvoicePdfTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
};
