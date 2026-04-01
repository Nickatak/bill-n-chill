# API Standards

Last reviewed: 2026-03-04

## Table of Contents

- [API Foundations (Meta)](#api-foundations-meta)
  - [Base Path](#base-path)
  - [API Map Tree](#api-map-tree)
  - [Response Conventions](#response-conventions)
  - [Money Precision Policy](#money-precision-policy)
  - [Core Health Endpoint](#core-health-endpoint)
  - [Authentication (v1 baseline)](#authentication-v1-baseline)
  - [RBAC: Capability-Based Enforcement](#rbac-capability-based-enforcement)
  - [Auditability and Traceability Standards](#auditability-and-traceability-standards)
  - [API Versioning Rules](#api-versioning-rules)
- [Endpoint Contracts (Spec)](#endpoint-contracts-spec)
  - [Organization Management (OPS-ORG-01)](#organization-management-ops-org-01)
  - [Customer Intake (INT-01)](#customer-intake-int-01)
  - [Duplicate Detection and Resolution (INT-02)](#duplicate-detection-and-resolution-int-02)
  - [Project Profile and Baseline (PRJ-01)](#project-profile-and-baseline-prj-01)
  - [Customer Management (OPS-01)](#customer-management-ops-01)
  - [Cost Code Management (EST-01)](#cost-code-management-est-01)
  - [Quote Authoring and Versioning (EST-02)](#quote-authoring-and-versioning-est-02)
  - [Quote Approval Lifecycle (EST-03)](#quote-approval-lifecycle-est-03)
  - [Change Order Lifecycle (CO-01)](#change-order-lifecycle-co-01)
  - [Change Order Financial Propagation (CO-02)](#change-order-financial-propagation-co-02)
  - [Change Order Decision Snapshots (CO-03)](#change-order-decision-snapshots-co-03)
  - [Reporting Pack v1 (RPT-01)](#reporting-pack-v1-rpt-01)
  - [Attention Feed (RPT-02)](#attention-feed-rpt-02)
  - [Search + Quick Jump (NAV-01)](#search--quick-jump-nav-01)
  - [Invoice Composition and Send (INV-01)](#invoice-composition-and-send-inv-01)
  - [Unapproved Scope Billing Protection (INV-02)](#unapproved-scope-billing-protection-inv-02)
  - [Vendor Directory (VEN-01)](#vendor-directory-ven-01)
  - [Vendor Bill Intake and Lifecycle (AP-01)](#vendor-bill-intake-and-lifecycle-ap-01)
  - [Payment Recording (PAY-01)](#payment-recording-pay-01)
  - [Payment Allocation (PAY-02)](#payment-allocation-pay-02)
  - [Project Financial Summary (FIN-01)](#project-financial-summary-fin-01)
  - [Financial Drill-Down Traceability (FIN-02)](#financial-drill-down-traceability-fin-02)
  - [Accounting Export Bridge (ACC-01)](#accounting-export-bridge-acc-01)
  - [QuickBooks Sync Foundation (ACC-02)](#quickbooks-sync-foundation-acc-02)
  - [Project Timeline / Activity Center (QA-02)](#project-timeline--activity-center-qa-02)

## API Foundations (Meta)

This section defines global API conventions, invariants, and cross-cutting policies.

## Base Path

- `/api/v1/`

## API Map Tree

Source of truth: `backend/core/urls.py`.

```text
/api/v1/
├── health/
├── auth/
│   ├── login/
│   ├── register/
│   ├── me/
│   ├── verify-email/
│   ├── resend-verification/
│   ├── check-invite/{token}/
│   ├── verify-invite/{token}/
│   └── accept-invite/
├── organization/
│   ├── logo/
│   ├── memberships/
│   │   └── {membership_id}/
│   └── invites/
│       └── {invite_id}/
├── customers/
│   ├── quick-add/
│   ├── {customer_id}/
│   └── {customer_id}/projects/
├── projects/
│   ├── {project_id}/
│   ├── {project_id}/financial-summary/
│   ├── {project_id}/timeline/
│   ├── {project_id}/accounting-export/
│   ├── {project_id}/accounting-sync-events/
│   ├── {project_id}/quotes/
│   ├── {project_id}/change-orders/
│   ├── {project_id}/invoices/
│   ├── {project_id}/vendor-bills/
│   └── {project_id}/payments/
├── reports/
│   ├── attention-feed/
│   ├── portfolio/
│   └── change-impact/
├── search/
│   └── quick-jump/
├── contracts/
│   ├── quotes/
│   ├── change-orders/
│   ├── invoices/
│   ├── vendor-bills/
│   └── payments/
├── public/
│   ├── quotes/{public_token}/
│   ├── quotes/{public_token}/otp/
│   ├── quotes/{public_token}/otp/verify/
│   ├── quotes/{public_token}/decision/
│   ├── change-orders/{public_token}/
│   ├── change-orders/{public_token}/otp/
│   ├── change-orders/{public_token}/otp/verify/
│   ├── change-orders/{public_token}/decision/
│   ├── invoices/{public_token}/
│   ├── invoices/{public_token}/otp/
│   ├── invoices/{public_token}/otp/verify/
│   └── invoices/{public_token}/decision/
├── quotes/
│   └── {quote_id}/
│       ├── status-events/
│       ├── clone-version/
│       └── duplicate/
├── change-orders/
│   └── {change_order_id}/
│       └── clone-revision/
├── invoices/
│   └── {invoice_id}/
│       ├── send/
│       └── status-events/
├── vendor-bills/
│   └── {vendor_bill_id}/
├── payments/
│   └── {payment_id}/
│       └── allocate/
├── accounting-sync-events/
│   └── {sync_event_id}/retry/
├── vendors/
│   ├── import-csv/
│   └── {vendor_id}/
└── cost-codes/
    ├── import-csv/
    └── {cost_code_id}/
```

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
- This applies to quote, invoice, payment allocation, change-order, and vendor-bill calculations.
- Contract: API money responses must always serialize as fixed two-decimal strings (example: `"1000.00"`).

## Core Health Endpoint

- `GET /api/v1/health/`
  - Purpose: service liveness/readiness signal for local and deployment checks.
  - Response fields:
    - `status` (`ok`)

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
          "display_name": "Pm Organization"
        },
        "capabilities": {
          "quotes": ["view", "create", "edit", "approve", "send"],
          "invoices": ["view", "create", "edit", "approve", "send"],
          "...": "..."
        }
      }
    }
    ```
- `POST /api/v1/auth/register/`
  - Same response shape as login (including `capabilities`).
- `GET /api/v1/auth/me/`
  - Header: `Authorization: Token TOKEN_VALUE`
  - Purpose: confirm token validity and current user identity.
  - Response includes:
    - `id`
    - `email`
    - `role` (`owner` | `pm` | `bookkeeping` | `worker` | `viewer`)
    - `organization` (`id`, `display_name`)
    - `capabilities` (resolved capability flags dict — same shape as login)
- `GET /api/v1/auth/verify-invite/{token}/`
  - No auth required (public endpoint).
  - Validates an invite token and returns invite context for the registration/accept-invite UI.
  - Response includes:
    - `organization_name`
    - `email`
    - `role`
    - `is_existing_user` (boolean — determines Flow B vs Flow C)
  - Error cases: expired token (404), already-used token (404).
- `POST /api/v1/auth/accept-invite/`
  - No auth required (unauthenticated endpoint for existing users).
  - Flow C: existing user accepts an invite to join a different organization.
  - Body: `token`, `password` (confirmation to prevent forced org-switch attacks).
  - Success response: same shape as login (token, user, organization, capabilities).
  - Safety: password confirmation prevents malicious invite-link org-switching.
- Auth bootstrap audit behavior:
  - if a user has no active org membership, auth self-heal creates an `Organization` and `OrganizationMembership`
  - the bootstrap write appends immutable `OrganizationRecord(event_type=created, capture_source=auth_bootstrap)`
  - the bootstrap write appends immutable `OrganizationMembershipRecord(event_type=created, capture_source=auth_bootstrap)`

## RBAC: Capability-Based Enforcement

All write endpoints are gated by capability checks, not role strings.

- Capability resolution:
  - Primary: `RoleTemplate.capability_flags_json` (via membership's `role_template`).
  - Fallback: system `RoleTemplate` matching `OrganizationMembership.role` slug.
  - Additive: `OrganizationMembership.capability_flags_json` overrides merged on top.
- Enforcement function: `_capability_gate(user, resource, action)` in `views/helpers.py`.
- Error shape for denied action:
  - HTTP `403`
  - `error.code = "forbidden"`
  - `error.fields.capability = ["Required: {resource}.{action}."]`
- Capability surface (resources and actions):
  ```
  quotes:        view, create, edit, approve, send
  change_orders:    view, create, edit, approve, send
  invoices:         view, create, edit, approve, send
  vendor_bills:     view, create, edit, approve, pay
  payments:         view, create, edit, allocate
  projects:         view, create, edit
  customers:        view, create, edit, disable
  cost_codes:       view, create, edit, disable
  vendors:          view, create, edit, disable
  org_identity:     view, edit
  org_presets:      view, edit
  users:            view, invite, edit_role, disable
  accounting_sync:  view, create, retry
  ```

## Auditability and Traceability Standards

- Financially relevant mutations must append immutable capture rows (status events, snapshots, or record models).
- Public-link decisions (`quote`, `change-order`, `invoice`) must write explicit auditable event context.
- Project-level read surfaces must provide traceability from summary metrics to source records.
- Compatibility timeline/index surfaces are read-only and append-only from API perspective.

## API Versioning Rules

- Non-breaking changes can stay in `v1`.
- Breaking changes require `v2` path introduction.

## Endpoint Contracts (Spec)

This section defines endpoint-by-endpoint request/response, validation, and workflow behavior.

## Organization Management (OPS-ORG-01)

- `GET /api/v1/organization/`
  - Auth required
  - Returns:
    - `organization` profile/settings
    - `current_membership`
    - `active_member_count`
    - `role_policy`

- `PATCH /api/v1/organization/`
  - Auth required
  - Capability gate: field-level split
    - **Identity fields** (`display_name`, `logo_url`, `billing_address`): requires `org_identity.edit` (owner only).
    - **Preset fields** (`help_email`, `default_invoice_due_delta`, `default_quote_valid_delta`, `invoice_terms_and_conditions`, `quote_terms_and_conditions`, `change_order_terms_and_conditions`): requires `org_presets.edit` (owner + PM).
  - Audit behavior:
    - appends immutable `OrganizationRecord(event_type=updated, capture_source=manual_ui)`

- `GET /api/v1/organization/memberships/`
  - Auth required
  - Returns organization-scoped membership list plus `role_policy`.

- `PATCH /api/v1/organization/memberships/{membership_id}/`
  - Auth required
  - Capability gate: `users.edit_role`
  - Supports updating:
    - `role`
    - `status`
  - Safety guards:
    - self-disable blocked
    - self-owner-downgrade blocked
    - last-active-owner removal blocked
  - Audit behavior:
    - appends immutable `OrganizationMembershipRecord` for role/status changes.

- `GET /api/v1/organization/invites/`
  - Auth required
  - Capability gate: `users.invite`
  - Returns pending (unexpired, unused) invites for the current organization.

- `POST /api/v1/organization/invites/`
  - Auth required
  - Capability gate: `users.invite`
  - Body: `email`, `role`
  - Creates a single-use invite token with 24-hour expiry.
  - Duplicate guard: rejects if a pending invite already exists for the same email in the same org.

- `DELETE /api/v1/organization/invites/{invite_id}/`
  - Auth required
  - Capability gate: `users.invite`
  - Revokes a pending invite.

## Customer Intake (INT-01)

- `POST /api/v1/customers/quick-add/`
  - Auth required: `Authorization: Token TOKEN_VALUE`
  - Note: quick-add captures immutable intake records; no mutable pre-customer model is persisted.
  - Required fields:
    - `full_name`
    - `phone`
    - `project_address`
  - Optional fields:
    - `email`
    - `notes`
    - `source` (`field_manual`, `office_manual`, `import`, `web_form`, `referral`, `other`)
  - Success response includes:
    - `data.customer_intake` (intake payload keyed by immutable intake-record id)
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
  - `data.allowed_resolutions = ["use_existing"]`

Resolution fields accepted by `POST /api/v1/customers/quick-add/`:

- `duplicate_resolution`:
  - `use_existing`: return selected existing customer without creating a new one
- `duplicate_target_id`:
  - required for `use_existing`

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
  - Archive side effect:
    - if `is_archived` transitions `false -> true`, all customer `prospect` projects are transitioned to `cancelled` in the same transaction.

- `DELETE /api/v1/customers/{customer_id}/`
  - Auth required
  - Intentionally unsupported (`405 Method Not Allowed`).
  - Policy: customers are archived/unarchived via `PATCH is_archived`; hard-delete is not exposed.

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
  - Capability gate: `cost_codes.create`
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

## Quote Authoring and Versioning (EST-02)

- `GET /api/v1/projects/{project_id}/quotes/`
  - Auth required
  - Returns quote versions for the selected project.

- `POST /api/v1/projects/{project_id}/quotes/`
  - Auth required
  - Creates a new quote version with:
    - `title`
    - `tax_percent`
    - `line_items[]` (cost code, description, quantity, unit, unit_cost, markup_percent)
  - Server computes line totals and quote totals.

- `GET /api/v1/quotes/{quote_id}/`
  - Auth required
  - Returns one quote with line items.

- `GET /api/v1/public/quotes/{public_token}/`
  - No auth required
  - Returns public quote view payload for controlled external sharing.

- `PATCH /api/v1/quotes/{quote_id}/`
  - Auth required
  - Supports updating quote status/title/tax and replacing line items.
  - Note: `archived` is system-controlled and cannot be set directly by API consumers.

- `POST /api/v1/quotes/{quote_id}/clone-version/`
  - Auth required
  - Creates a new draft version cloned from the selected quote.

## Quote Approval Lifecycle (EST-03)

- `PATCH /api/v1/quotes/{quote_id}/`
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
    - `draft|sent -> archived` is used for superseded quote-family history and is not user-settable.

- `GET /api/v1/quotes/{quote_id}/status-events/`
  - Auth required
  - Returns audit trail entries for quote status changes, including actor, timestamp, and note.

## Change Order Lifecycle (CO-01)

Current product posture:
- Change orders support both internal authoring/revision workflows and public customer review/decision flows.

- `GET /api/v1/projects/{project_id}/change-orders/`
  - Auth required
  - Returns change-order revisions for the selected project, scoped to current user.
  - Family semantics:
    - `family_key` = family/thread key
    - `revision_number` = revision inside family
    - `is_latest_revision` marks editable/latest record
  - Traceability fields:
    - `origin_quote` (nullable)
    - `previous_change_order` (nullable explicit pointer to prior revision)

- `POST /api/v1/projects/{project_id}/change-orders/`
  - Auth required
  - Creates a new change order in `draft` with:
    - `title` (required)
    - `amount_delta` (required)
    - `days_delta` (optional, default `0`)
    - `reason` (optional)
    - `origin_quote` (optional; quote id from same project)
    - `line_items[]` (optional scaffold):
      - `description` (optional)
      - `amount_delta` (required)
      - `days_delta` (optional)
  - Validation:
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
    - copies title/amount/days/reason/origin-quote and line items

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
    - `draft -> sent | void`
    - `sent -> approved | rejected | void`
    - `approved -> (terminal)`
    - `rejected -> void`
    - `void -> (terminal)`
  - Important:
    - direct `draft -> approved` is invalid; CO must move through `sent` first.
  - Approval behavior:
    - transition to `approved` sets `approved_by` and `approved_at`.
  - Line-item consistency:
    - if `line_items` are supplied, they fully replace existing rows and must sum to `amount_delta`.
    - if existing line items are present, changing only `amount_delta` is blocked unless line totals stay equal.

- `GET /api/v1/public/change-orders/{public_token}/`
  - No auth required
  - Returns public change-order view payload for controlled external sharing.

- `POST /api/v1/public/change-orders/{public_token}/decision/`
  - No auth required
  - Applies customer decision while status is `sent`.
  - Decisions:
    - `approve` (`approved` alias accepted) -> `approved`
    - `reject` (`rejected` alias accepted) -> `rejected`
  - Decision metadata:
    - optional `decider_name`
    - optional `decider_email`
    - optional `note`
  - Error semantics:
    - `400` for invalid decision payloads
    - `409` when change order is not awaiting customer approval

## Change Order Financial Propagation (CO-02)

CO-02 extends existing CO endpoints with propagation behavior.

- `PATCH /api/v1/change-orders/{change_order_id}/`
  - When change order moves to `approved`:
    - increments `Project.contract_value_current` by CO `amount_delta`
  - When an approved change order moves out of `approved` (for example `approved -> void`):
    - reverses the same amount from project contract value
  - If `amount_delta` is edited while CO is already `approved`:
    - applies only the delta difference to project contract value

- Billable amount basis in current v1:
  - billable basis is derived from `Project.contract_value_current`.

## Change Order Decision Snapshots (CO-03)

- Immutable decision snapshots are captured for financially relevant decision outcomes.
- Triggered on `PATCH /api/v1/change-orders/{change_order_id}/` when status transitions to:
  - `approved`
  - `rejected`
  - `void`
- Not captured for non-decision/internal workflow states:
  - `draft`
  - `sent`
- Snapshot payload stores point-in-time:
  - change-order header data
  - linked line-item rows
  - actor/timestamp metadata
  - decision context (`previous_status`, `applied_financial_delta`)
  - `origin_quote_version` for historical replay/traceability (not primary operational usage)

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
    - quotes
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
    - `due_date` (optional; defaults to `issue_date + organization.default_invoice_due_delta`)
    - `sender_name` (optional; defaults to org invoice sender name/display name)
    - `sender_address` (optional; defaults to org invoice sender address)
    - `sender_logo_url` (optional; defaults to org logo URL)
    - `terms_text` (optional; defaults to org invoice terms template)
    - `footer_text` (optional; defaults to org invoice footer template)
    - `notes_text` (optional; defaults to org invoice notes template)
    - `tax_percent` (optional; default `0`)
    - `line_items[]` (required)
      - `line_type` (optional; `scope` or `adjustment`, default `scope`)
      - `cost_code` (optional)
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
    - `sender_name`
    - `sender_address`
    - `sender_logo_url`
    - `terms_text`
    - `footer_text`
    - `notes_text`
    - `tax_percent`
    - `line_items` (replaces existing lines)
      - accepts same line schema as create (`line_type`, adjustment metadata)
  - Allowed transitions:
    - `draft -> sent | void`
    - `sent -> closed | void`
    - `outstanding -> closed`
    - `closed -> (no further transitions)`
    - `void -> (no further transitions)`
  - Totals behavior:
    - recalculates totals when line items or tax percent changes
    - sets `balance_due = 0` when status is `closed`

- `POST /api/v1/invoices/{invoice_id}/send/`
  - Auth required
  - Convenience action to set status to `sent` from an allowed prior state.

### Invoice Lineage Decision

- Invoice lines are billing-time composition rows and may regroup/split partial scope across invoice cycles.
- Non-quote billing is allowed only as explicit `adjustment` lines with required reason metadata.
- External/public invoice views should hide internal-only metadata fields (for example `internal_note`).

## Unapproved Scope Billing Protection (INV-02)

> **Status: Not yet implemented.** This section documents planned design intent.
> The `_enforce_invoice_scope_guard()` function, `InvoiceScopeOverrideEvent` model,
> and override payload fields do not exist in the codebase yet.

INV-02 extends invoice billing actions with a scope guard based on approved project billable amount.

- Billable scope basis
  - `Project.contract_value_current` is treated as approved billable scope.
  - Billable committed total is computed from project invoices in statuses:
    - `sent`
    - `outstanding`
    - `closed`
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
  - Duplicate detection:
    - checks for exact name match (case-insensitive) within active organization scope
    - if a duplicate is found, returns `409` with `error.code = "duplicate_detected"` and `data.duplicate_candidates[]`
    - no override path — user must differentiate the name (e.g. add a location qualifier)

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
  - Duplicate detection:
    - same name duplicate check as create (excluding current vendor)
    - no override path — returns `409` if name matches an existing vendor

- `POST /api/v1/vendors/import-csv/`
  - Auth required
  - Capability gate: `vendors.create`
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
  - Duplicate detection:
    - checks duplicates by `vendor + bill_number` (case-insensitive bill number) within current org scope
    - non-void duplicates return `409` with `error.code = "duplicate_detected"` and `data.duplicate_candidates[]`
    - no override path — void the existing bill first, then re-create

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
  - Duplicate detection:
    - same `vendor + bill_number` check as create (excluding current bill)
    - no override path — returns `409` if a non-void duplicate exists

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

## Project Timeline / Activity Center (QA-02)

- `GET /api/v1/projects/{project_id}/timeline/`
  - Auth required
  - Returns a read-only project timeline merged from:
    - workflow quote status events (`QuoteStatusEvent`)
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
