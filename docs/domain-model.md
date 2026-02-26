# bill-n-chill Domain Model (v1 Draft)

## Purpose

Define the core construction and billing entities for the initial bill-n-chill platform so backend and frontend can share one consistent language.

## Modeling Principles

- One source of truth per concept.
- Explicit lifecycle states for financial records.
- Immutable snapshots for approved baselines.
- Mutable operational workflow rows paired with append-only immutable capture rows.
- Money relationships are traceable end-to-end.
- Revisioned artifacts use 1-based version numbering (`v1` is first revision/version).

## Domain Packaging Boundary

- We separate model ownership into two broad collections:
  - `financial_auditing`: models whose primary job is canonical identity and auditable reconciliation/history.
  - Operational domains: models whose primary job is workflow authoring and lifecycle progression (including shared lanes like cash management).
- Mutation posture:
  - `financial_auditing` is not automatically immutable, but mutation exposure should be minimal and deliberate.
  - Prefer append-only/audit-snapshot patterns; any mutable behavior requires explicit justification and coverage.
- `ScopeItem` is the first explicit canonical-identity model in this split:
  - It is user-originated via estimate flows but exists to provide stable cross-artifact identity.
  - It is therefore treated as non-customer-facing financial-auditing infrastructure, not estimate-only workflow data.

## Lifecycle Capture Pattern

- Policy:
  - User/internal operators can create or edit operational records where workflow requires it.
  - Financially relevant changes are captured as append-only immutable records in `financial_auditing`.
- Current pairings:
  - `CustomerIntake` -> `CustomerIntakeRecord`
  - `Customer` -> `CustomerRecord`
  - `Organization` -> `OrganizationRecord`
  - `OrganizationMembership` -> `OrganizationMembershipRecord`
  - `Payment` -> `PaymentRecord`
  - `PaymentAllocation` -> `PaymentAllocationRecord`
  - `AccountingSyncEvent` -> `AccountingSyncRecord`
  - `Estimate` -> `EstimateStatusEvent`
  - `Invoice` -> `InvoiceStatusEvent`
  - `ChangeOrder` -> `ChangeOrderSnapshot`
  - `VendorBill` -> `VendorBillSnapshot`

## Core Entities

## Organization

Represents an account/tenant using bill-n-chill.

Key fields:
- `id`
- `display_name`
- `slug`
- `logo_url`
- `invoice_sender_name`
- `invoice_sender_email`
- `invoice_sender_address`
- `invoice_default_due_days`
- `invoice_default_terms`
- `invoice_default_footer`
- `invoice_default_notes`
- `created_by`

Policy:
- Internal-facing tenant boundary object.
- Bootstrap lifecycle captures are append-only in `OrganizationRecord`.

## OrganizationMembership

Represents one user's active organization context and base RBAC role.

Key fields:
- `id`
- `organization_id`
- `user_id`
- `role` (`owner`, `pm`, `worker`, `bookkeeping`, `viewer`)
- `status` (`active`, `disabled`)
- `role_template_id` (nullable)
- `capability_flags_json`

Policy:
- Internal-facing RBAC membership row.
- Bootstrap and lifecycle changes are append-only in `OrganizationMembershipRecord`.

## OrganizationRecord

Immutable audit record for organization lifecycle/provenance captures.

Key fields:
- `id`
- `organization_id`
- `event_type` (`created`, `updated`)
- `capture_source` (`auth_bootstrap`, `manual_ui`, `manual_api`, `system`)
- `snapshot_json`
- `metadata_json`
- `recorded_by` (nullable for system-originated captures)
- `created_at`

Policy:
- Append-only immutable capture model for org-level forensics.
- Internal-facing audit artifact.

## OrganizationMembershipRecord

Immutable audit record for membership lifecycle/provenance captures.

Key fields:
- `id`
- `organization_id`
- `organization_membership_id` (nullable if subject row is later removed)
- `membership_user_id`
- `event_type` (`created`, `status_changed`, `role_changed`, `role_template_changed`, `capability_flags_updated`)
- `capture_source` (`auth_bootstrap`, `manual_ui`, `manual_api`, `system`)
- `from_status` (nullable)
- `to_status` (nullable)
- `from_role` (blank when not applicable)
- `to_role` (blank when not applicable)
- `snapshot_json`
- `metadata_json`
- `recorded_by` (nullable for system-originated captures)
- `created_at`

Policy:
- Append-only immutable capture model for RBAC provenance and incident forensics.
- Internal-facing audit artifact.

## CustomerIntake

Lightweight intake record captured before full project/customer setup.

Current implementation note:
- Quick Add (`POST /customers/quick-add/`) persists immutable intake provenance rows.
- Intake is stored as immutable record snapshots and does not persist a mutable pre-customer model.

Key fields:
- `id`
- `created_by`
- `status` (intake lifecycle state)
- `full_name`
- `phone`
- `email`
- `project_address`
- `source` (`field_manual`, `office_manual`, `import`, `web_form`, `referral`, `other`)
- `notes`
- `converted_customer_id` (nullable)
- `converted_project_id` (nullable)

Policy:
- Internal-facing intake lifecycle object with model-level status transition guards.
- Conversion state consistency is enforced at model + DB constraint layers.
- Canonical immutable lifecycle provenance is captured in `CustomerIntakeRecord`.

## Customer

Customer/owner for whom work is performed.

Key fields:
- `id`
- `created_by`
- `display_name`
- `email`
- `phone`
- `billing_address`

Policy:
- Internal-facing customer anchor object.
- Canonical immutable lifecycle provenance is captured in `CustomerRecord`.
- API lifecycle contract is archive/unarchive via `is_archived`; hard-delete is intentionally unsupported.
- Archive transition contract: archiving a customer auto-cancels any remaining `prospect` projects.

## CustomerIntakeRecord

Immutable audit record for customer-intake lifecycle and conversion captures.

Key fields:
- `id`
- `intake_record_id` (nullable if source row is deleted)
- `event_type` (`created`, `updated`, `status_changed`, `converted`, `deleted`)
- `capture_source` (`manual_ui`, `manual_api`, `import`, `system`)
- `from_status` (nullable)
- `to_status` (nullable)
- `snapshot_json`
- `metadata_json`
- `recorded_by` (nullable for system-originated captures)
- `created_at`

Policy:
- Append-only immutable capture model for intake/replay forensics.
- Internal-facing audit artifact.

## CustomerRecord

Immutable audit record for customer lifecycle captures.

Key fields:
- `id`
- `customer_id` (nullable if source row is deleted)
- `event_type` (`created`, `updated`)
- `capture_source` (`manual_ui`, `manual_api`, `import`, `system`)
- `snapshot_json`
- `metadata_json`
- `recorded_by` (nullable for system-originated captures)
- `created_at`

Policy:
- Append-only immutable capture model for customer provenance.
- Internal-facing audit artifact.

## Project

Container for scope, schedule intent, and all financial workflows.

Key fields:
- `id`
- `created_by`
- `customer_id`
- `name`
- `site_address` (job/site address; distinct from customer billing address)
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
- `status` (`draft`, `sent`, `approved`, `rejected`, `void`, `archived`)
  - `void`: explicit user cancellation
  - `archived`: internal superseded-history state
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

## EstimateStatusEvent

Audit trail of estimate status transitions.

Key fields:
- `id`
- `estimate_id`
- `from_status` (nullable)
- `to_status`
- `note`
- `changed_by`
- `changed_at`

Policy:
- Append-only status-history record for estimate lifecycle decisions.
- Internal-facing operational audit artifact.

## ScopeItem

Canonical non-customer-facing identity for "same work" line items across lifecycle artifacts.

Why this exists:
- `EstimateLineItem` and `BudgetLine` are context-specific rows (versioned proposal vs. working budget).
- We still need one stable identity to reconcile analytics and history across revisions/conversions.
- `ScopeItem` is that source-of-truth identity key; rows in other models can reference it.

Key fields:
- `id`
- `organization_id`
- `cost_code_id`
- `name`
- `normalized_name`
- `unit`

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
- `organization_id` (nullable for legacy rows)
- `created_by`
- `code`
- `name`
- `is_active`

## ChangeOrder

Formal scope/price/time change affecting contract and budget.

Current scope:
- Internal-facing workflow object (not yet customer-facing like Estimate public approval loop).
- Future direction is to add a customer delivery/decision loop without coupling it to core financial propagation rules.

Key fields:
- `id`
- `project_id`
- `family_key`
- `status` (`draft`, `pending_approval`, `approved`, `rejected`, `void`)
- `requested_by_user_id`
- `approved_by_user_id`
- `amount_delta`
- `days_delta`
- `reason`
- `approved_at`

## ChangeOrderSnapshot

Immutable financial-audit snapshot for change-order decision outcomes.

Current policy:
- Captured for terminal decision states: `approved`, `rejected`, and `void`.
- Not captured for non-terminal workflow states: `draft`, `pending_approval`.
- Append-only audit representation used for strict decision traceability.
- Includes `origin_estimate_version` in snapshot payload for historical replay/forensics,
  not as a primary mutable operational field.
- Includes decision context (`previous_status`, `applied_financial_delta`) to support
  replay and reversal forensics.

Key fields:
- `id`
- `change_order_id`
- `decision_status` (`approved`, `rejected`, `void`)
- `snapshot_json`
- `decided_by`
- `created_at`

## FinancialAuditEvent (Deprecated Index Layer)

`FinancialAuditEvent` currently exists as a project-scoped immutable activity index used by
legacy financial timeline/reporting reads.

Policy:
- Not canonical financial truth.
- Canonical replay/forensics should come from domain-specific immutable capture models.
- Planned removal after timeline/reporting migration is complete.

## VendorBillSnapshot

Immutable AP lifecycle snapshot for vendor-bill status transitions.

Current policy:
- Captured for: `received`, `approved`, `scheduled`, `paid`, `void`.
- Append-only audit representation for AP lifecycle replay/traceability.
- Stores vendor-bill header + allocation context + transition context.

Key fields:
- `id`
- `vendor_bill_id`
- `capture_status` (`received`, `approved`, `scheduled`, `paid`, `void`)
- `snapshot_json`
- `acted_by`
- `created_at`

## Commitment

Agreement with vendor/subcontractor for a defined amount/scope.

Current policy:
- Planned domain object; not implemented in the backend model layer yet.

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
- `organization_id` (nullable for legacy rows)
- `created_by`
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
- `sender_name`
- `sender_email`
- `sender_address`
- `sender_logo_url`
- `terms_text`
- `footer_text`
- `notes_text`
- `subtotal`
- `tax_total`
- `total`
- `balance_due`

Current policy:
- One canonical invoice line set is used for both customer-facing and internal-facing views.
- Invoice lines may reference canonical `ScopeItem` directly for strict cross-artifact lineage.
- Invoice lines do not require direct FK coupling to `EstimateLineItem` or `BudgetLine`.
- Non-scope billing is represented explicitly as adjustment lines with reason metadata.

## InvoiceLine

Billed line items, optionally tied to cost code and canonical scope identity.

Key fields:
- `id`
- `invoice_id`
- `line_type` (`scope`, `adjustment`)
- `cost_code_id`
- `scope_item_id` (optional canonical scope identity)
- `adjustment_reason` (required when `line_type=adjustment`)
- `internal_note` (optional internal-only context)
- `description`
- `quantity`
- `unit`
- `unit_price`
- `line_total`

## InvoiceStatusEvent

Audit trail of invoice status transitions.

Key fields:
- `id`
- `invoice_id`
- `from_status` (nullable)
- `to_status`
- `note`
- `changed_by`
- `changed_at`

Policy:
- Append-only status-history record for invoice lifecycle decisions.
- Internal-facing operational audit artifact (separate from customer-facing invoice rendering).

## VendorBill

AP bill received from vendor/sub.

Key fields:
- `id`
- `project_id`
- `vendor_id`
- `status` (`planned`, `received`, `approved`, `scheduled`, `paid`, `void`)
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

Policy:
- Internal-facing operator-managed ledger row.
- Lifecycle transitions are model-enforced.
- Canonical immutable audit provenance is captured in `PaymentRecord`.

## PaymentAllocation

Join model mapping one payment across one or more invoices/bills.

Key fields:
- `id`
- `payment_id`
- `target_type` (`invoice`, `vendor_bill`)
- `target_id`
- `applied_amount`

Policy:
- Internal/system-managed reconciliation artifact.
- Not intended as customer-facing representation.
- Canonical immutable provenance is captured in `PaymentAllocationRecord`.

## PaymentAllocationRecord

Immutable audit record for payment-allocation provenance captures.

Key fields:
- `id`
- `payment_id`
- `payment_allocation_id` (nullable)
- `event_type` (`applied`, `reversed`)
- `capture_source` (`manual_ui`, `manual_api`, `ach_webhook`, `processor_sync`, `csv_import`, `system`)
- `target_type` (`invoice`, `vendor_bill`)
- `target_object_id`
- `applied_amount`
- `snapshot_json`
- `metadata_json`
- `recorded_by` (nullable for system-originated captures)
- `created_at`

Policy:
- Append-only immutable capture model for allocation forensics/RBAC provenance.
- Internal-facing audit artifact.

## PaymentRecord

Immutable audit record for payment lifecycle and provenance captures.

Key fields:
- `id`
- `payment_id`
- `event_type` (`created`, `updated`, `status_changed`, `allocation_applied`, `imported`, `synced`)
- `capture_source` (`manual_ui`, `manual_api`, `ach_webhook`, `processor_sync`, `csv_import`, `system`)
- `source_reference`
- `from_status` (nullable)
- `to_status` (nullable)
- `snapshot_json`
- `metadata_json`
- `recorded_by` (nullable for system-originated captures)
- `created_at`

Policy:
- Append-only immutable capture model for payment replay/forensics.
- Internal-facing audit artifact.

## AccountingSyncEvent

Tracks data exchange with accounting system.

Key fields:
- `id`
- `project_id`
- `provider` (`quickbooks_online`)
- `object_type`
- `object_id`
- `direction` (`push`, `pull`)
- `status` (`queued`, `success`, `failed`)
- `external_id`
- `error_message`
- `retry_count`
- `last_attempt_at`
- `created_by`

Policy:
- Internal-facing operational integration state row.
- Canonical immutable lifecycle provenance is captured in `AccountingSyncRecord`.

## AccountingSyncRecord

Immutable audit record for accounting-sync lifecycle and retry captures.

Key fields:
- `id`
- `accounting_sync_event_id`
- `event_type` (`created`, `status_changed`, `retried`, `imported`, `synced`)
- `capture_source` (`manual_ui`, `manual_api`, `job_runner`, `webhook`, `system`)
- `from_status` (nullable)
- `to_status` (nullable)
- `snapshot_json`
- `metadata_json`
- `recorded_by` (nullable for system-originated captures)
- `created_at`

Policy:
- Append-only immutable capture model for sync forensics/replay.
- Internal-facing audit artifact.

## Relationship Summary

- `Organization` has many `OrganizationMemberships`, `Vendors`, `CostCodes`, and `ScopeItems`.
- `Organization` has many `OrganizationRecords` and `OrganizationMembershipRecords`.
- `CustomerIntake` has many `CustomerIntakeRecords`.
- `Customer` has many `CustomerRecords`.
- `User` owns/scopes `CustomerIntake`, `Customers`, `Projects`, and financial workflow records via `created_by`.
- `OrganizationMembership` has many `OrganizationMembershipRecords`.
- `Project` has many `Estimates`, `Budgets`, `ChangeOrders`, `Invoices`, `VendorBills`, `Payments`, and `AccountingSyncEvents`.
- `AccountingSyncEvent` has many `AccountingSyncRecords`.
- `Estimate` has many `EstimateLineItems`.
- `Budget` has many `BudgetLines`.
- `Invoice` has many `InvoiceLines`.
- `Payment` has many `PaymentAllocations`.
- `Payment` has many `PaymentAllocationRecords`.
- `Payment` has many `PaymentRecords`.

## Financial Lifecycle (Happy Path)

1. Capture customer intake (usually from field/office quick add).
2. Create/reuse customer + optional project shell.
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

- `POST /api/v1/customers/quick-add/`
- `GET /api/v1/customers/`
- `PATCH /api/v1/customers/{id}/`
- `GET /api/v1/projects/{id}/financial-summary/`
- `PATCH /api/v1/estimates/{estimate_id}/`
- `POST /api/v1/estimates/{estimate_id}/convert-to-budget/`
- `PATCH /api/v1/change-orders/{change_order_id}/`
- `POST /api/v1/invoices/{id}/send/`
- `POST /api/v1/projects/{project_id}/payments/`
- `POST /api/v1/payments/{id}/allocate/`

## Open Modeling Questions

1. Retainage modeling:
- Separate retainage ledger vs embedded fields on invoice/bill lines?

2. Tax modeling:
- Project-level defaults vs line-level tax authority mapping?

3. Commitment depth:
- Minimal commitment object in v1, or full subcontract/change-event chain?

4. Multi-organization structures:
- Keep one active organization per user, or add first-class multi-org switching early?
