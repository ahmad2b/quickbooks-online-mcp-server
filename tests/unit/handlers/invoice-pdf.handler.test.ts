import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockQuickbooksClient, mockQuickbooksClientClass, mockQuickBooksInstance, resetAllMocks } from '../../mocks/quickbooks.mock';

// ESM-compatible module mocking
jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
  QuickbooksClient: mockQuickbooksClientClass,
  resolveQboHandlerDependencies: () => ({
    execution: { requestId: "test-request", issuer: "https://issuer.test", subjectId: "test-subject", oauthClientId: "test-client", organizationId: "test-org", scopes: new Set(["quickbooks.read", "quickbooks.write", "quickbooks.delete"]) },
    qbo: mockQuickbooksClientClass.getInstance(),
    rawQbo: { accessToken: "mock-access-token", realmId: "mock-realm-id", environment: "sandbox" },
  }),
}));

// Dynamic import after mock setup
const { getQuickbooksInvoicePdf } = await import('../../../src/handlers/get-quickbooks-invoice-pdf.handler');

describe('getQuickbooksInvoicePdf', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it('returns the PDF buffer on success', async () => {
    const pdf = Buffer.from('%PDF-1.4 fake');
    mockQuickBooksInstance.getInvoicePdf.mockImplementation((_id: any, cb: any) => cb(null, pdf));

    const result = await getQuickbooksInvoicePdf('123');

    expect(result.isError).toBe(false);
    expect(result.result).toBe(pdf);
    expect(result.error).toBeNull();
  });

  it('passes the invoice id through to node-quickbooks', async () => {
    mockQuickBooksInstance.getInvoicePdf.mockImplementation((_id: any, cb: any) => cb(null, Buffer.from('x')));

    await getQuickbooksInvoicePdf('999');

    expect(mockQuickBooksInstance.getInvoicePdf).toHaveBeenCalledWith('999', expect.any(Function));
  });

  it('returns isError when the API callback yields an error', async () => {
    mockQuickBooksInstance.getInvoicePdf.mockImplementation((_id: any, cb: any) =>
      cb(new Error('Invoice not found'), null)
    );

    const result = await getQuickbooksInvoicePdf('missing');

    expect(result.isError).toBe(true);
    expect(result.result).toBeNull();
    expect(result.error).toContain('Invoice not found');
  });

  it('returns isError when authentication fails', async () => {
    (mockQuickbooksClientClass.getInstance as any).mockRejectedValue(new Error('Auth failed'));

    const result = await getQuickbooksInvoicePdf('123');

    expect(result.isError).toBe(true);
    expect(result.error).toContain('Auth failed');
  });

  it('returns isError when PDF exceeds the fixed 2 MiB remote cap', async () => {
    const oversized = Buffer.alloc(1);
    Object.defineProperty(oversized, 'length', { value: 2 * 1024 * 1024 + 1 });
    mockQuickBooksInstance.getInvoicePdf.mockImplementation((_id: any, cb: any) => cb(null, oversized));

    const result = await getQuickbooksInvoicePdf('huge');

    expect(result.isError).toBe(true);
    expect(result.error).toMatch(/remote inline cap/);
  });
});
