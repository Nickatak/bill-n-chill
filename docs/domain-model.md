# bill-n-chill Domain Model (v1)

Last reviewed: 2026-03-04

## Table of Contents

- [Model Foundations (Meta)](#model-foundations-meta)
  - [Purpose](#purpose)
  - [Modeling Principles](#modeling-principles)
  - [Domain Packaging Boundary](#domain-packaging-boundary)
  - [Lifecycle Capture Pattern](#lifecycle-capture-pattern)
- [Domain Glossary (Canonical)](#domain-glossary-canonical)
- [Entity Catalog](#entity-catalog)
  - [Shared Operations and Core Anchors](#shared-operations-and-core-anchors)
  - [Estimating and Scope](#estimating-and-scope)
  - [Audit and Snapshot Infrastructure](#audit-and-snapshot-infrastructure)
  - [Commercial and Cash Movement](#commercial-and-cash-movement)
- [Relationship and Lifecycle Views](#relationship-and-lifecycle-views)
  - [Relationship Summary](#relationship-summary)
  - [Financial Lifecycle (Happy Path)](#financial-lifecycle-happy-path)
  - [Derived Metrics (Project Financial Summary)](#derived-metrics-project-financial-summary)
- [API Alignment and Open Questions](#api-alignment-and-open-questions)
  - [API Surface Snapshot (Current)](#api-surface-snapshot-current)
  - [Open Modeling Questions](#open-modeling-questions)

## Model Foundations (Meta)

### Purpose

Define the core construction and billing entities for the initial bill-n-chill platform so backend and frontend can share one consistent language.

### Modeling Principles

- One source of truth per concept.
- Explicit lifecycle states for financial records.
- Immutable snapshots for approved baselines.
- Mutable operational workflow rows paired with append-only immutable capture rows.
- Money relationships are traceable end-to-end.
- Revisioned artifacts use 1-based version numbering (`v1` is first revision/version).

### Domain Packaging Boundary

- We separate model ownership into two broad collections:
  - `financial_auditing`: models whose primary job is canonical identity and auditable reconciliation/history.
  - Operational domains: models whose primary job is workflow authoring and lifecycle progression (including shared lanes like cash management).
- Mutation posture:
  - `financial_auditing` is not automatically immutable, but mutation exposure should be minimal and deliberate.
  - Prefer append-only/audit-snapshot patterns; any mutable behavior requires explicit justification and coverage.
### Lifecycle Capture Pattern

- Policy:
  - User/internal operators can create or edit operational records where workflow requires it.
  - Financially relevant changes are captured as append-only immutable records in `financial_auditing`.
- Current pairings:
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

## Domain Glossary (Canonical)

This section is the canonical glossary for bill-n-chill. For model fields and lifecycle specifics, use the entity sections below and `docs/api.md` for endpoint contracts.

| Term | Definition | Model Mapping | API Mapping | Notes |
| --- | --- | --- | --- | --- |
| Auth Token | Credential used for authenticated API requests after login/register. | DRF `Token` | `POST /api/v1/auth/login/`, `POST /api/v1/auth/register/`, `GET /api/v1/auth/me/` | Sent as `Authorization: Token <token>`. |
| Tenant | Isolated organization/workspace boundary in the SaaS system. | `Organization`, `OrganizationMembership` | Auth responses include organization context. | A tenant is the company boundary, not an individual user. |
| Duplicate Resolution | Explicit operator decision when intake duplicate candidates are detected. | Intake workflows | `POST /api/v1/customers/quick-add/` (`use_existing`) | Customers support `use_existing` only. Vendors and vendor bills block duplicates outright (no override path). |
| Customer | Client/owner entity for project relationship and billing context. | `Customer` + `CustomerRecord` | `GET/PATCH /api/v1/customers/{id}/` | One customer can have multiple projects. |
| Project | Primary container for estimating, change orders, billing, AP, and payments. | `Project` | `GET/PATCH /api/v1/projects/{id}/`, `GET /api/v1/projects/{id}/financial-summary/` | Lifecycle status gates workflow readiness. |
| Project Profile | Editable baseline project fields used after shell creation. | `Project` | `GET /api/v1/projects/`, `GET/PATCH /api/v1/projects/{id}/` | Includes status and planned dates. |
| Estimate | Customer-facing scope/price proposal for project contract value. | `Estimate`, `EstimateLineItem` | `GET/POST /api/v1/projects/{project_id}/estimates/`, `GET/PATCH /api/v1/estimates/{id}/` | Lifecycle: `draft`, `sent`, `approved`, `rejected`, `void`, `archived`. |
| Approved Estimate | Estimate version approved; sets project contract value. | `Estimate(status=approved)` | `PATCH /api/v1/estimates/{id}/` | Approval updates project contract value. |
| Estimate Version | Revision snapshot of an estimate for one project. | `Estimate(version)` | `POST /api/v1/estimates/{id}/clone-version/` | Revisions preserve prior history. |
| Estimate Status Event | Audit record for estimate status transitions. | `EstimateStatusEvent` | `GET /api/v1/estimates/{id}/status-events/` | Stores from/to status, actor, timestamp, note. |
| Cost Code | Cost/billing classification used across estimate/invoice/AP flows. | `CostCode` | `GET/POST /api/v1/cost-codes/`, `PATCH /api/v1/cost-codes/{id}/` | Supports CSV import and org-scoped ownership. |
| Change Order (CO) | Post-contract change request for scoped delta. | `ChangeOrder`, `ChangeOrderLine`, `ChangeOrderSnapshot` | `GET/POST /api/v1/projects/{id}/change-orders/`, `GET/PATCH /api/v1/change-orders/{id}/` | Lifecycle: `draft`, `pending_approval`, `approved`, `rejected`, `void`. |
| Public Decision Link | Tokenized public customer decision flow for estimate/CO/invoice. | Public token/ref on document models | `/api/v1/public/.../{token}/decision/` | State-gated; writes audit/lifecycle context. |
| Vendor | Payee identity for subcontractor/supplier billing workflows. | `Vendor` | `GET/POST /api/v1/vendors/`, `GET/PATCH /api/v1/vendors/{id}/` | Duplicate warning + override flow supported. |
| Vendor Bill | AP invoice from vendor/subcontractor. | `VendorBill`, `VendorBillSnapshot` | `GET/POST /api/v1/projects/{id}/vendor-bills/`, `GET/PATCH /api/v1/vendor-bills/{id}/` | Lifecycle: `planned`, `received`, `approved`, `scheduled`, `paid`, `void`. |
| Invoice | AR billing document sent to customer. | `Invoice`, `InvoiceLine`, `InvoiceStatusEvent` | `GET/POST /api/v1/projects/{id}/invoices/`, `GET/PATCH /api/v1/invoices/{id}/`, `POST /api/v1/invoices/{id}/send/` | Lifecycle: `draft`, `sent`, `partially_paid`, `paid`, `overdue`, `void`. |
| Payment | Money movement record (inbound AR or outbound AP). | `Payment`, `PaymentRecord` | `GET/POST /api/v1/projects/{id}/payments/`, `GET/PATCH /api/v1/payments/{id}/` | Lifecycle: `pending`, `settled`, `failed`, `void`. |
| Payment Allocation | Applied amount from one payment to invoice/vendor bill targets. | `PaymentAllocation`, `PaymentAllocationRecord` | `POST /api/v1/payments/{id}/allocate/` | Direction guard: `inbound->invoice`, `outbound->vendor_bill`. |
| Accounting Export | Reconciliation export aligned to financial summary math. | Derived from project financial entities | `GET /api/v1/projects/{id}/accounting-export/?export_format=csv|json` | Includes summary rows + traceability records. |
| Accounting Sync Event | Sync operation log to/from accounting provider. | `AccountingSyncEvent`, `AccountingSyncRecord` | `GET/POST /api/v1/projects/{id}/accounting-sync-events/`, `POST /api/v1/accounting-sync-events/{id}/retry/` | Retry flow: failed->queued with audit capture. |
| AR / AP Outstanding | Outstanding customer receivable and vendor payable balances. | `Invoice` + inbound allocations, `VendorBill` + outbound allocations | `GET /api/v1/projects/{id}/financial-summary/` | Outstanding totals are clamped at `0` for readability; unapplied credit exposed separately. |
| Retainage | Withheld payment portion pending milestone/closeout completion. | Open modeling question | TBD | Explicitly unresolved in current v1 model decisions. |

## Entity Catalog

### Shared Operations and Core Anchors

#### Organization

Represents an account/tenant using bill-n-chill.

Key fields:
- `id`
- `display_name`
- `logo` (ImageField)
- `phone_number`
- `website_url`
- `license_number`
- `tax_id`
- `help_email`
- `billing_address`
- `default_invoice_due_delta`
- `default_estimate_valid_delta`
- `invoice_terms_and_conditions`
- `estimate_terms_and_conditions`
- `change_order_terms_and_conditions`
- `created_by`

Settings split:
- **Identity fields** (`display_name`, `logo`, `billing_address`, `phone_number`, `website_url`, `license_number`, `tax_id`): owner-only edit.
- **Preset fields** (`help_email`, deltas, T&C fields): owner + PM can edit.
- Field-level capability gates enforce this split at the API layer.

Policy:
- Internal-facing tenant boundary object.
- Bootstrap lifecycle captures are append-only in `OrganizationRecord`.

#### RoleTemplate

Preset or custom role definition with a capability-flags permission matrix.

Key fields:
- `id`
- `name`
- `slug` (unique, stable identifier for API/UI wiring)
- `organization_id` (nullable; null for system-level presets)
- `is_system`
- `capability_flags_json` (JSONField: `{resource: [actions]}`)
- `description`
- `created_by` (nullable)

System presets (seeded via migration):
- `owner`, `pm`, `worker`, `bookkeeping`, `viewer`

Policy:
- System templates are immutable presets; organization-local templates enable future custom roles.
- `capability_flags_json` is the canonical permission source consumed by `_resolve_user_capabilities`.

#### OrganizationMembership

Represents one user's active organization context and RBAC role.

Key fields:
- `id`
- `organization_id`
- `user_id` (OneToOneField — one active org per user)
- `role` (`owner`, `pm`, `worker`, `bookkeeping`, `viewer`)
- `role_template_id` (nullable FK to `RoleTemplate`)
- `status` (`active`, `disabled`)
- `capability_flags_json` (additive overrides merged onto template capabilities)

RBAC resolution:
- Primary: `role_template.capability_flags_json` (if `role_template` is assigned).
- Fallback: system `RoleTemplate` matching the `role` slug.
- `capability_flags_json` on membership provides additive per-user grants layered on top.

Policy:
- Internal-facing RBAC membership row.
- One active membership per user (OneToOneField on `user`).
- Bootstrap and lifecycle changes are append-only in `OrganizationMembershipRecord`.

#### OrganizationRecord

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

#### OrganizationMembershipRecord

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

#### OrganizationInvite

Single-use invite token for adding a user to an organization.

Key fields:
- `id`
- `organization_id`
- `email`
- `role` (`owner`, `pm`, `worker`, `bookkeeping`, `viewer`)
- `token` (unique, auto-generated UUID)
- `invited_by` (FK to User)
- `expires_at` (24 hours from creation)
- `used_at` (nullable; set when accepted)
- `used_by` (nullable FK to User; set when accepted)
- `created_at`

Lifecycle:
- Created via `POST /organization/invites/` (requires `users.invite` capability).
- Token is verified via `GET /auth/verify-invite/{token}/` (unauthenticated).
- Acceptance paths:
  - **Flow B (new user):** Token passed during `POST /auth/register/` — creates user and attaches to inviting org.
  - **Flow C (existing user):** `POST /auth/accept-invite/` with password confirmation — switches user's org.
- Single-use: `used_at` is set on acceptance; token cannot be reused.
- Expiry: 24-hour window from `created_at`; expired tokens are rejected.

Policy:
- One pending invite per email per organization (duplicate guard).
- Revocable via `DELETE /organization/invites/{id}/` before use.
- Internal-facing RBAC artifact — no audit record model (invite lifecycle is simple enough to track via `used_at`/`used_by`).

#### Customer

Customer/owner for whom work is performed.

Key fields:
- `id`
- `organization_id`
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

#### LeadContactRecord

Immutable audit record for pre-conversion lead/contact intake provenance.

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

#### CustomerRecord

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

#### Project

Container for scope, schedule intent, and all financial workflows.

Key fields:
- `id`
- `organization_id`
- `created_by`
- `customer_id`
- `name`
- `site_address` (job/site address; distinct from customer billing address)
- `status` (`prospect`, `active`, `on_hold`, `completed`, `cancelled`)
- `contract_value_original`
- `contract_value_current`

### Estimating and Scope

#### Estimate

Pre-contract pricing proposal.

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

#### EstimateLineItem

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

#### EstimateStatusEvent

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

#### CostCode

Normalized classification for costs and billing lines.

Key fields:
- `id`
- `organization_id`
- `created_by`
- `code`
- `name`
- `is_active`

#### ChangeOrder

Formal scope/price/time change affecting contract value.

Current scope:
- Supports both internal authoring/revision workflows and public customer review/decision flows via tokenized public routes.

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

#### ChangeOrderSnapshot

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

### Audit and Snapshot Infrastructure

#### VendorBillSnapshot

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

### Commercial and Cash Movement

#### Commitment

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

#### Vendor

Payee record for AP and commitments.

Key fields:
- `id`
- `organization_id` (nullable for legacy rows)
- `created_by`
- `name`
- `email`
- `phone`
- `tax_id_last4`

#### Invoice

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
- Invoice lines do not require direct FK coupling to `EstimateLineItem`.
- Non-scope billing is represented explicitly as adjustment lines with reason metadata.

#### InvoiceLine

Billed line items, optionally tied to cost code.

Key fields:
- `id`
- `invoice_id`
- `line_type` (`scope`, `adjustment`)
- `cost_code_id`
- `adjustment_reason` (required when `line_type=adjustment`)
- `internal_note` (optional internal-only context)
- `description`
- `quantity`
- `unit`
- `unit_price`
- `line_total`

#### InvoiceStatusEvent

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

#### VendorBill

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

#### Payment

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

#### PaymentAllocation

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

#### PaymentAllocationRecord

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

#### PaymentRecord

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

#### AccountingSyncEvent

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

#### AccountingSyncRecord

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

## Relationship and Lifecycle Views

### Relationship Summary

- `Organization` has many `OrganizationMemberships`, `OrganizationInvites`, `RoleTemplates`, `Vendors`, and `CostCodes`.
- `Organization` has many `OrganizationRecords` and `OrganizationMembershipRecords`.
- `RoleTemplate` provides capability flags to `OrganizationMembership` (nullable FK).
- `Customer` has many `CustomerRecords`.
- `User` owns/scopes `Customers`, `Projects`, and financial workflow records via `created_by`.
- `OrganizationMembership` has many `OrganizationMembershipRecords`.
- `Project` has many `Estimates`, `ChangeOrders`, `Invoices`, `VendorBills`, `Payments`, and `AccountingSyncEvents`.
- `AccountingSyncEvent` has many `AccountingSyncRecords`.
- `Estimate` has many `EstimateLineItems`.
- `Invoice` has many `InvoiceLines`.
- `Payment` has many `PaymentAllocations`.
- `Payment` has many `PaymentAllocationRecords`.
- `Payment` has many `PaymentRecords`.

### Financial Lifecycle (Happy Path)

1. Capture customer intake (usually from field/office quick add).
2. Create/reuse customer + optional project shell.
3. Build estimate and mark approved (sets project contract value).
4. Execute work and capture change orders.
5. Approve change orders and apply contract value deltas.
6. Issue invoices and record customer payments.
7. Record vendor bills and outbound payments.
8. Sync finalized transactions to accounting.

### Derived Metrics (Project Financial Summary)

- `contract_value_current = contract_value_original + sum(approved_change_orders.amount_delta)`
- `invoiced_to_date = sum(invoice.total where status != void)`
- `paid_to_date = sum(inbound_payment_allocations)`
- `ar_outstanding = invoiced_to_date - paid_to_date`
- `ap_total = sum(vendor_bill.total where status != void)`
- `ap_paid = sum(outbound_payment_allocations)`
- `ap_outstanding = ap_total - ap_paid`

## API Alignment and Open Questions

### API Surface Snapshot (Current)

This section is a compact index only. Canonical endpoint behavior lives in `docs/api.md`.

- `POST /api/v1/customers/quick-add/`
- `GET /api/v1/customers/`
- `PATCH /api/v1/customers/{id}/`
- `GET /api/v1/projects/{id}/financial-summary/`
- `PATCH /api/v1/estimates/{estimate_id}/`
- `PATCH /api/v1/change-orders/{change_order_id}/`
- `POST /api/v1/invoices/{id}/send/`
- `POST /api/v1/projects/{project_id}/payments/`
- `POST /api/v1/payments/{id}/allocate/`

### Open Modeling Questions

1. Retainage modeling:
- Separate retainage ledger vs embedded fields on invoice/bill lines?

2. Tax modeling:
- Project-level defaults vs line-level tax authority mapping?

3. Commitment depth:
- Minimal commitment object in v1, or full subcontract/change-event chain?

4. Multi-organization structures:
- **Resolved**: One active organization per user (enforced by `OneToOneField` on `OrganizationMembership.user`). Multi-org switching deferred until needed.
