# API Standards

## Base Path

- `/api/v1/`

## Response Conventions

Success:

```json
{
  "data": {}
}
```

Error:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Invalid request",
    "fields": {}
  }
}
```

## Money Precision Policy

- All persisted money values are currency precision (`2` decimal places).
- All server-side computed money values are quantized with `ROUND_HALF_UP` to `$0.01`.
- This applies to estimate, invoice, payment allocation, change-order, and vendor-bill calculations.
- Contract: API money responses must always serialize as fixed two-decimal strings (example: `"1000.00"`).

## Initial Endpoint Plan

- `GET /api/v1/health/`
  - Purpose: service liveness/readiness signal for local and deployment checks.
  - Response fields:
    - `status` (`ok`)
    - `app_revision` (nullable deployment commit/revision identifier from env when configured)
    - `data_reset_at` (nullable ISO timestamp of last demo data reset marker)

## Authentication (v1 baseline)

bill-n-chill currently uses DRF token authentication for API access.

- `POST /api/v1/auth/login/`
  - Body:
    ```json
    {
      "email": "pm@example.com",
      "password": "secret123"
    }
    ```
  - Success response:
    ```json
    {
      "data": {
        "token": "TOKEN_VALUE",
        "user": {
          "id": 1,
          "email": "pm@example.com",
          "role": "owner"
        },
        "organization": {
          "id": 1,
          "display_name": "Pm Organization",
          "slug": "pm"
        }
      }
    }
    ```
- `GET /api/v1/auth/me/`
  - Header: `Authorization: Token TOKEN_VALUE`
  - Purpose: confirm token validity and current user identity.
  - Response includes:
    - `id`
    - `email`
    - `role` (`owner` | `pm` | `bookkeeping` | `worker` | `viewer`)
    - `organization` (`id`, `display_name`, `slug`)
- Auth bootstrap audit behavior:
  - if a user has no active org membership, auth self-heal creates an `Organization` and `OrganizationMembership`
  - the bootstrap write appends immutable `OrganizationRecord(event_type=created, capture_source=auth_bootstrap)`
  - the bootstrap write appends immutable `OrganizationMembershipRecord(event_type=created, capture_source=auth_bootstrap)`

## Role Matrix (RBAC Thin Pass)

- Role source:
  - Primary source: `OrganizationMembership.role` (one active membership per user).
  - Backward compatibility fallback: Django group name match (`owner`, `pm`, `bookkeeping`, `worker`, `viewer`), then default `owner`.
- Error shape for denied write action:
  - HTTP `403`
  - `error.code = "forbidden"`
- Write access matrix:
  - `owner`: full write access across money workflow endpoints.
  - `pm`: estimate/budget/change-order/invoice/vendor-bill writes.
  - `bookkeeping`: invoice/vendor-bill/payment/accounting-sync writes.
  - `viewer`: read-only across protected surfaces.

## Customer Intake (INT-01)

- `POST /api/v1/lead-contacts/quick-add/`
  - Auth required: `Authorization: Token TOKEN_VALUE`
  - Note: endpoint path is legacy-named; behavior is customer-first.
  - Note: quick-add captures immutable intake records and does not create mutable `LeadContact` rows.
  - Required fields:
    - `full_name`
    - `phone`
    - `project_address`
  - Optional fields:
    - `email`
    - `notes`
    - `source` (`field_manual`, `office_manual`, `import`, `web_form`, `referral`, `other`)
  - Success response includes:
    - `data.lead_contact` (intake payload keyed by immutable intake-record id)
    - `data.customer`
    - `data.project` (nullable)
  - Audit behavior:
    - appends immutable intake/customer audit captures for create and duplicate-resolution flows.

## Duplicate Detection and Resolution (INT-02)

Quick Add now checks potential duplicates (phone/email).

If duplicates are detected and no resolution is provided:

- response status: `409`
- response body includes:
  - `error.code = "duplicate_detected"`
  - `data.duplicate_candidates[]`
  - `data.allowed_resolutions = ["use_existing", "merge_existing", "create_anyway"]`

Resolution fields accepted by `POST /api/v1/lead-contacts/quick-add/`:

- `duplicate_resolution`:
  - `use_existing`: return selected existing customer without creating a new one
  - `merge_existing`: update selected existing customer with incoming values
  - `create_anyway`: create new customer despite duplicates
- `duplicate_target_id`:
  - required for `use_existing` and `merge_existing`

## Intake Conversion (INT-03)

- `POST /api/v1/lead-contacts/{lead_id}/convert-to-project/`
  - Auth required: `Authorization: Token TOKEN_VALUE`
  - Note: this route remains for compatibility; primary quick-add flow now supports direct optional project creation.
  - Request body:
    - `project_name` (optional; defaults to `<intake full name> Project`)
    - `project_status` (optional; default `prospect`)
      - allowed: `prospect`, `active`, `on_hold`, `completed`, `cancelled`
  - Behavior:
    - creates or reuses a matching `Customer`
    - creates a `Project` shell (job `site_address` seeded from intake `project_address`)
    - marks intake row as `project_created` and stores conversion links
  - Audit behavior:
    - appends immutable intake conversion audit capture (`event_type=converted`, `capture_source=manual_ui`)
    - appends immutable `CustomerRecord(event_type=created|updated, capture_source=manual_ui)` when customer rows are created/updated during conversion
  - Idempotency:
    - If intake row is already converted, returns existing customer/project with `meta.conversion_status = "already_converted"`.

## Project Profile and Baseline (PRJ-01)

- `GET /api/v1/projects/`
  - Auth required
  - Returns current user project shells with customer context.

- `GET /api/v1/projects/{project_id}/`
  - Auth required
  - Returns one project profile record for current user.

- `PATCH /api/v1/projects/{project_id}/`
  - Auth required
  - Supports profile updates:
    - `name`
    - `status`
    - `site_address`
    - `start_date_planned`
    - `end_date_planned`
  - Guardrails:
    - `contract_value_original` is immutable after create
    - `contract_value_current` is system-derived and cannot be set directly
    - `completed` / `cancelled` projects are terminal and blocked from further edits

## Customer Management (OPS-01)

- `GET /api/v1/customers/`
  - Auth required
  - Returns user-scoped customer rows with optional query filter:
    - `q` (free-text over name/phone/email/address)

- `GET /api/v1/customers/{customer_id}/`
  - Auth required
  - Returns one user-scoped customer record.

- `PATCH /api/v1/customers/{customer_id}/`
  - Auth required
  - Updates editable customer fields (`display_name`, `phone`, `email`, `billing_address`, `is_archived`).
  - Write behavior appends immutable `CustomerRecord(event_type=updated, capture_source=manual_ui)`.

- `DELETE /api/v1/customers/{customer_id}/`
  - Auth required
  - Deletes one customer when no protected project references remain.
  - Write behavior appends immutable `CustomerRecord(event_type=deleted, capture_source=manual_ui)` before delete.

- Legacy alias compatibility:
  - `/api/v1/contacts/` and `/api/v1/contacts/{id}/` remain available as aliases for `/customers` routes.

## Cost Code Management (EST-01)

- `GET /api/v1/cost-codes/`
  - Auth required
  - Returns cost codes scoped to active organization context.
  - Transitional fallback includes legacy null-org rows created by current user.

- `POST /api/v1/cost-codes/`
  - Auth required
  - Creates a cost code with:
    - `code`
    - `name`
    - `is_active`

- `PATCH /api/v1/cost-codes/{cost_code_id}/`
  - Auth required
  - Updates `name` and/or `is_active`.
  - `code` is immutable after create.

- `POST /api/v1/cost-codes/import-csv/`
  - Auth required
  - Role guard: `owner`, `pm`
  - Body:
    - `csv_text` (required)
    - `dry_run` (optional; default `true`)
  - Expected headers:
    - required: `code`, `name`
    - optional: `is_active`
  - Behavior:
    - existing rows matched by `code` (case-insensitive)
    - preview mode returns row-level `would_create` / `would_update`
    - apply mode creates/updates rows and returns row-level results.

## Estimate Authoring and Versioning (EST-02)

- `GET /api/v1/projects/{project_id}/estimates/`
  - Auth required
  - Returns estimate versions for the selected project.

- `POST /api/v1/projects/{project_id}/estimates/`
  - Auth required
  - Creates a new estimate version with:
    - `title`
    - `tax_percent`
    - `line_items[]` (cost code, description, quantity, unit, unit_cost, markup_percent)
  - Server computes line totals and estimate totals.

- `GET /api/v1/estimates/{estimate_id}/`
  - Auth required
  - Returns one estimate with line items.

- `GET /api/v1/public/estimates/{public_token}/`
  - No auth required
  - Returns public estimate view payload for controlled external sharing.

- `PATCH /api/v1/estimates/{estimate_id}/`
  - Auth required
  - Supports updating estimate status/title/tax and replacing line items.
  - Note: `archived` is system-controlled and cannot be set directly by API consumers.

- `POST /api/v1/estimates/{estimate_id}/clone-version/`
  - Auth required
  - Creates a new draft version cloned from the selected estimate.

## Estimate Approval Lifecycle (EST-03)

- `PATCH /api/v1/estimates/{estimate_id}/`
  - Auth required
  - Supports status transitions with optional audit note:
    - `status`
    - `status_note`
  - Allowed transitions:
    - `draft -> sent | void`
    - `sent -> approved | rejected | void`
    - `rejected -> void`
    - `approved -> (no further transitions)`
    - `void -> (no further transitions)`
  - Internal/system transition:
    - `draft|sent -> archived` is used for superseded estimate-family history and is not user-settable.

- `GET /api/v1/estimates/{estimate_id}/status-events/`
  - Auth required
  - Returns audit trail entries for estimate status changes, including actor, timestamp, and note.

## Budget Baseline Conversion (BGT-01)

- `POST /api/v1/estimates/{estimate_id}/convert-to-budget/`
  - Auth required
  - Converts an approved estimate into a project budget.
  - Validation:
    - blocked unless estimate status is `approved`
  - Behavior:
    - creates immutable baseline snapshot (`baseline_snapshot_json`)
    - creates editable working `BudgetLine` rows from estimate line items
    - supersedes previously active budget for the same project
  - Idempotency:
    - if estimate was already converted, returns existing budget with `meta.conversion_status = "already_converted"`.

- `GET /api/v1/projects/{project_id}/budgets/`
  - Auth required
  - Returns budgets for the selected project, including budget line rows.
  - Includes CO-02 aggregate fields:
    - `approved_change_order_total`
    - `base_working_total`
    - `current_working_total`

- `PATCH /api/v1/budgets/{budget_id}/lines/{line_id}/`
  - Auth required
  - Updates editable working budget line fields:
    - `description` (optional)
    - `budget_amount` (optional)
  - Validation:
    - budget must be `active`

## Change Order Lifecycle (CO-01)

Current product posture:
- Change orders are currently internal-facing workflow records (internal user operated).
- Customer-facing delivery/approval mechanics (estimate-style public send/re-send loop) are planned but not yet implemented.

- `GET /api/v1/projects/{project_id}/change-orders/`
  - Auth required
  - Returns change-order revisions for the selected project, scoped to current user.
  - Family semantics:
    - `family_key` = family/thread key
    - `revision_number` = revision inside family
    - `is_latest_revision` marks editable/latest record
  - Traceability fields:
    - `origin_estimate` (nullable)
    - `previous_change_order` (nullable explicit pointer to prior revision)

- `POST /api/v1/projects/{project_id}/change-orders/`
  - Auth required
  - Creates a new change order in `draft` with:
    - `title` (required)
    - `amount_delta` (required)
    - `days_delta` (optional, default `0`)
    - `reason` (optional)
    - `origin_estimate` (optional; estimate id from same project)
    - `line_items[]` (optional scaffold):
      - `budget_line` (required when row present; must belong to active budget for project)
      - `description` (optional)
      - `amount_delta` (required)
      - `days_delta` (optional)
  - Validation:
    - project must have an active budget baseline before change-order creation.
    - if `line_items` are provided, sum of line `amount_delta` must equal change-order `amount_delta`.

- `GET /api/v1/change-orders/{change_order_id}/`
  - Auth required
  - Returns one change-order revision record.

- `POST /api/v1/change-orders/{change_order_id}/clone-revision/`
  - Auth required
  - Creates next draft revision within same CO family:
    - keeps `family_key` (family)
    - increments `revision_number`
    - sets `previous_change_order` to source revision
    - copies title/amount/days/reason/origin-estimate and line items

- `PATCH /api/v1/change-orders/{change_order_id}/`
  - Auth required
  - Supports updating:
    - `title`
    - `amount_delta`
    - `days_delta`
    - `reason`
    - `status`
    - `line_items[]` (optional full-replace scaffold)
  - Revision rule:
    - only latest revision in family is editable
  - Allowed transitions:
    - `draft -> pending_approval | void`
    - `pending_approval -> draft | approved | rejected | void`
    - `approved -> void`
    - `rejected -> draft | void`
    - `void -> (no further transitions)`
  - Important:
    - direct `draft -> approved` is invalid; CO must move through `pending_approval` first.
  - Approval behavior:
    - transition to `approved` sets `approved_by` and `approved_at`.
  - Line-item consistency:
    - if `line_items` are supplied, they fully replace existing rows and must sum to `amount_delta`.
    - if existing line items are present, changing only `amount_delta` is blocked unless line totals stay equal.

## Change Order Financial Propagation (CO-02)

CO-02 extends existing CO endpoints with propagation behavior.

- `PATCH /api/v1/change-orders/{change_order_id}/`
  - When change order moves to `approved`:
    - increments `Project.contract_value_current` by CO `amount_delta`
    - increments active `Budget.approved_change_order_total` by CO `amount_delta`
  - When an approved change order moves out of `approved` (for example `approved -> void`):
    - reverses the same amounts from project and active budget aggregates
  - If `amount_delta` is edited while CO is already `approved`:
    - applies only the delta difference to project and budget aggregates
  - Validation:
    - active budget is required for propagation events

- Billable amount basis in current v1:
  - billable basis is derived from project contract current value until invoice composition features are implemented.

## Change Order Decision Snapshots (CO-03)

- Immutable decision snapshots are captured for financially relevant decision outcomes.
- Triggered on `PATCH /api/v1/change-orders/{change_order_id}/` when status transitions to:
  - `approved`
  - `rejected`
  - `void`
- Not captured for non-decision/internal workflow states:
  - `draft`
  - `pending_approval`
- Snapshot payload stores point-in-time:
  - change-order header data
  - linked line-item rows
  - actor/timestamp metadata
  - decision context (`previous_status`, `applied_financial_delta`)
  - `origin_estimate_version` for historical replay/traceability (not primary operational usage)

## Reporting Pack v1 (RPT-01)

- `GET /api/v1/reports/portfolio/`
  - Auth required
  - Returns portfolio-level rollup:
    - `active_projects_count`
    - `ar_total_outstanding`
    - `ap_total_outstanding`
    - `overdue_invoice_count`
    - `overdue_vendor_bill_count`
    - `projects[]` with per-project AR/AP outstanding and approved CO totals
  - Optional query filters:
    - `date_from=YYYY-MM-DD`
    - `date_to=YYYY-MM-DD`
  - Filter behavior:
    - affects overdue invoice/vendor-bill counts by issue date range.

- `GET /api/v1/reports/change-impact/`
  - Auth required
  - Returns approved change-order impact rollup:
    - `approved_change_order_count`
    - `approved_change_order_total`
    - `projects[]` with approved CO count/total per project
  - Optional query filters:
    - `date_from=YYYY-MM-DD`
    - `date_to=YYYY-MM-DD`
  - Filter behavior:
    - filters approved CO rows by `approved_at` date window.

## Attention Feed (RPT-02)

- `GET /api/v1/reports/attention-feed/`
  - Auth required
  - Returns in-app actionable attention items across projects:
    - overdue invoices
    - vendor bills due soon (next 7 days)
    - change orders pending approval
    - failed/voided payments
  - Response includes:
    - `generated_at`
    - `due_soon_window_days`
    - `item_count`
    - `items[]` with severity, label/detail, project context, and source links.

## Search + Quick Jump (NAV-01)

- `GET /api/v1/search/quick-jump/?q=<query>`
  - Auth required
  - Global lightweight search across:
    - projects
    - estimates
    - change orders
    - invoices
    - vendor bills
    - payments
  - Response includes:
    - `query`
    - `item_count`
    - `items[]` (kind, label, project context, `ui_href`, and API `detail_endpoint`)
  - Notes:
    - minimum query length is 2 chars (shorter queries return empty list)
    - results are scoped to current authenticated user data.

## Invoice Composition and Send (INV-01)

- `GET /api/v1/projects/{project_id}/invoices/`
  - Auth required
  - Returns invoices for the selected project, including line items and computed totals.

- `POST /api/v1/projects/{project_id}/invoices/`
  - Auth required
  - Creates a new invoice in `draft` with:
    - `issue_date` (optional; defaults to today)
    - `due_date` (optional; defaults to `issue_date + 30 days`)
    - `tax_percent` (optional; default `0`)
    - `line_items[]` (required)
      - `line_type` (optional; `scope` or `adjustment`, default `scope`)
      - `cost_code` (optional)
      - `scope_item` (optional; canonical scope identity)
      - `adjustment_reason` (optional string; required when `line_type=adjustment`)
      - `internal_note` (optional string; internal-only context)
      - `description` (required)
      - `quantity` (required)
      - `unit` (optional; default `ea`)
      - `unit_price` (required)
  - Validation:
    - at least one line item is required
    - due date must be on/after issue date
    - if `line_type=adjustment`, `adjustment_reason` is required
    - if both `scope_item` and `cost_code` are provided, their cost-code identity must match
    - `scope_item` must be accessible in the current active organization scope
  - Behavior:
    - computes line totals, subtotal, tax total, total, and balance due
    - auto-generates `invoice_number` per project (`INV-####`)
    - stores one canonical line set (no separate internal/customer editable line universes)

- `GET /api/v1/invoices/{invoice_id}/`
  - Auth required
  - Returns one invoice record with line items.

- `GET /api/v1/invoices/{invoice_id}/status-events/`
  - Auth required
  - Returns invoice status transition history (`InvoiceStatusEvent` rows), including actor and timestamp.

- `PATCH /api/v1/invoices/{invoice_id}/`
  - Auth required
  - Supports updating:
    - `status`
    - `issue_date`
    - `due_date`
    - `tax_percent`
    - `line_items` (replaces existing lines)
      - accepts same line schema as create (`line_type`, `scope_item`, adjustment metadata)
  - Allowed transitions:
    - `draft -> sent | void`
    - `sent -> draft | partially_paid | paid | overdue | void`
    - `partially_paid -> sent | paid | overdue | void`
    - `paid -> void`
    - `overdue -> partially_paid | paid | void`
    - `void -> (no further transitions)`
  - Totals behavior:
    - recalculates totals when line items or tax percent changes
    - sets `balance_due = 0` when status is `paid`

- `POST /api/v1/invoices/{invoice_id}/send/`
  - Auth required
  - Convenience action to set status to `sent` from an allowed prior state.

### Invoice Lineage Decision

- Invoice lines are billing-time composition rows and may regroup/split partial scope across invoice cycles.
- `ScopeItem` is the canonical cross-artifact identity anchor used when strict lineage is needed.
- `EstimateLineItem` and `BudgetLine` are context rows and are not required invoice FKs.
- Non-estimate/non-scope billing is allowed only as explicit `adjustment` lines with required reason metadata.
- External/public invoice views should hide internal-only metadata fields (for example `internal_note`).

## Unapproved Scope Billing Protection (INV-02)

INV-02 extends invoice billing actions with a scope guard based on approved project billable amount.

- Billable scope basis
  - `Project.contract_value_current` is treated as approved billable scope.
  - Billable committed total is computed from project invoices in statuses:
    - `sent`
    - `partially_paid`
    - `paid`
    - `overdue`
  - `draft` and `void` invoices are excluded from the committed total.

- Guarded actions
  - `POST /api/v1/invoices/{invoice_id}/send/`
    - blocked when projected billed total would exceed approved scope unless override is provided.
  - `PATCH /api/v1/invoices/{invoice_id}/`
    - guarded when:
      - status transition enters a billable status, or
      - line/tax edits change totals while invoice remains billable.

- Override payload (both guarded endpoints)
  - `scope_override` (optional boolean; default `false`)
  - `scope_override_note` (optional string; required when `scope_override=true` and guard is exceeded)

- Validation behavior
  - Without override:
    - returns `400` `validation_error` with scope details:
      - approved scope limit
      - already billed total
      - projected billed total
      - overage amount
  - With override:
    - requires non-empty `scope_override_note`
    - writes an audit record (`InvoiceScopeOverrideEvent`) including note and overage snapshot.

## Vendor Directory (VEN-01)

- `GET /api/v1/vendors/`
  - Auth required
  - Returns vendors scoped to the current active organization.
  - Transitional fallback includes legacy null-org rows created by current user.
  - Supports optional search query:
    - `q` (matches name/email/phone/tax_id_last4, case-insensitive contains)

- `POST /api/v1/vendors/`
  - Auth required
  - Creates a vendor with:
    - `name` (required)
    - `email` (optional)
    - `phone` (optional)
    - `tax_id_last4` (optional; digits only)
    - `notes` (optional)
    - `is_active` (optional; default `true`)
  - Duplicate warning behavior:
    - checks duplicates by exact name/email within active organization scope
    - if duplicates are found and `duplicate_override != true`:
      - returns `409` with `error.code = "duplicate_detected"`
      - returns `data.duplicate_candidates[]`
      - returns `data.allowed_resolutions = ["create_anyway"]`
    - set `duplicate_override = true` to create anyway

- `GET /api/v1/vendors/{vendor_id}/`
  - Auth required
  - Returns one vendor record scoped to the current active organization.

- `PATCH /api/v1/vendors/{vendor_id}/`
  - Auth required
  - Supports updating:
    - `name`
    - `email`
    - `phone`
    - `tax_id_last4`
    - `notes`
    - `is_active`
  - Duplicate warning behavior:
    - same name/email duplicate check as create (excluding current vendor)
    - accepts `duplicate_override = true` to persist intentional duplicates

- `POST /api/v1/vendors/import-csv/`
  - Auth required
  - Role guard: `owner`, `pm`, `bookkeeping`
  - Body:
    - `csv_text` (required)
    - `dry_run` (optional; default `true`)
  - Expected headers:
    - required: `name`
    - optional: `vendor_type`, `email`, `phone`, `tax_id_last4`, `notes`, `is_active`
  - Behavior:
    - existing rows matched by `name` (case-insensitive)
    - preview mode returns row-level `would_create` / `would_update`
    - apply mode creates/updates rows and returns row-level results.

## Vendor Bill Intake and Lifecycle (AP-01)

- `GET /api/v1/projects/{project_id}/vendor-bills/`
  - Auth required
  - Returns vendor bills for selected project, scoped to current user.

- `POST /api/v1/projects/{project_id}/vendor-bills/`
  - Auth required
  - Creates vendor bill in `planned` with:
    - `vendor` (required)
    - `bill_number` (required)
    - `total` (required)
    - `issue_date` (optional; defaults to today)
    - `due_date` (optional; defaults to issue date + 30 days)
    - `notes` (optional)
  - Validation:
    - `vendor` must belong to current user
    - `due_date` must be on/after `issue_date`
  - Duplicate warning behavior:
    - checks duplicates by `vendor + bill_number` (case-insensitive bill number) within current user scope
    - if duplicates are found and `duplicate_override != true`:
      - returns `409` with `error.code = "duplicate_detected"`
      - returns `data.duplicate_candidates[]`
      - returns `data.allowed_resolutions = ["create_anyway"]`
    - set `duplicate_override = true` to create anyway

- `GET /api/v1/vendor-bills/{vendor_bill_id}/`
  - Auth required
  - Returns one vendor bill record scoped to current user.

- `PATCH /api/v1/vendor-bills/{vendor_bill_id}/`
  - Auth required
  - Supports updating:
    - `vendor`
    - `bill_number`
    - `issue_date`
    - `due_date`
    - `total`
    - `notes`
    - `status`
  - Status transitions:
    - `planned -> received | void`
    - `received -> approved | void`
    - `approved -> scheduled | paid | void`
    - `scheduled -> paid | void`
    - `paid -> void`
    - `void -> (no further transitions)`
  - Balance behavior:
    - `status = paid` forces `balance_due = 0`
    - non-paid statuses keep `balance_due = total`
  - Duplicate warning behavior:
    - same `vendor + bill_number` check as create (excluding current bill)
    - accepts `duplicate_override = true` to persist intentional duplicates

## Payment Recording (PAY-01)

- `GET /api/v1/projects/{project_id}/payments/`
  - Auth required
  - Returns payments for selected project, scoped to current user.
  - Includes:
    - `allocated_total`
    - `unapplied_amount`
    - `allocations[]`

- `POST /api/v1/projects/{project_id}/payments/`
  - Auth required
  - Creates payment record with:
    - `direction` (required; `inbound` or `outbound`)
    - `method` (required; `ach`, `card`, `check`, `wire`, `cash`, `other`)
    - `amount` (required; positive decimal)
    - `status` (optional; default `pending`)
    - `payment_date` (optional; defaults to today)
    - `reference_number` (optional)
    - `notes` (optional)
  - Validation:
    - required fields must be present (`direction`, `method`, `amount`)
    - amount must be greater than `0`
  - Audit behavior:
    - appends immutable `PaymentRecord(event_type=created, capture_source=manual_ui)`

- `GET /api/v1/payments/{payment_id}/`
  - Auth required
  - Returns one payment record scoped to current user.

- `PATCH /api/v1/payments/{payment_id}/`
  - Auth required
  - Supports updating:
    - `direction`
    - `method`
    - `status`
    - `amount`
    - `payment_date`
    - `reference_number`
    - `notes`
  - Status transitions:
    - `pending -> settled | failed | void`
    - `settled -> void`
    - `failed -> void`
    - `void -> (no further transitions)`
  - Allocation safeguards:
    - payment `amount` cannot be reduced below existing allocated total
    - `direction` cannot be changed after allocations exist
  - Audit behavior:
    - appends immutable `PaymentRecord(event_type=updated|status_changed, capture_source=manual_ui)`

## Payment Allocation (PAY-02)

- `POST /api/v1/payments/{payment_id}/allocate/`
  - Auth required
  - Allocates settled payment amount across one or more targets.
  - Request body:
    - `allocations[]` (required, at least one)
      - `target_type` (`invoice` | `vendor_bill`)
      - `target_id` (integer id)
      - `applied_amount` (positive decimal)
  - Validation:
    - payment must be in `settled` status
    - `target_type` must match payment direction:
      - `inbound -> invoice`
      - `outbound -> vendor_bill`
    - target must belong to same user + same project as payment
    - target must not be `void`
    - target must have remaining `balance_due > 0`
    - total new allocations must not exceed payment unapplied amount
  - Balance/status behavior:
    - invoice and vendor-bill `balance_due` are recomputed from settled allocations
    - fully allocated invoices/vendor bills become `paid`
    - partially allocated invoices become `partially_paid`
  - Response:
    - `data.payment` with updated allocation totals
    - `data.created_allocations[]`
    - `meta.allocated_total`
    - `meta.unapplied_amount`
  - Audit behavior:
    - appends immutable `PaymentRecord(event_type=allocation_applied, capture_source=manual_ui)`
    - appends immutable `PaymentAllocationRecord(event_type=applied, capture_source=manual_ui)` per created allocation row

## Project Financial Summary (FIN-01)

- `GET /api/v1/projects/{project_id}/financial-summary/`
  - Auth required
  - Returns project-level financial rollup scoped to current user:
    - `contract_value_original`
    - `contract_value_current`
    - `approved_change_orders_total`
    - `invoiced_to_date`
    - `paid_to_date`
    - `ar_outstanding`
    - `ap_total`
    - `ap_paid`
    - `ap_outstanding`
    - `inbound_unapplied_credit`
    - `outbound_unapplied_credit`
  - Calculation basis:
    - `approved_change_orders_total`: sum of approved CO `amount_delta`
    - `paid_to_date`: sum of settled inbound payment allocations
    - `ap_paid`: sum of settled outbound payment allocations
    - Outstanding values are clamped to `0` minimum for summary readability.

## Financial Drill-Down Traceability (FIN-02)

`GET /api/v1/projects/{project_id}/financial-summary/` now includes `data.traceability` buckets so each summary metric has source links:

- `approved_change_orders`
- `ar_invoices`
- `ar_payments`
- `ap_vendor_bills`
- `ap_payments`

Each bucket contains:
- `ui_route` (frontend page for click-through)
- `list_endpoint` (project-scoped API list endpoint)
- `total` (bucket subtotal used by summary rollup)
- `records[]`:
  - `id`
  - `label`
  - `status`
  - `amount`
  - `detail_endpoint`

## Accounting Export Bridge (ACC-01)

- `GET /api/v1/projects/{project_id}/accounting-export/`
  - Auth required
  - Query parameter:
    - `export_format` (`csv` default, or `json`)
  - Purpose:
    - provide stable project-level export for accounting reconciliation.
    - export is built from the same FIN summary source so totals align with in-app summary metrics.

### CSV Export Shape (`export_format=csv`)

- Response content type: `text/csv`
- Download filename: `project-{project_id}-accounting-export.csv`
- Columns:
  - `row_type`
  - `section`
  - `metric`
  - `record_id`
  - `label`
  - `status`
  - `amount`
  - `endpoint`
- Row types:
  - `summary` rows: one row per summary metric
  - `record` rows: one row per traceable source transaction

### JSON Export Shape (`export_format=json`)

- Returns:
  - `project_id`
  - `project_name`
  - `generated_at`
  - `summary` (same metric values as FIN summary output)
  - `traceability` (same FIN-02 buckets and source records)

## QuickBooks Sync Foundation (ACC-02)

- `GET /api/v1/projects/{project_id}/accounting-sync-events/`
  - Auth required
  - Returns project-scoped sync event log entries for current user.

- `POST /api/v1/projects/{project_id}/accounting-sync-events/`
  - Auth required
  - Creates a sync event record with:
    - `provider` (required; `quickbooks_online`)
    - `object_type` (required)
    - `object_id` (optional)
    - `direction` (required; `push` | `pull`)
    - `status` (optional; `queued` default, `success`, `failed`)
    - `external_id` (optional)
    - `error_message` (optional)
  - Behavior:
    - sets `last_attempt_at` when created in terminal states (`success`/`failed`).
  - Audit behavior:
    - appends immutable `AccountingSyncRecord(event_type=created, capture_source=manual_ui)`

- `POST /api/v1/accounting-sync-events/{sync_event_id}/retry/`
  - Auth required
  - Safe retry behavior:
    - `failed -> queued`:
      - clears `error_message`
      - increments `retry_count`
      - updates `last_attempt_at`
      - returns `meta.retry_status = "retried"`
    - `queued`:
      - no-op idempotent response
      - returns `meta.retry_status = "already_queued"`
    - `success`:
      - blocked with validation error
  - Audit behavior:
    - appends immutable `AccountingSyncRecord(event_type=retried, capture_source=manual_ui)` on `failed -> queued`

## Financial Audit Trail (QA-01)

- `GET /api/v1/projects/{project_id}/audit-events/`
  - Auth required
  - Returns immutable project-scoped financial index rows (`FinancialAuditEvent`) for current user/project.
  - Note:
    - this endpoint is a compatibility timeline/index surface, not the canonical source of truth for every lane.
    - canonical payment provenance/lifecycle capture is append-only `PaymentRecord`.
    - canonical accounting-sync lifecycle capture is append-only `AccountingSyncRecord`.
  - Event coverage includes:
    - estimate status transitions
    - estimate-to-budget conversions
    - change-order updates and approval propagation
    - invoice lifecycle updates and sends
    - invoice scope-override approvals
    - vendor-bill lifecycle updates
    - payment updates (create/patch/status)
    - payment allocations
  - Row fields:
    - `event_type`
    - `object_type`
    - `object_id`
    - `from_status`
    - `to_status`
    - `amount`
    - `note`
    - `metadata_json`
    - `created_by`
    - `created_at`
  - Immutability:
    - rows are append-only and cannot be updated/deleted through API.

## Project Timeline / Activity Center (QA-02)

- `GET /api/v1/projects/{project_id}/timeline/`
  - Auth required
  - Returns a read-only project timeline merged from:
    - financial audit events (`FinancialAuditEvent`)
    - workflow estimate status events (`EstimateStatusEvent`)
  - Query params:
    - `category` (optional; default `all`)
      - allowed: `all`, `financial`, `workflow`
  - Response fields:
    - `project_id`
    - `project_name`
    - `category`
    - `item_count`
    - `items[]` with:
      - `timeline_id`
      - `category`
      - `event_type`
      - `occurred_at`
      - `label`
      - `detail`
      - `object_type`
      - `object_id`
      - `ui_route`
      - `detail_endpoint`

## Versioning Rules

- Non-breaking changes can stay in `v1`.
- Breaking changes require `v2` path introduction.
