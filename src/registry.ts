import { materializeToolDefinition } from "./helpers/register-tool.js";
import { RegisteredToolDefinition } from "./types/tool-definition.js";

import { CreateInvoiceTool } from "./tools/create-invoice.tool.js";
import { ReadInvoiceTool } from "./tools/read-invoice.tool.js";
import { SearchInvoicesTool } from "./tools/search-invoices.tool.js";
import { UpdateInvoiceTool } from "./tools/update-invoice.tool.js";
import { GetInvoicePdfTool } from "./tools/get-invoice-pdf.tool.js";
import { CreateAccountTool } from "./tools/create-account.tool.js";
import { UpdateAccountTool } from "./tools/update-account.tool.js";
import { SearchAccountsTool } from "./tools/search-accounts.tool.js";
import { ReadItemTool } from "./tools/read-item.tool.js";
import { SearchItemsTool } from "./tools/search-items.tool.js";
import { CreateItemTool } from "./tools/create-item.tool.js";
import { UpdateItemTool } from "./tools/update-item.tool.js";
import { DeleteItemTool } from "./tools/delete-item.tool.js";
import { GetAccountTool } from "./tools/get-account.tool.js";
import { DeleteInvoiceTool } from "./tools/delete-invoice.tool.js";
import { CreateCustomerTool } from "./tools/create-customer.tool.js";
import { GetCustomerTool } from "./tools/get-customer.tool.js";
import { UpdateCustomerTool } from "./tools/update-customer.tool.js";
import { DeleteCustomerTool } from "./tools/delete-customer.tool.js";
import { CreateEstimateTool } from "./tools/create-estimate.tool.js";
import { GetEstimateTool } from "./tools/get-estimate.tool.js";
import { UpdateEstimateTool } from "./tools/update-estimate.tool.js";
import { DeleteEstimateTool } from "./tools/delete-estimate.tool.js";
import { SearchCustomersTool } from "./tools/search-customers.tool.js";
import { SearchEstimatesTool } from "./tools/search-estimates.tool.js";
import { CreateBillTool } from "./tools/create-bill.tool.js";
import { UpdateBillTool } from "./tools/update-bill.tool.js";
import { DeleteBillTool } from "./tools/delete-bill.tool.js";
import { GetBillTool } from "./tools/get-bill.tool.js";
import { CreateVendorTool } from "./tools/create-vendor.tool.js";
import { UpdateVendorTool } from "./tools/update-vendor.tool.js";
import { DeleteVendorTool } from "./tools/delete-vendor.tool.js";
import { GetVendorTool } from "./tools/get-vendor.tool.js";
import { SearchBillsTool } from "./tools/search-bills.tool.js";
import { SearchVendorsTool } from "./tools/search-vendors.tool.js";
import { CreateEmployeeTool } from "./tools/create-employee.tool.js";
import { GetEmployeeTool } from "./tools/get-employee.tool.js";
import { UpdateEmployeeTool } from "./tools/update-employee.tool.js";
import { SearchEmployeesTool } from "./tools/search-employees.tool.js";
import { DeleteEmployeeTool } from "./tools/delete-employee.tool.js";
import { CreateJournalEntryTool } from "./tools/create-journal-entry.tool.js";
import { GetJournalEntryTool } from "./tools/get-journal-entry.tool.js";
import { UpdateJournalEntryTool } from "./tools/update-journal-entry.tool.js";
import { DeleteJournalEntryTool } from "./tools/delete-journal-entry.tool.js";
import { SearchJournalEntriesTool } from "./tools/search-journal-entries.tool.js";
import { CreateBillPaymentTool } from "./tools/create-bill-payment.tool.js";
import { GetBillPaymentTool } from "./tools/get-bill-payment.tool.js";
import { UpdateBillPaymentTool } from "./tools/update-bill-payment.tool.js";
import { DeleteBillPaymentTool } from "./tools/delete-bill-payment.tool.js";
import { SearchBillPaymentsTool } from "./tools/search-bill-payments.tool.js";
import { CreatePurchaseTool } from "./tools/create-purchase.tool.js";
import { GetPurchaseTool } from "./tools/get-purchase.tool.js";
import { UpdatePurchaseTool } from "./tools/update-purchase.tool.js";
import { DeletePurchaseTool } from "./tools/delete-purchase.tool.js";
import { SearchPurchasesTool } from "./tools/search-purchases.tool.js";
import { CreatePaymentTool } from "./tools/create-payment.tool.js";
import { GetPaymentTool } from "./tools/get-payment.tool.js";
import { UpdatePaymentTool } from "./tools/update-payment.tool.js";
import { DeletePaymentTool } from "./tools/delete-payment.tool.js";
import { SearchPaymentsTool } from "./tools/search-payments.tool.js";
import { CreateSalesReceiptTool } from "./tools/create-sales-receipt.tool.js";
import { GetSalesReceiptTool } from "./tools/get-sales-receipt.tool.js";
import { UpdateSalesReceiptTool } from "./tools/update-sales-receipt.tool.js";
import { DeleteSalesReceiptTool } from "./tools/delete-sales-receipt.tool.js";
import { SearchSalesReceiptsTool } from "./tools/search-sales-receipts.tool.js";
import { CreateCreditMemoTool } from "./tools/create-credit-memo.tool.js";
import { GetCreditMemoTool } from "./tools/get-credit-memo.tool.js";
import { UpdateCreditMemoTool } from "./tools/update-credit-memo.tool.js";
import { DeleteCreditMemoTool } from "./tools/delete-credit-memo.tool.js";
import { SearchCreditMemosTool } from "./tools/search-credit-memos.tool.js";
import { CreateRefundReceiptTool } from "./tools/create-refund-receipt.tool.js";
import { GetRefundReceiptTool } from "./tools/get-refund-receipt.tool.js";
import { UpdateRefundReceiptTool } from "./tools/update-refund-receipt.tool.js";
import { DeleteRefundReceiptTool } from "./tools/delete-refund-receipt.tool.js";
import { SearchRefundReceiptsTool } from "./tools/search-refund-receipts.tool.js";
import { CreatePurchaseOrderTool } from "./tools/create-purchase-order.tool.js";
import { GetPurchaseOrderTool } from "./tools/get-purchase-order.tool.js";
import { UpdatePurchaseOrderTool } from "./tools/update-purchase-order.tool.js";
import { DeletePurchaseOrderTool } from "./tools/delete-purchase-order.tool.js";
import { SearchPurchaseOrdersTool } from "./tools/search-purchase-orders.tool.js";
import { CreateVendorCreditTool } from "./tools/create-vendor-credit.tool.js";
import { GetVendorCreditTool } from "./tools/get-vendor-credit.tool.js";
import { UpdateVendorCreditTool } from "./tools/update-vendor-credit.tool.js";
import { DeleteVendorCreditTool } from "./tools/delete-vendor-credit.tool.js";
import { SearchVendorCreditsTool } from "./tools/search-vendor-credits.tool.js";
import { CreateDepositTool } from "./tools/create-deposit.tool.js";
import { GetDepositTool } from "./tools/get-deposit.tool.js";
import { UpdateDepositTool } from "./tools/update-deposit.tool.js";
import { DeleteDepositTool } from "./tools/delete-deposit.tool.js";
import { SearchDepositsTool } from "./tools/search-deposits.tool.js";
import { CreateTransferTool } from "./tools/create-transfer.tool.js";
import { GetTransferTool } from "./tools/get-transfer.tool.js";
import { UpdateTransferTool } from "./tools/update-transfer.tool.js";
import { DeleteTransferTool } from "./tools/delete-transfer.tool.js";
import { SearchTransfersTool } from "./tools/search-transfers.tool.js";
import { CreateTimeActivityTool } from "./tools/create-time-activity.tool.js";
import { GetTimeActivityTool } from "./tools/get-time-activity.tool.js";
import { UpdateTimeActivityTool } from "./tools/update-time-activity.tool.js";
import { DeleteTimeActivityTool } from "./tools/delete-time-activity.tool.js";
import { SearchTimeActivitiesTool } from "./tools/search-time-activities.tool.js";
import { CreateClassTool } from "./tools/create-class.tool.js";
import { GetClassTool } from "./tools/get-class.tool.js";
import { UpdateClassTool } from "./tools/update-class.tool.js";
import { SearchClassesTool } from "./tools/search-classes.tool.js";
import { CreateDepartmentTool } from "./tools/create-department.tool.js";
import { GetDepartmentTool } from "./tools/get-department.tool.js";
import { UpdateDepartmentTool } from "./tools/update-department.tool.js";
import { SearchDepartmentsTool } from "./tools/search-departments.tool.js";
import { CreateTermTool } from "./tools/create-term.tool.js";
import { GetTermTool } from "./tools/get-term.tool.js";
import { UpdateTermTool } from "./tools/update-term.tool.js";
import { SearchTermsTool } from "./tools/search-terms.tool.js";
import { CreatePaymentMethodTool } from "./tools/create-payment-method.tool.js";
import { GetPaymentMethodTool } from "./tools/get-payment-method.tool.js";
import { UpdatePaymentMethodTool } from "./tools/update-payment-method.tool.js";
import { SearchPaymentMethodsTool } from "./tools/search-payment-methods.tool.js";
import { SearchBudgetsTool } from "./tools/search-budgets.tool.js";
import { GetTaxCodeTool } from "./tools/get-tax-code.tool.js";
import { SearchTaxCodesTool } from "./tools/search-tax-codes.tool.js";
import { GetTaxRateTool } from "./tools/get-tax-rate.tool.js";
import { SearchTaxRatesTool } from "./tools/search-tax-rates.tool.js";
import { GetTaxAgencyTool } from "./tools/get-tax-agency.tool.js";
import { SearchTaxAgenciesTool } from "./tools/search-tax-agencies.tool.js";
import { GetCompanyInfoTool } from "./tools/get-company-info.tool.js";
import { UpdateCompanyInfoTool } from "./tools/update-company-info.tool.js";
import { GetPreferencesTool } from "./tools/get-preferences.tool.js";
import { CreateAttachableTool } from "./tools/create-attachable.tool.js";
import { GetAttachableTool } from "./tools/get-attachable.tool.js";
import { UpdateAttachableTool } from "./tools/update-attachable.tool.js";
import { DeleteAttachableTool } from "./tools/delete-attachable.tool.js";
import { SearchAttachablesTool } from "./tools/search-attachables.tool.js";
import { GetBalanceSheetTool } from "./tools/get-balance-sheet.tool.js";
import { GetProfitAndLossTool } from "./tools/get-profit-and-loss.tool.js";
import { GetCashFlowTool } from "./tools/get-cash-flow.tool.js";
import { GetTrialBalanceTool } from "./tools/get-trial-balance.tool.js";
import { GetGeneralLedgerTool } from "./tools/get-general-ledger.tool.js";
import { GetCustomerSalesTool } from "./tools/get-customer-sales.tool.js";
import { GetAgedReceivablesTool } from "./tools/get-aged-receivables.tool.js";
import { GetCustomerBalanceTool } from "./tools/get-customer-balance.tool.js";
import { GetAgedPayablesTool } from "./tools/get-aged-payables.tool.js";
import { GetVendorExpensesTool } from "./tools/get-vendor-expenses.tool.js";
import { GetVendorBalanceTool } from "./tools/get-vendor-balance.tool.js";

/**
 * The complete executable QuickBooks tool registry.
 *
 * Definitions are kept as data so every transport consumes exactly the same
 * names, schemas, handlers, and authority metadata.
 */
const RAW_TOOL_DEFINITIONS = [
  CreateCustomerTool,
  GetCustomerTool,
  UpdateCustomerTool,
  DeleteCustomerTool,
  SearchCustomersTool,
  CreateEstimateTool,
  GetEstimateTool,
  UpdateEstimateTool,
  DeleteEstimateTool,
  SearchEstimatesTool,
  CreateBillTool,
  UpdateBillTool,
  DeleteBillTool,
  GetBillTool,
  SearchBillsTool,
  ReadInvoiceTool,
  SearchInvoicesTool,
  CreateInvoiceTool,
  UpdateInvoiceTool,
  DeleteInvoiceTool,
  GetInvoicePdfTool,
  CreateAccountTool,
  GetAccountTool,
  UpdateAccountTool,
  SearchAccountsTool,
  ReadItemTool,
  SearchItemsTool,
  CreateItemTool,
  UpdateItemTool,
  DeleteItemTool,
  CreateVendorTool,
  UpdateVendorTool,
  DeleteVendorTool,
  GetVendorTool,
  SearchVendorsTool,
  CreateEmployeeTool,
  GetEmployeeTool,
  UpdateEmployeeTool,
  DeleteEmployeeTool,
  SearchEmployeesTool,
  CreateJournalEntryTool,
  GetJournalEntryTool,
  UpdateJournalEntryTool,
  DeleteJournalEntryTool,
  SearchJournalEntriesTool,
  CreateBillPaymentTool,
  GetBillPaymentTool,
  UpdateBillPaymentTool,
  DeleteBillPaymentTool,
  SearchBillPaymentsTool,
  CreatePurchaseTool,
  GetPurchaseTool,
  UpdatePurchaseTool,
  DeletePurchaseTool,
  SearchPurchasesTool,
  CreatePaymentTool,
  GetPaymentTool,
  UpdatePaymentTool,
  DeletePaymentTool,
  SearchPaymentsTool,
  CreateSalesReceiptTool,
  GetSalesReceiptTool,
  UpdateSalesReceiptTool,
  DeleteSalesReceiptTool,
  SearchSalesReceiptsTool,
  CreateCreditMemoTool,
  GetCreditMemoTool,
  UpdateCreditMemoTool,
  DeleteCreditMemoTool,
  SearchCreditMemosTool,
  CreateRefundReceiptTool,
  GetRefundReceiptTool,
  UpdateRefundReceiptTool,
  DeleteRefundReceiptTool,
  SearchRefundReceiptsTool,
  CreatePurchaseOrderTool,
  GetPurchaseOrderTool,
  UpdatePurchaseOrderTool,
  DeletePurchaseOrderTool,
  SearchPurchaseOrdersTool,
  CreateVendorCreditTool,
  GetVendorCreditTool,
  UpdateVendorCreditTool,
  DeleteVendorCreditTool,
  SearchVendorCreditsTool,
  CreateDepositTool,
  GetDepositTool,
  UpdateDepositTool,
  DeleteDepositTool,
  SearchDepositsTool,
  CreateTransferTool,
  GetTransferTool,
  UpdateTransferTool,
  DeleteTransferTool,
  SearchTransfersTool,
  CreateTimeActivityTool,
  GetTimeActivityTool,
  UpdateTimeActivityTool,
  DeleteTimeActivityTool,
  SearchTimeActivitiesTool,
  CreateClassTool,
  GetClassTool,
  UpdateClassTool,
  SearchClassesTool,
  CreateDepartmentTool,
  GetDepartmentTool,
  UpdateDepartmentTool,
  SearchDepartmentsTool,
  CreateTermTool,
  GetTermTool,
  UpdateTermTool,
  SearchTermsTool,
  CreatePaymentMethodTool,
  GetPaymentMethodTool,
  UpdatePaymentMethodTool,
  SearchPaymentMethodsTool,
  SearchBudgetsTool,
  GetTaxCodeTool,
  SearchTaxCodesTool,
  GetTaxRateTool,
  SearchTaxRatesTool,
  GetTaxAgencyTool,
  SearchTaxAgenciesTool,
  GetCompanyInfoTool,
  UpdateCompanyInfoTool,
  GetPreferencesTool,
  CreateAttachableTool,
  GetAttachableTool,
  UpdateAttachableTool,
  DeleteAttachableTool,
  SearchAttachablesTool,
  GetBalanceSheetTool,
  GetProfitAndLossTool,
  GetCashFlowTool,
  GetTrialBalanceTool,
  GetGeneralLedgerTool,
  GetCustomerSalesTool,
  GetAgedReceivablesTool,
  GetCustomerBalanceTool,
  GetAgedPayablesTool,
  GetVendorExpensesTool,
  GetVendorBalanceTool,
] as const;

/** Materialized definitions are the only registry surface transports consume. */
export const TOOL_DEFINITIONS: readonly RegisteredToolDefinition[] = RAW_TOOL_DEFINITIONS.map(
  (definition) => materializeToolDefinition(definition),
);

export const TOOL_COUNT = TOOL_DEFINITIONS.length;

export function getToolDefinitions(): readonly RegisteredToolDefinition[] {
  return [...TOOL_DEFINITIONS]
    .sort((left, right) => left.name.localeCompare(right.name));
}
