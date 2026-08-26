# QuickBooks Online MCP Server

<div align="center">

**A comprehensive Model Context Protocol (MCP) server for QuickBooks Online**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tools](https://img.shields.io/badge/Tools-142-green.svg)](#available-tools)
[![Entities](https://img.shields.io/badge/Entities-29-orange.svg)](#entities)
[![Reports](https://img.shields.io/badge/Reports-11-purple.svg)](#reports)
[![Coverage](https://img.shields.io/badge/Coverage-configured%20gates%20passing-brightgreen.svg)](#testing)
[![Tests](https://img.shields.io/badge/Tests-531-blue.svg)](#testing)

[Quick Start](#quick-start) | [Available Tools](#available-tools) | [Authentication](#authentication) | [Documentation](#documentation)

</div>

---

## Overview

This server provides QuickBooks Online tools to any client conforming to modern
MCP `2026-07-28` Streamable HTTP and its OAuth profile. It is HTTP-only at
`POST /mcp`; stdio, the legacy initialization lifecycle, and legacy HTTP+SSE
are intentionally absent.

### Key Features

- **142 Total Tools** - Complete coverage of QuickBooks Online API
- **29 Entity Types** - Full CRUD operations (Create, Read, Update, Delete, Search)
- **11 Financial Reports** - Balance Sheet, P&L, Cash Flow, and more
- **OAuth 2.0 Authentication** - Secure token-based authentication
- **TypeScript** - Full type safety with Zod validation
- **Tested** - Jest test suite with ESM support

Production requires a standards-compliant OAuth authorization server for MCP,
an Intuit application/company connection, and PostgreSQL. MCP identity and
Intuit credentials are separate trust domains.

---

## Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/mcp-quickbooks-online.git
cd mcp-quickbooks-online

# Install dependencies
npm install

# Build the project
npm run build
```

### Configuration

Copy the template and supply the resource URL, authorization-server metadata,
provider-neutral company-binding claim, PostgreSQL URL, independent encryption
keys, and Intuit application credentials:

```bash
cp .env.example .env
```

Generate both 32-byte keys independently with `openssl rand -base64 32`.
`.env` is gitignored, but deployed secrets should use the platform secret store.

### Remote Streamable HTTP

The executable always starts Streamable HTTP. Startup validates the exact HTTPS
resource URI, explicit host/origin allowlists, OAuth metadata and verifier,
caller-to-company binding, PostgreSQL schema/state, and encrypted QuickBooks
connection. It never opens a browser or writes a token file.

```env
MCP_HOST=127.0.0.1
MCP_PORT=3000
MCP_RESOURCE_URI=https://your-final-host.example/mcp
MCP_ALLOWED_HOSTS=your-final-host.example
MCP_ALLOWED_ORIGINS=your-final-client.example
MCP_AUTH_ISSUER=https://authorization-server.example/issuer
MCP_AUTH_METADATA_URL=https://authorization-server.example/.well-known/oauth-authorization-server
MCP_AUTH_JWKS_URL=https://authorization-server.example/jwks
MCP_AUTH_BINDING_CLAIM=organization_id
MCP_AUTH_ALLOWED_BINDING_VALUES=authorized-organization-id
DATABASE_URL=postgresql://...
MCP_DATA_ENCRYPTION_KEY=...
MCP_REQUEST_STATE_KEY=...
QUICKBOOKS_CONNECTION_ID=primary-company
# Or use MCP_AUTH_INTROSPECTION_URL plus MCP_AUTH_INTROSPECTION_CLIENT_ID/SECRET.
```

The configured authorization server protects this resource with
`quickbooks.read`, `quickbooks.write`, and `quickbooks.delete`. AuthCo is the
initial deployment choice, not a runtime dependency. See
[`docs/REMOTE-HTTP.md`](docs/REMOTE-HTTP.md) for durable state, confirmation,
and deployment validation.

### MCP client integration

Configure the client with the public `https://your-host.example/mcp` URL. The
client must implement MCP `2026-07-28` Streamable HTTP, OAuth discovery, and
multi-round-trip `input_required` for confirmed write/delete calls.

Set any of the `DISABLE_*` flags to `"true"` to prevent that category of tools from being registered. Read tools (`get_*`, `search_*`) are always available.

---

## Available Tools

### Entities

Complete CRUD operations are available for all entity types:

| Entity | Create | Get | Update | Delete | Search |
|--------|:------:|:---:|:------:|:------:|:------:|
| **Customer** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Invoice** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Estimate** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Bill** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Vendor** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Employee** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Account** | ✅ | ✅ | ✅ | - | ✅ |
| **Item** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Journal Entry** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Bill Payment** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Purchase** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Payment** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Sales Receipt** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Credit Memo** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Refund Receipt** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Purchase Order** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Vendor Credit** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Deposit** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Transfer** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Time Activity** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Class** | ✅ | ✅ | ✅ | - | ✅ |
| **Department** | ✅ | ✅ | ✅ | - | ✅ |
| **Term** | ✅ | ✅ | ✅ | - | ✅ |
| **Payment Method** | ✅ | ✅ | ✅ | - | ✅ |
| **Tax Code** | - | ✅ | - | - | ✅ |
| **Tax Rate** | - | ✅ | - | - | ✅ |
| **Tax Agency** | - | ✅ | - | - | ✅ |
| **Company Info** | - | ✅ | ✅ | - | - |
| **Attachable** | ✅ | ✅ | ✅ | ✅ | ✅ |

### Reports

| Report | Tool Name | Description |
|--------|-----------|-------------|
| **Balance Sheet** | `get_balance_sheet` | Assets, liabilities, and equity snapshot |
| **Profit & Loss** | `get_profit_and_loss` | Income and expenses over a period |
| **Cash Flow** | `get_cash_flow` | Cash inflows and outflows |
| **Trial Balance** | `get_trial_balance` | Debit and credit balances |
| **General Ledger** | `get_general_ledger` | Complete transaction history |
| **Customer Sales** | `get_customer_sales` | Sales by customer |
| **Aged Receivables** | `get_aged_receivables` | Outstanding customer invoices |
| **Aged Receivables Detail** | `get_aged_receivables_detail` | Detailed aging breakdown |
| **Customer Balance** | `get_customer_balance` | Current customer balances |
| **Aged Payables** | `get_aged_payables` | Outstanding vendor bills |
| **Vendor Expenses** | `get_vendor_expenses` | Expenses by vendor |

---

## Tool Reference

<details>
<summary><strong>Customer Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `create_customer` | Create a new customer |
| `get_customer` | Get customer by ID |
| `update_customer` | Update customer details |
| `delete_customer` | Delete a customer |
| `search_customers` | Search customers with filters |

</details>

<details>
<summary><strong>Invoice Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `create_invoice` | Create a new invoice |
| `get_invoice` | Get invoice by ID |
| `update_invoice` | Update invoice details |
| `delete_invoice` | Delete/void an invoice |
| `search_invoices` | Search invoices with filters |
| `get_invoice_pdf` | Download a PDF inline when it is within the 2 MiB remote cap |

</details>

<details>
<summary><strong>Payment Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `create_payment` | Record a customer payment |
| `get_payment` | Get payment by ID |
| `update_payment` | Update payment details |
| `delete_payment` | Void a payment |
| `search_payments` | Search payments with filters |

</details>

<details>
<summary><strong>Bill & Vendor Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `create_bill` | Create a new bill |
| `get_bill` | Get bill by ID |
| `update_bill` | Update bill details |
| `delete_bill` | Delete a bill |
| `search_bills` | Search bills with filters |
| `create_vendor` | Create a new vendor |
| `get_vendor` | Get vendor by ID |
| `update_vendor` | Update vendor details |
| `delete_vendor` | Delete a vendor |
| `search_vendors` | Search vendors with filters |
| `create_bill_payment` | Create a bill payment |
| `get_bill_payment` | Get bill payment by ID |
| `update_bill_payment` | Update bill payment |
| `delete_bill_payment` | Delete a bill payment |
| `search_bill_payments` | Search bill payments |

</details>

<details>
<summary><strong>Sales Receipt & Credit Memo Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `create_sales_receipt` | Create a sales receipt |
| `get_sales_receipt` | Get sales receipt by ID |
| `update_sales_receipt` | Update sales receipt |
| `delete_sales_receipt` | Void a sales receipt |
| `search_sales_receipts` | Search sales receipts |
| `create_credit_memo` | Create a credit memo |
| `get_credit_memo` | Get credit memo by ID |
| `update_credit_memo` | Update credit memo |
| `delete_credit_memo` | Void a credit memo |
| `search_credit_memos` | Search credit memos |
| `create_refund_receipt` | Create a refund receipt |
| `get_refund_receipt` | Get refund receipt by ID |
| `update_refund_receipt` | Update refund receipt |
| `delete_refund_receipt` | Void a refund receipt |
| `search_refund_receipts` | Search refund receipts |

</details>

<details>
<summary><strong>Banking Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `create_deposit` | Create a bank deposit |
| `get_deposit` | Get deposit by ID |
| `update_deposit` | Update deposit details |
| `delete_deposit` | Delete a deposit |
| `search_deposits` | Search deposits |
| `create_transfer` | Create an account transfer |
| `get_transfer` | Get transfer by ID |
| `update_transfer` | Update transfer details |
| `delete_transfer` | Delete a transfer |
| `search_transfers` | Search transfers |

</details>

<details>
<summary><strong>Purchase Order & Vendor Credit Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `create_purchase_order` | Create a purchase order |
| `get_purchase_order` | Get purchase order by ID |
| `update_purchase_order` | Update purchase order |
| `delete_purchase_order` | Delete a purchase order |
| `search_purchase_orders` | Search purchase orders |
| `create_vendor_credit` | Create a vendor credit |
| `get_vendor_credit` | Get vendor credit by ID |
| `update_vendor_credit` | Update vendor credit |
| `delete_vendor_credit` | Delete a vendor credit |
| `search_vendor_credits` | Search vendor credits |

</details>

<details>
<summary><strong>Time Tracking Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `create_time_activity` | Create a time activity |
| `get_time_activity` | Get time activity by ID |
| `update_time_activity` | Update time activity |
| `delete_time_activity` | Delete a time activity |
| `search_time_activities` | Search time activities |

</details>

<details>
<summary><strong>Classification Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `create_class` | Create a class |
| `get_class` | Get class by ID |
| `update_class` | Update class details |
| `search_classes` | Search classes |
| `create_department` | Create a department |
| `get_department` | Get department by ID |
| `update_department` | Update department |
| `search_departments` | Search departments |

</details>

<details>
<summary><strong>Settings Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `create_term` | Create a payment term |
| `get_term` | Get term by ID |
| `update_term` | Update term details |
| `search_terms` | Search terms |
| `create_payment_method` | Create a payment method |
| `get_payment_method` | Get payment method by ID |
| `update_payment_method` | Update payment method |
| `search_payment_methods` | Search payment methods |
| `get_preferences` | Get company accounting and feature preferences |

</details>

<details>
<summary><strong>Tax Tools</strong></summary>

| Tool | Description |
|------|-------------|
| `get_tax_code` | Get tax code by ID |
| `search_tax_codes` | Search tax codes |
| `get_tax_rate` | Get tax rate by ID |
| `search_tax_rates` | Search tax rates |
| `get_tax_agency` | Get tax agency by ID |
| `search_tax_agencies` | Search tax agencies |

</details>

<details>
<summary><strong>Company & Attachments</strong></summary>

| Tool | Description |
|------|-------------|
| `get_company_info` | Get company information |
| `update_company_info` | Update company info |
| `create_attachable` | Create an attachment |
| `get_attachable` | Get attachment by ID |
| `update_attachable` | Update attachment |
| `delete_attachable` | Delete an attachment |
| `search_attachables` | Search attachments |

</details>

---

## Authentication

There are two independent OAuth relationships:

1. The configured authorization server authenticates MCP callers and issues a
   token for the exact `MCP_RESOURCE_URI` audience.
2. Intuit authorizes this service to one QuickBooks company. Obtain the initial
   realm and refresh token through an operator-controlled Intuit authorization
   workflow outside this runtime.

For first database provision, supply the Intuit environment, realm, and refresh
token together. After startup creates the connection row, remove the realm and
refresh token from deployment environment variables. The service thereafter
loads encrypted state from PostgreSQL and atomically persists every rotation.
Dead or revoked refresh tokens mark the connection
`reauthorization_required`; request handling never opens a browser or callback
listener.

---

## Development

### Building

```bash
npm run build
```

### Testing

```bash
npm test
```

The test suite includes **531 tests** across 30 suites, with the repository's configured coverage gates passing.

### Project Structure

```
src/
├── clients/          # QuickBooks API client
├── handlers/         # Business logic handlers (87 files)
├── tools/           # MCP tool definitions
├── helpers/         # Utility functions
├── types/           # TypeScript types
└── index.ts         # Server entry point

tests/
├── unit/            # Unit tests (531 tests)
│   ├── handlers/    # Handler tests (15 test files)
│   └── helpers/     # Helper tests
└── mocks/           # Test mocks

docs/
├── ARCHITECTURE.md  # System architecture & design patterns
├── TESTING.md       # Testing guide & patterns
└── plans/           # Development plans
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [CHANGELOG.md](CHANGELOG.md) | Version history and all changes |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, patterns, and design decisions |
| [docs/TESTING.md](docs/TESTING.md) | Testing strategy, ESM patterns, and coverage guide |

---

## Error Handling

If you encounter connection errors:

1. Verify all environment variables are set correctly
2. Check that tokens are valid and not expired
3. Ensure the QuickBooks app has the correct redirect URIs
4. For sandbox testing, use `QUICKBOOKS_ENVIRONMENT=sandbox`

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Tool naming convention

All tool names must follow the `{verb}_{entity}` convention using underscores. The verb prefix determines CRUD Restriction Mode behaviour:

| Prefix | Category | Suppressed by |
|--------|----------|---------------|
| `create_` | WRITE | `QUICKBOOKS_DISABLE_WRITE=true` |
| `update_` | UPDATE | `QUICKBOOKS_DISABLE_UPDATE=true` |
| `delete_` | DELETE | `QUICKBOOKS_DISABLE_DELETE=true` |
| `get_`, `search_`, `read_` | READ | never |

New tools that do not follow this convention will not be correctly categorised and may appear or be suppressed unexpectedly.

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- Based on [Intuit's QuickBooks Online MCP Server](https://github.com/intuit/quickbooks-online-mcp-server)
- Built with the [Model Context Protocol](https://modelcontextprotocol.io/)
