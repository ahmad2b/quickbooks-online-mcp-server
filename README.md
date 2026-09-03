# QuickBooks Online MCP Server

<div align="center">

**A comprehensive Model Context Protocol (MCP) server for QuickBooks Online**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tools](https://img.shields.io/badge/Tools-142-green.svg)](#available-tools)
[![Entities](https://img.shields.io/badge/Entities-29-orange.svg)](#entities)
[![Reports](https://img.shields.io/badge/Reports-11-purple.svg)](#reports)
[![Tests](https://img.shields.io/badge/Tests-581-blue.svg)](#testing)

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
- **OAuth 2.1 resource server** - every bearer is introspected at AuthCo
- **TypeScript** - Full type safety with Zod validation
- **Tested** - Jest test suite with ESM support

This process owns the remote tool interface and request-scoped QuickBooks
execution, and nothing else. It holds no Intuit client secret, no refresh
token, no realm, no database, and no default company. For each call it verifies
the caller at AuthCo and then asks Finance for one short-lived execution lease.

Production therefore requires two things beyond this repository: AuthCo as the
authorization server, and Finance reachable at its internal execution-lease
endpoint. There is no operation ledger or rate-limiter adapter; see
[Deliberately deferred controls](docs/REMOTE-HTTP.md).

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

Copy the template and supply the exact QuickBooks MCP resource URL, the
AuthCo metadata and introspection credentials, the organization claim name, the
client allowlist, and the Finance lease settings:

```bash
cp .env.example .env
```

`.env` is gitignored; deployed secrets belong in the platform secret store.
Every variable the server reads is listed in `.env.example`, and startup
rejects anything missing or malformed rather than falling back to a default.

### Remote Streamable HTTP

The executable always starts Streamable HTTP. Startup validates the exact HTTPS
resource URI, explicit host/origin allowlists, OAuth metadata and verifier, and
the provider-neutral runtime configuration. Provider adapters are injected by
deployment; the MCP package does not define their internal network protocol.
It never opens a browser, writes a token file, or falls back to a default
company.

```env
MCP_HOST=127.0.0.1
MCP_PORT=3000
MCP_RESOURCE_URI=https://quickbooks-mcp.devraftel.com/mcp
MCP_ALLOWED_HOSTS=quickbooks-mcp.devraftel.com
MCP_ALLOWED_ORIGINS=your-final-client.example
MCP_AUTH_ISSUER=https://authorization-server.example/issuer
MCP_AUTH_METADATA_URL=https://authorization-server.example/.well-known/oauth-authorization-server
MCP_AUTH_INTROSPECTION_URL=https://authorization-server.example/introspect
MCP_AUTH_INTROSPECTION_CLIENT_ID=...
MCP_AUTH_INTROSPECTION_CLIENT_SECRET=...
MCP_AUTH_ORGANIZATION_CLAIM=https://devraftel.com/organization_id
MCP_AUTH_ALLOWED_CLIENT_IDS=finance-worker
MCP_BODY_LIMIT=3mb
MCP_REQUEST_TIMEOUT_MS=30000
QBO_EXECUTION_LEASE_PROVIDER=finance-http
FINANCE_QUICKBOOKS_INTERNAL_URL=http://finance-backend:8000
FINANCE_QUICKBOOKS_WORKLOAD_TOKEN=...
FINANCE_QUICKBOOKS_ENVIRONMENT=sandbox
FINANCE_QUICKBOOKS_TIMEOUT_MS=5000
```

AuthCo protects this resource with `quickbooks.read`, `quickbooks.write`, and
`quickbooks.delete`. Every access token is introspected, so revocation and live
organization membership are enforced before execution rather than trusted from
a signature. The Finance lease provider resolves the organization's QuickBooks
connection after authorization; the client supplies no connection, realm, or
credential. See [`docs/REMOTE-HTTP.md`](docs/REMOTE-HTTP.md) for the full
request path and deployment validation.

### MCP client integration

Configure the client with the public `https://quickbooks-mcp.devraftel.com/mcp` URL. The
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

Three credentials meet in one tool call, and this server holds only the middle
one's verification duty.

1. **The caller to this server.** An AuthCo bearer whose audience is exactly
   `MCP_RESOURCE_URI`. It is introspected on every request (RFC 7662) using the
   confidential `MCP_AUTH_INTROSPECTION_CLIENT_ID` credentials.
2. **This server to Finance.** The shared workload token
   `FINANCE_QUICKBOOKS_WORKLOAD_TOKEN`, presented when asking for an execution
   lease.
3. **Finance to Intuit.** Owned entirely by Finance. No Intuit client secret,
   refresh token, or realm is ever configured here or held in this process.

A verified bearer must satisfy four conditions before any lease is requested:

- its `aud` is exactly this resource, and never a list containing it;
- it carries `quickbooks.read` plus the authority scope the called tool
  declares (`quickbooks.write` for create/update, `quickbooks.delete` for
  delete);
- it carries exactly one `MCP_AUTH_ORGANIZATION_CLAIM` value;
- its `client_id` (or `azp`) appears in `MCP_AUTH_ALLOWED_CLIENT_IDS`.

That last check is what stops a third-party client from reaching Finance. The
audience alone does not identify a caller: AuthCo will mint a token for this
resource for any client a user consents to, so the allowlist is what limits the
door to DevRaftel's own workers.

The subject may be a person or a machine. The Finance worker presents a
`client_credentials` token whose `sub` is its own client id, with the
organization named on the token request; both shapes are accepted, and neither
grants anything beyond the organization in the claim. Finance re-checks the
company and the employee's authorization when it issues the lease.

The company is not part of the token. It is chosen per call, as
`com.devraftel.finance/company_id` in the request's `_meta`, and validated by
Finance against the organization at the lease.

### Temporary unauthenticated mode

`MCP_TEMPORARY_UNAUTHENTICATED_MODE=true` switches every check above off. It
exists for one integration window and is scheduled for removal; production
currently runs on it, which is the reason it is documented here rather than
quietly left in the code.

**What it does.** The bearer gate is replaced by a middleware that fabricates a
caller — client id `temporary-unauthenticated-mcp`, all three QuickBooks scopes,
a five-minute expiry — and takes the organization from
`com.devraftel.finance/organization_id` in the request's `_meta`. So it skips
the `Authorization` header entirely, the introspection call to AuthCo, the
issuer, audience, `exp`/`nbf` and `active` checks, the client allowlist, and
the organization-binding 403. An `Authorization` header sent while it is on is
simply not read.

**What still runs.** Everything below the HTTP boundary: the company id in
`_meta` must still be a canonical UUID, execution-routing fields are still
rejected as tool arguments, and the Finance workload token and the full
server-side execution-lease flow are still required. Finance still re-checks
the organization, the company, and the employee's authorization before handing
over an Intuit credential. The bypass removes proof of *who is calling*, not
the controls on *what they may reach*.

**The guard.** Startup refuses the flag unless
`FINANCE_QUICKBOOKS_ENVIRONMENT=sandbox`, so it cannot be turned on against
production Intuit data. It defaults to `false`, and `MCP_AUTH_ALLOWED_CLIENT_IDS`
becomes a startup requirement the moment it is off.

**Turning it off.** This is step 4 of the cutover in
`spec/quickbooks-mcp-auth-design.md` in the `finance-ai-employees` repository.
Do it only after Finance has been switched to send a real bearer and that has
been observed working, because from then on a missing or unacceptable token is
a 401 or 403 rather than a fabricated identity. Step 5 removes the flag and
this section with it.

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

The test suite includes **581 tests** across 33 suites. Coverage is collected
on every run and the configured global threshold is 100%, which the suite does
not currently meet; `npm test` therefore reports the shortfall after the tests
themselves pass.

### Project Structure

```
src/
├── adapters/        # Finance execution-lease HTTP client
├── auth/            # AuthCo introspection verifier, resource metadata
├── clients/         # Request-scoped QuickBooks client factory
├── handlers/        # Business logic handlers (87 files)
├── helpers/         # Tool registration, authorization, utilities
├── runtime/         # Authorization policy, contracts, composition
├── server/          # MCP server assembly
├── tools/           # MCP tool definitions
├── types/           # TypeScript types
├── http-config.ts   # Startup configuration validation
├── http-server.ts   # Express app, middleware chain, HTTP boundary
└── index.ts         # Server entry point

tests/
├── unit/            # Unit tests (581 tests across 33 suites)
│   ├── handlers/    # Handler tests
│   ├── helpers/     # Helper and tool-authorization tests
│   └── runtime/     # Authorization policy tests
└── mocks/           # Test mocks

docs/
├── ARCHITECTURE.md  # System architecture & design patterns
├── REMOTE-HTTP.md   # Production Streamable HTTP and the request path
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

1. Verify every variable in `.env.example` is set; startup names the ones it
   rejected.
2. A 401 with `WWW-Authenticate` means the bearer was missing, expired, or
   failed introspection at AuthCo.
3. A 403 means the token was valid but the caller was refused: the client id is
   not in `MCP_AUTH_ALLOWED_CLIENT_IDS`, the organization claim is missing or
   ambiguous, or the tool's authority scope was not granted.
4. An in-band `QBO_EXECUTION_LEASE_UNAVAILABLE` or `QBO_EXECUTION_LEASE_INVALID`
   means Finance refused or could not answer the lease request; check
   `FINANCE_QUICKBOOKS_INTERNAL_URL` and the workload token.
5. For sandbox testing, use `FINANCE_QUICKBOOKS_ENVIRONMENT=sandbox`.

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
