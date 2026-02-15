# bill-n-chill Domain Model (v1 Draft)

## Purpose

Define the core construction and billing entities for the initial bill-n-chill platform so backend and frontend can share one consistent language.

## Modeling Principles

- One source of truth per concept.
- Explicit lifecycle states for financial records.
- Immutable snapshots for approved baselines.
- Money relationships are traceable end-to-end.

## Core Entities

## Company

Represents an account/tenant using bill-n-chill.

Key fields:
- `id`
- `name`
- `timezone`
- `default_currency`

## LeadContact

Lightweight intake record captured before full project/customer setup.

Key fields:
- `id`
- `company_id`
- `status` (`new_contact`, `qualified`, `project_created`, `archived`)
- `full_name`
- `phone`
- `email`
- `project_address`
- `source` (`field_manual`, `office_manual`, `import`, `web_form`, `referral`, `other`)
- `notes`
- `converted_customer_id` (nullable)
- `converted_project_id` (nullable)

## Customer

Client/owner for whom work is performed.

Key fields:
- `id`
- `company_id`
- `display_name`
- `email`
- `phone`
- `billing_address`

## Project

Container for scope, schedule intent, and all financial workflows.

Key fields:
- `id`
- `company_id`
- `customer_id`
- `name`
- `status` (`prospect`, `active`, `on_hold`, `completed`, `cancelled`)
- `contract_value_original`
- `contract_value_current`
- `start_date_planned`
- `end_date_planned`

## Estimate

Pre-contract or pre-baseline pricing model.

Key fields:
- `id`
- `project_id`
- `status` (`draft`, `sent`, `approved`, `rejected`, `archived`)
- `version`
- `subtotal`
- `markup_total`
- `tax_total`
- `grand_total`

## EstimateLineItem

Line-level scope and pricing rows.

Key fields:
- `id`
- `estimate_id`
- `cost_code_id`
- `description`
- `quantity`
- `unit`
- `unit_cost`
- `markup_percent`
- `line_total`

## Budget

Working project cost plan derived from approved estimate.

Key fields:
- `id`
- `project_id`
- `status` (`active`, `superseded`)
- `source_estimate_id`
- `baseline_snapshot_json`

## BudgetLine

Budget amount per cost code/category.

Key fields:
- `id`
- `budget_id`
- `cost_code_id`
- `description`
- `budget_amount`
- `committed_amount`
- `actual_amount`

## CostCode

Normalized classification for costs and billing lines.

Key fields:
- `id`
- `company_id`
- `code`
- `name`
- `is_active`

## ChangeOrder

Formal scope/price/time change affecting contract and budget.

Key fields:
- `id`
- `project_id`
- `number`
- `status` (`draft`, `pending_approval`, `approved`, `rejected`, `void`)
- `requested_by_user_id`
- `approved_by_user_id`
- `amount_delta`
- `days_delta`
- `reason`
- `approved_at`

## Commitment

Agreement with vendor/subcontractor for a defined amount/scope.

Key fields:
- `id`
- `project_id`
- `vendor_id`
- `status` (`draft`, `active`, `closed`, `void`)
- `original_amount`
- `current_amount`

## Vendor

Payee record for AP and commitments.

Key fields:
- `id`
- `company_id`
- `name`
- `email`
- `phone`
- `tax_id_last4`

## Invoice

AR billing document sent to customer.

Key fields:
- `id`
- `project_id`
- `customer_id`
- `invoice_number`
- `status` (`draft`, `sent`, `partially_paid`, `paid`, `overdue`, `void`)
- `issue_date`
- `due_date`
- `subtotal`
- `tax_total`
- `total`
- `balance_due`

## InvoiceLine

Billed line items, optionally tied to cost code and source scope.

Key fields:
- `id`
- `invoice_id`
- `cost_code_id`
- `description`
- `quantity`
- `unit_price`
- `line_total`

## VendorBill

AP bill received from vendor/sub.

Key fields:
- `id`
- `project_id`
- `vendor_id`
- `status` (`draft`, `received`, `approved`, `scheduled`, `paid`, `void`)
- `bill_number`
- `issue_date`
- `due_date`
- `total`
- `balance_due`

## Payment

Money movement record, incoming or outgoing.

Key fields:
- `id`
- `project_id`
- `direction` (`inbound`, `outbound`)
- `method` (`ach`, `card`, `check`, `wire`, `cash`, `other`)
- `status` (`pending`, `settled`, `failed`, `void`)
- `amount`
- `payment_date`
- `reference_number`

## PaymentAllocation

Join model mapping one payment across one or more invoices/bills.

Key fields:
- `id`
- `payment_id`
- `target_type` (`invoice`, `vendor_bill`)
- `target_id`
- `applied_amount`

## AccountingSyncEvent

Tracks data exchange with accounting system.

Key fields:
- `id`
- `company_id`
- `provider` (`quickbooks_online`)
- `object_type`
- `object_id`
- `direction` (`push`, `pull`)
- `status` (`queued`, `success`, `failed`)
- `external_id`
- `error_message`
- `synced_at`

## Relationship Summary

- `Company` has many `LeadContacts`, `Customers`, `Projects`, `Vendors`, `CostCodes`.
- `Project` has many `Estimates`, `Budgets`, `ChangeOrders`, `Commitments`, `Invoices`, `VendorBills`, `Payments`.
- `Estimate` has many `EstimateLineItems`.
- `Budget` has many `BudgetLines`.
- `Invoice` has many `InvoiceLines`.
- `Payment` has many `PaymentAllocations`.

## Financial Lifecycle (Happy Path)

1. Capture lead contact (usually from field/office quick add).
2. Convert contact to customer + project shell.
3. Build estimate and mark approved.
4. Convert estimate to budget baseline.
5. Execute work and capture change orders.
6. Approve change orders and apply contract/budget deltas.
7. Issue invoices and record customer payments.
8. Record vendor bills and outbound payments.
9. Sync finalized transactions to accounting.

## Derived Metrics (Project Financial Summary)

- `contract_value_current = contract_value_original + sum(approved_change_orders.amount_delta)`
- `invoiced_to_date = sum(invoice.total where status != void)`
- `paid_to_date = sum(inbound_payment_allocations)`
- `ar_outstanding = invoiced_to_date - paid_to_date`
- `ap_total = sum(vendor_bill.total where status != void)`
- `ap_paid = sum(outbound_payment_allocations)`
- `ap_outstanding = ap_total - ap_paid`

## API Surface (Initial DRF Direction)

- `POST /api/v1/lead-contacts/quick-add/`
- `POST /api/v1/lead-contacts/{id}/convert-to-project/`
- `GET /api/v1/projects/{id}/financial-summary/`
- `POST /api/v1/projects/{id}/estimates/{estimate_id}/convert-to-budget/`
- `POST /api/v1/projects/{id}/change-orders/{id}/approve/`
- `POST /api/v1/invoices/{id}/send/`
- `POST /api/v1/payments/`
- `POST /api/v1/payments/{id}/allocate/`

## Open Modeling Questions

1. Retainage modeling:
- Separate retainage ledger vs embedded fields on invoice/bill lines?

2. Tax modeling:
- Project-level defaults vs line-level tax authority mapping?

3. Commitment depth:
- Minimal commitment object in v1, or full subcontract/change-event chain?

4. Multi-company structures:
- Single-tenant per company in v1, or parent-child entities early?
