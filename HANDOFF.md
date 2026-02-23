# Handoff - 2026-02-23

## Current Snapshot

- Architecture direction is now explicit and enforced:
  - DB constraints first
  - model-level lifecycle/state enforcement second
  - views as orchestration/request-shaping layer last
- Domain packaging is active:
  - `accounts_receivable`: `Invoice`, `InvoiceLine`
  - `accounts_payable`: `VendorBill`, `VendorBillAllocation`
  - `estimating`: `Estimate`, `EstimateLineItem`
  - `change_orders`: `ChangeOrder`, `ChangeOrderLine`
  - `operations`: `Project`, `CostCode`, org/role models
  - `financial_auditing`: snapshots/events/identity models (`ScopeItem`, `ChangeOrderSnapshot`, `VendorBillSnapshot`, `EstimateStatusEvent`, `InvoiceStatusEvent`, `InvoiceScopeOverrideEvent`, `PaymentRecord`, `FinancialAuditEvent`)

## Major Changes Landed (2026-02-23)

### 1) Invoice lane finalized under AR package
- Canonical invoice models moved to:
  - `backend/core/models/accounts_receivable/invoice.py`
- Legacy shim modules were intentionally removed (breaking change accepted).
- Invoice status and scope-override events live in `financial_auditing`.

### 2) Payment audit layering added
- Added immutable `PaymentRecord` model:
  - `backend/core/models/financial_auditing/payment_record.py`
  - migration: `backend/core/migrations/0048_paymentrecord.py`
- `PaymentRecord` captures:
  - event type (`created`, `updated`, `status_changed`, `allocation_applied`, `imported`, `synced`)
  - capture source (`manual_ui`, `manual_api`, `ach_webhook`, `processor_sync`, `csv_import`, `system`)
  - from/to status, source reference, immutable snapshot payload, metadata, actor
- Write-path wiring:
  - payment create appends `created`
  - payment patch appends `updated` or `status_changed`
  - payment allocate appends `allocation_applied`

### 3) Status-transition policy moved to models
- Transition maps and checks are model-owned via `ALLOWED_STATUS_TRANSITIONS` + `is_transition_allowed`.
- Model-level `clean/save` enforcement is now active for:
  - `Estimate`
  - `Project`
  - `Payment`
  - (already present) `Invoice`, `VendorBill`, `ChangeOrder`
- View-level transition helper wrappers were removed.

## Current Transition Policies (Source of Truth = Models)

- `Estimate`
  - `draft -> sent | void | archived`
  - `sent -> approved | rejected | void | archived`
  - `rejected -> void`
  - `approved -> none`
  - `void -> none`
  - `archived -> none`

- `Invoice`
  - `draft -> sent | void`
  - `sent -> draft | partially_paid | paid | overdue | void`
  - `partially_paid -> sent | paid | overdue | void`
  - `paid -> void`
  - `overdue -> partially_paid | paid | void`
  - `void -> none`

- `Payment`
  - `pending -> settled | failed | void`
  - `settled -> void`
  - `failed -> void`
  - `void -> none`

- `VendorBill`
  - `planned -> received | void`
  - `received -> approved | void`
  - `approved -> scheduled | paid | void`
  - `scheduled -> paid | void`
  - `paid -> void`
  - `void -> none`

- `ChangeOrder`
  - `draft -> pending_approval | void`
  - `pending_approval -> draft | approved | rejected | void`
  - `approved -> void`
  - `rejected -> draft | void`
  - `void -> none`

- `Project`
  - `prospect -> active | cancelled`
  - `active -> on_hold | completed | cancelled`
  - `on_hold -> active | completed | cancelled`
  - `completed -> none`
  - `cancelled -> none`

## Migrations

- Latest core migration: `0048_paymentrecord`
- Local migration state checked and applied through `0048`.

## Validation Runs (This Session)

Passing targeted suites:
- `core.tests.test_estimates`
- `core.tests.test_invoices`
- `core.tests.test_payments`
- `core.tests.test_change_orders`
- `core.tests.test_projects_cost_codes.ProjectProfileTests`
- `core.tests.test_audit_trail`

Also verified:
- `manage.py makemigrations --check --dry-run` => no drift

## Known Issue (Pre-existing Test Data Path)

- A broader mixed run including `ProjectFinancialSummaryTests` can fail when test seed creates `VendorBill(status=scheduled)` without `scheduled_for`.
- This is consistent with current model validation (scheduled requires `scheduled_for`).
- Impact: test data setup alignment task, not a lifecycle-ownership regression.

## Updated Docs in This Pass

- `HANDOFF.md` (rewritten)
- `README.md` (current-state architecture/doc map refresh)
- `docs/domain-model.md` (status/policy/model updates)
- `docs/api.md` (endpoint contract/status transition corrections)

## Suggested Next Step

- Continue payment-lane field hardening pass for `PaymentAllocation` model-level invariants:
  - target XOR guard (`invoice` vs `vendor_bill`)
  - amount positivity/check constraints
  - optional direction/target consistency constraints where feasible
