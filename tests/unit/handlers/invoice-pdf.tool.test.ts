import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  mockQuickbooksClient,
  mockQuickbooksClientClass,
  mockQuickBooksInstance,
  resetAllMocks,
} from "../../mocks/quickbooks.mock";

jest.unstable_mockModule("../../../src/clients/quickbooks-client", () => ({
  quickbooksClient: mockQuickbooksClient,
  QuickbooksClient: mockQuickbooksClientClass,
  resolveQboHandlerDependencies: () => ({
    execution: { requestId: "test-request", issuer: "https://issuer.test", subjectId: "test-subject", oauthClientId: "test-client", organizationId: "test-org", companyId: "00000000-0000-4000-8000-000000000001", scopes: new Set(["quickbooks.read", "quickbooks.write", "quickbooks.delete"]) },
    qbo: mockQuickbooksClientClass.getInstance(),
    rawQbo: { accessToken: "mock-access-token", realmId: "mock-realm-id", environment: "sandbox" },
  }),
}));

const { GetInvoicePdfTool } = await import("../../../src/tools/get-invoice-pdf.tool");
const handler = (args: unknown) => (GetInvoicePdfTool.handler as any)({ params: args });

describe("GetInvoicePdfTool", () => {
  beforeEach(resetAllMocks);

  it("returns a bounded PDF inline as base64", async () => {
    const pdf = Buffer.from("%PDF-1.4 inline");
    mockQuickBooksInstance.getInvoicePdf.mockImplementation((_id: any, cb: any) => cb(null, pdf));

    const result = await handler({ invoice_id: "42" });

    expect(result.content[0].text).toContain("Invoice 42 PDF");
    expect(result.content[1].text).toBe(pdf.toString("base64"));
  });

  it("returns a safe MCP error without exposing upstream details", async () => {
    mockQuickBooksInstance.getInvoicePdf.mockImplementation((_id: any, cb: any) =>
      cb(new Error("realm-sensitive upstream error"), null));

    const result = await handler({ invoice_id: "missing" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Unable to download invoice missing as PDF.");
    expect(result.content[0].text).not.toContain("realm-sensitive");
  });

  it("rejects former server-filesystem arguments at the schema boundary", () => {
    expect(GetInvoicePdfTool.schema.safeParse({
      invoice_id: "42",
      output_path: "/tmp/invoice.pdf",
    }).success).toBe(false);
  });
});
