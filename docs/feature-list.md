# bill-n-chill Feature List (Execution Backlog)

## Purpose

Distill current discovery into a complete, ordered feature list that can be implemented one by one.

## Progress Snapshot

- Current Feature: `Complete`
- Completed Features: `28/28`
- Update rule: whenever you mark a feature `- Status: [x] Complete`, advance `Current Feature` to the next unchecked feature ID.

## How to Use

- Treat each feature ID as one implementation unit.
- Complete in order unless dependencies are explicitly satisfied.
- Do not start a feature until its acceptance checks are testable.
- Use each feature's `Status` checkbox to track completion.
- Mark `- Status: [x] Complete` only when acceptance checks pass and implemented URLs are up to date.
- Add and maintain `URLs` under each feature:
  - `implemented`: currently live route/endpoint
  - `planned`: reserved for future implementation

## Scope Guardrails

- In scope: post-contact project execution and financial lifecycle.
- In scope: light intake to create contacts/customers/projects quickly.
- Out of scope for v1: full CRM automation, advanced CPM scheduling, enterprise governance suite.

## Phase 0: Foundation

### FND-01: Monorepo scaffolding
- Status: [x] Complete
- Outcome: `backend/` Django+DRF app and `frontend/` Next.js app exist and run locally.
- Depends on: none.
- URLs:
  - implemented: `GET /api/v1/health/`
  - implemented: `http://localhost:3000/`
- Acceptance checks:
  - Backend serves a health endpoint.
  - Frontend can call backend health endpoint.

### FND-02: Auth and user session baseline
- Status: [x] Complete
- Outcome: authenticated app access pattern is established.
- Depends on: `FND-01`.
- URLs:
  - implemented: `POST /api/v1/auth/login/`
  - implemented: `GET /api/v1/auth/me/`
- Acceptance checks:
  - Protected endpoints reject unauthenticated access.
  - Frontend supports authenticated API requests.

### FND-03: Company/tenant context
- Status: [x] Complete
- Outcome: all core records are scoped by company.
- Depends on: `FND-02`.
- Acceptance checks:
  - Records are isolated by company.
  - Cross-company access is blocked.

## Phase 1: Intake and Project Setup

### INT-01: Quick Add Contact (mobile-first)
- Status: [x] Complete
- Outcome: PM can create a lead contact in under 2 minutes.
- Depends on: `FND-03`.
- URLs:
  - implemented: `POST /api/v1/lead-contacts/quick-add/`
  - implemented: `http://localhost:3000/intake/quick-add`
- Acceptance checks:
  - Required fields: name, phone, project address.
  - Optional fields: email, notes, source.

### INT-02: Duplicate detection and resolution
- Status: [x] Complete
- Outcome: system warns on likely duplicate lead/customer.
- Depends on: `INT-01`.
- URLs:
  - implemented: `POST /api/v1/lead-contacts/quick-add/` (duplicate contract + resolution options)
  - implemented: `http://localhost:3000/intake/quick-add` (resolution UI)
- Acceptance checks:
  - Duplicate signal on matching phone/email.
  - User can merge, attach, or override.

### INT-03: Convert lead to customer + project shell
- Status: [x] Complete
- Outcome: one-step handoff from lead intake to active project setup.
- Depends on: `INT-01`.
- URLs:
  - implemented: `POST /api/v1/lead-contacts/{lead_id}/convert-to-project/`
  - implemented: `http://localhost:3000/intake/quick-add` (convert section)
- Acceptance checks:
  - Conversion creates `Customer` and `Project`.
  - Conversion trail preserved on lead record.

### PRJ-01: Project profile and contract baseline
- Status: [x] Complete
- Outcome: project holds contract value and baseline dates.
- Depends on: `INT-03`.
- URLs:
  - implemented: `GET /api/v1/projects/`
  - implemented: `GET /api/v1/projects/{project_id}/`
  - implemented: `PATCH /api/v1/projects/{project_id}/`
  - implemented: `http://localhost:3000/projects`
- Acceptance checks:
  - Project status lifecycle works (`prospect`, `active`, etc.).
  - Contract original/current values are stored and auditable.

## Phase 2: Estimating and Budget Baseline

### EST-01: Cost code management
- Status: [x] Complete
- Outcome: reusable cost code catalog exists per company.
- Depends on: `FND-03`.
- URLs:
  - implemented: `GET /api/v1/cost-codes/`
  - implemented: `POST /api/v1/cost-codes/`
  - implemented: `PATCH /api/v1/cost-codes/{cost_code_id}/`
  - implemented: `http://localhost:3000/cost-codes`
- Acceptance checks:
  - Create/update/deactivate cost codes.
  - Cost codes usable in estimate/budget/invoice/bills.

### EST-02: Estimate authoring and versioning (desktop-first)
- Status: [x] Complete
- Outcome: PM can build and revise detailed estimates.
- Depends on: `PRJ-01`, `EST-01`.
- URLs:
  - implemented: `GET /api/v1/projects/{project_id}/estimates/`
  - implemented: `POST /api/v1/projects/{project_id}/estimates/`
  - implemented: `GET /api/v1/estimates/{estimate_id}/`
  - implemented: `PATCH /api/v1/estimates/{estimate_id}/`
  - implemented: `POST /api/v1/estimates/{estimate_id}/clone-version/`
  - implemented: `http://localhost:3000/estimates`
- Acceptance checks:
  - Estimate line items with quantity/unit/cost/markup.
  - Versioning preserves history.

### EST-03: Estimate approval lifecycle
- Status: [x] Complete
- Outcome: estimate moves through draft/sent/approved/rejected.
- Depends on: `EST-02`.
- URLs:
  - implemented: `PATCH /api/v1/estimates/{estimate_id}/` (status transition + `status_note`)
  - implemented: `GET /api/v1/estimates/{estimate_id}/status-events/`
  - implemented: `http://localhost:3000/estimates`
- Acceptance checks:
  - State transitions validated.
  - Audit trail on approval/rejection.

### BGT-01: Convert approved estimate to budget
- Status: [x] Complete
- Outcome: approved estimate becomes budget baseline.
- Depends on: `EST-03`.
- URLs:
  - implemented: `POST /api/v1/estimates/{estimate_id}/convert-to-budget/`
  - implemented: `GET /api/v1/projects/{project_id}/budgets/`
  - implemented: `PATCH /api/v1/budgets/{budget_id}/lines/{line_id}/`
  - implemented: `http://localhost:3000/budgets`
- Acceptance checks:
  - Conversion blocked if estimate is not approved.
  - Immutable baseline snapshot retained.
  - Editable working budget created.

## Phase 3: Change Management and Billing

### CO-01: Change order creation and lifecycle
- Status: [x] Complete
- Outcome: PM can draft and route change orders.
- Depends on: `BGT-01`.
- URLs:
  - implemented: `GET /api/v1/projects/{project_id}/change-orders/`
  - implemented: `POST /api/v1/projects/{project_id}/change-orders/`
  - implemented: `GET /api/v1/change-orders/{change_order_id}/`
  - implemented: `PATCH /api/v1/change-orders/{change_order_id}/`
  - implemented: `http://localhost:3000/change-orders`
- Acceptance checks:
  - States: draft, pending approval, approved, rejected, void.
  - Rejected/void changes do not impact totals.

### CO-02: Change order financial propagation
- Status: [x] Complete
- Outcome: approved CO updates project contract/budget/billable amounts.
- Depends on: `CO-01`.
- URLs:
  - implemented: `PATCH /api/v1/change-orders/{change_order_id}/` (financial propagation on approval/void/amount edits)
  - implemented: `GET /api/v1/projects/{project_id}/` (contract current visibility)
  - implemented: `GET /api/v1/projects/{project_id}/budgets/` (budget CO aggregate visibility)
  - implemented: `http://localhost:3000/change-orders`
- Acceptance checks:
  - Contract current reflects approved deltas.
  - Budget totals reflect approved deltas (aggregate).
  - Billable basis updates via project contract current.
  - Invoice composition now consumes project contract current as billable-scope basis (`INV-01` and `INV-02`).
- Deferred implementation note:
  - CO headers currently capture aggregate delta only.
  - Add explicit line-level coupling (`ChangeOrderLine`) to budget structure (`BudgetLine` or `CostCode`) so approved CO scope deltas propagate to budget deterministically without exposing internal budget details to client-facing workflows.

### INV-01: Invoice composition and send
- Status: [x] Complete
- Outcome: bookkeeper/PM can generate and send owner invoices.
- Depends on: `CO-02`.
- URLs:
  - implemented: `GET /api/v1/projects/{project_id}/invoices/`
  - implemented: `POST /api/v1/projects/{project_id}/invoices/`
  - implemented: `GET /api/v1/invoices/{invoice_id}/`
  - implemented: `PATCH /api/v1/invoices/{invoice_id}/`
  - implemented: `POST /api/v1/invoices/{invoice_id}/send/`
  - implemented: `http://localhost:3000/invoices`
- Acceptance checks:
  - Invoice line creation and total calculation.
  - State transitions: draft, sent, partially_paid, paid, overdue, void.

### INV-02: Unapproved scope billing protection
- Status: [x] Complete
- Outcome: billing from unapproved scope is blocked or explicitly overridden.
- Depends on: `INV-01`.
- URLs:
  - implemented: `PATCH /api/v1/invoices/{invoice_id}/` (scope guard on billable-status updates and total edits)
  - implemented: `POST /api/v1/invoices/{invoice_id}/send/` (scope guard + optional override audit note)
  - implemented: `http://localhost:3000/invoices`
- Acceptance checks:
  - Validation catches unapproved change items.
  - Override path (if enabled) creates an audit note.

## Phase 4: AP and Payments

### VEN-01: Vendor directory
- Status: [x] Complete
- Outcome: vendor records are reusable for commitments and bills.
- Depends on: `FND-03`.
- URLs:
  - implemented: `GET /api/v1/vendors/` (list + `q` search)
  - implemented: `POST /api/v1/vendors/`
  - implemented: `GET /api/v1/vendors/{vendor_id}/`
  - implemented: `PATCH /api/v1/vendors/{vendor_id}/`
  - implemented: `http://localhost:3000/vendors`
- Acceptance checks:
  - Vendor create/update/search.
  - Duplicate vendor warnings by name/email.

### AP-01: Vendor bill intake and lifecycle
- Status: [x] Complete
- Outcome: AP bills are tracked by project and status.
- Depends on: `VEN-01`, `BGT-01`.
- URLs:
  - implemented: `GET /api/v1/projects/{project_id}/vendor-bills/`
  - implemented: `POST /api/v1/projects/{project_id}/vendor-bills/`
  - implemented: `GET /api/v1/vendor-bills/{vendor_bill_id}/`
  - implemented: `PATCH /api/v1/vendor-bills/{vendor_bill_id}/`
  - implemented: `http://localhost:3000/vendor-bills`
- Acceptance checks:
  - States: draft, received, approved, scheduled, paid, void.
  - Duplicate warning by vendor + bill number.

### PAY-01: Payment recording (inbound/outbound)
- Status: [x] Complete
- Outcome: money movement is tracked consistently.
- Depends on: `INV-01`, `AP-01`.
- URLs:
  - implemented: `GET /api/v1/projects/{project_id}/payments/`
  - implemented: `POST /api/v1/projects/{project_id}/payments/`
  - implemented: `GET /api/v1/payments/{payment_id}/`
  - implemented: `PATCH /api/v1/payments/{payment_id}/`
  - implemented: `http://localhost:3000/payments`
- Acceptance checks:
  - Direction, method, status, reference captured.
  - Settled/failed/void states supported.

### PAY-02: Payment allocation engine
- Status: [x] Complete
- Outcome: one payment can be applied across multiple invoices/bills.
- Depends on: `PAY-01`.
- URLs:
  - implemented: `POST /api/v1/payments/{payment_id}/allocate/`
  - implemented: `http://localhost:3000/payments` (allocation section)
- Acceptance checks:
  - Partial allocations work.
  - Outstanding balances update correctly.
  - Overpayment handled as unapplied credit or explicit remainder flow.

## Phase 5: Financial Visibility and Accounting

### FIN-01: Project financial summary
- Status: [x] Complete
- Outcome: one-screen financial state for PM/bookkeeper.
- Depends on: `CO-02`, `PAY-02`.
- URLs:
  - implemented: `GET /api/v1/projects/{project_id}/financial-summary/`
  - implemented: `http://localhost:3000/projects` (financial summary section)
- Acceptance checks:
  - Contract original/current
  - Approved CO totals
  - Invoiced/paid/AR outstanding
  - AP total/paid/outstanding

### FIN-02: Drill-down traceability
- Status: [x] Complete
- Outcome: every summary number links to source records.
- Depends on: `FIN-01`.
- URLs:
  - implemented: `GET /api/v1/projects/{project_id}/financial-summary/` (`traceability` section)
  - implemented: `http://localhost:3000/projects` (traceability links + source records)
- Acceptance checks:
  - Click-through from summary metrics to transactions.
  - No orphaned totals without source links.

### ACC-01: Accounting export bridge
- Status: [x] Complete
- Outcome: reliable export for accounting reconciliation.
- Depends on: `FIN-01`.
- URLs:
  - implemented: `GET /api/v1/projects/{project_id}/accounting-export/?export_format=csv`
  - implemented: `GET /api/v1/projects/{project_id}/accounting-export/?export_format=json`
  - implemented: `http://localhost:3000/projects` (download export button)
- Acceptance checks:
  - Export format is consistent and documented.
  - Exported totals match in-app totals.

### ACC-02: QuickBooks sync foundation
- Status: [x] Complete
- Outcome: sync events track push/pull status and failures.
- Depends on: `ACC-01`.
- URLs:
  - implemented: `GET /api/v1/projects/{project_id}/accounting-sync-events/`
  - implemented: `POST /api/v1/projects/{project_id}/accounting-sync-events/`
  - implemented: `POST /api/v1/accounting-sync-events/{sync_event_id}/retry/`
  - implemented: `http://localhost:3000/projects` (sync log + retry controls)
- Acceptance checks:
  - Sync event log includes status/error details.
  - Failed syncs can be retried safely.

## Phase 6: UX, Quality, and Operational Readiness

### UX-01: Mobile-first core action UX
- Status: [x] Complete
- Outcome: field-critical actions are fast and usable on mobile.
- Depends on: `INT-01`, `CO-01`, `PAY-01`.
- URLs:
  - implemented: `http://localhost:3000/intake/quick-add`
  - implemented: `http://localhost:3000/change-orders`
  - implemented: `http://localhost:3000/payments`
- Acceptance checks:
  - Core mobile actions complete in under 2 minutes.
  - Touch targets and form flow are field-friendly.

### UX-02: Desktop deep-work UX
- Status: [x] Complete
- Outcome: dense authoring workflows are efficient on desktop.
- Depends on: `EST-02`, `INV-01`, `FIN-01`.
- URLs:
  - implemented: `http://localhost:3000/estimates`
  - implemented: `http://localhost:3000/invoices`
  - implemented: `http://localhost:3000/projects`
- Acceptance checks:
  - Tables/filtering/comparison workflows are practical.
  - Keyboard-friendly editing where useful.

### UX-03: Theme system (light default + dark mode)
- Status: [x] Complete
- Outcome: both themes are first-class with readable contrast.
- Depends on: `FND-01`.
- URLs:
  - implemented: `http://localhost:3000/` (global theme toggle + persisted preference)
  - implemented: all `http://localhost:3000/*` routes respect persisted theme selection
- Acceptance checks:
  - Light mode default.
  - User preference persisted.
  - Feature parity and contrast pass in both themes.

### QA-01: Audit trail coverage
- Status: [x] Complete
- Outcome: money-impacting actions are audit-visible.
- Depends on: `CO-01`, `INV-01`, `PAY-01`, `AP-01`.
- URLs:
  - implemented: `GET /api/v1/projects/{project_id}/audit-events/`
  - implemented: `http://localhost:3000/projects` (audit trail section)
- Acceptance checks:
  - Actor, timestamp, state change captured.
  - Critical transitions are immutable.

### QA-02: Regression test baseline
- Status: [x] Complete
- Outcome: high-risk money workflows are test-protected.
- Depends on: all financial core features.
- URLs:
  - implemented: `backend/core/tests/test_mvp_regression.py`
  - implemented: `backend/core/tests/test_audit_trail.py`
- Acceptance checks:
  - Tests for estimate conversion, CO propagation, invoice/payment balances, AP balances.

## Recommended First Implementation Slice

1. `FND-01`
2. `FND-03`
3. `INT-01`
4. `INT-03`
5. `PRJ-01`
6. `EST-01`
7. `EST-02`
8. `EST-03`
9. `BGT-01`
10. `CO-01`
11. `CO-02`
12. `INV-01`
13. `PAY-01`
14. `PAY-02`
15. `FIN-01`

This slice delivers the core money loop end-to-end before deeper AP/accounting polish.
