# Buildr MVP v1

## Goal

Ship a usable construction financial workflow core for a small GC team with clear, auditable money movement from estimate to payment.

## Primary User Profile (Initial ICP)

- Company type: small-to-mid residential GC/remodeler.
- Team shape: owner/operator + project manager + office/bookkeeping.
- Current pain: disconnected estimating, change orders, invoicing, and payment status.

Why this ICP first:
- Faster product cycle.
- Lower enterprise-governance complexity than large commercial orgs.
- Direct overlap with Buildertrend + Beam-style value.

## Problem Statement

Teams lose margin and time when scope, cost, and billing changes are tracked in disconnected tools or spreadsheets.

## v1 Product Promise

Buildr is the operational and financial thread that keeps project scope changes and billing outcomes in sync.

## Scope Boundary (v1)

- Buildr starts after initial sales conversation and high-level project intent.
- Buildr owns project execution records and the financial lifecycle.
- Buildr includes a light contact-intake path so field teams can quickly create the customer record needed to start a project.

## In Scope (v1)

1. Light contact intake and handoff
- Quick Add Contact (mobile-first): name, phone, project address, optional email/notes.
- Duplicate checks by phone/email.
- One-step convert from contact to customer + project shell.

2. Project and contract setup
- Create project, customer, contract value, and baseline start/end dates.

3. Estimate to budget handoff
- Define line items with cost codes and markup.
- Convert approved estimate to project budget/SOV baseline.

4. Change order workflow
- Draft, approve/reject, and apply change orders.
- Auto-adjust budget and billing availability after approval.

5. Owner/client invoicing
- Generate progress or milestone invoices from approved scope.
- Track invoice status: draft, sent, partially paid, paid, overdue.

6. Vendor/sub bill intake (light AP)
- Record bills against cost codes and project.
- Track due date and payment status.

7. Payment tracking
- Record incoming and outgoing payments.
- Apply payments to invoices/bills with partial-payment support.

8. Accounting export/sync foundation
- Start with QuickBooks Online integration path.
- At minimum, provide exportable, clean financial records if live sync is not in v1.

9. Basic reporting
- Project-level summary:
  - Original contract
  - Approved changes
  - Invoiced to date
  - Paid to date
  - Outstanding receivables/payables

## Out of Scope (v1)

- Full CRM pipeline and marketing attribution automation.
- Full CPM/Gantt advanced scheduler.
- Enterprise document control and advanced RFI/submittal systems.
- Multi-entity accounting and complex ERP suite integrations.
- Deep retainage and AIA edge-case automation beyond core fields.
- Native payroll and workforce management.

## UX Principles for v1

- Money state must be explainable in one screen per project.
- Every financial number should trace back to source records.
- Change orders must be impossible to miss in downstream billing.
- Simple defaults first; advanced controls behind explicit toggles.
- Support both light and dark mode in v1; default to light mode.
- Theme choice should be user-controlled and persisted per user.

## Mobile and Desktop Strategy (v1)

- Product posture: mobile-first for in-field speed, desktop-first for complex editing and review.
- Mobile should optimize short, high-frequency actions (generally under 2 minutes).
- Desktop should optimize dense data workflows (tables, comparisons, multi-step edits).

Primary mobile workflows:
- Quick Add Contact and convert to project shell.
- Field notes, status updates, and quick approvals.
- Fast invoice/bill/payment status checks.

Primary desktop workflows:
- Estimate authoring and revision.
- Budget and cost-code management.
- Invoice composition, financial reconciliation, and reporting.

Theme requirements:
- Light mode is the default experience for broad user familiarity.
- Dark mode must maintain full readability and parity (no reduced feature visibility).

## Core Success Metrics

1. Time to first invoice:
- Target: user can create project and send first invoice within 30 minutes.

2. Billing integrity:
- 100% of approved change orders reflected in eligible invoice totals.

3. Reconciliation speed:
- PM/bookkeeper can identify outstanding AR/AP at project level within 2 minutes.

4. Weekly active usage:
- PMs touch project financial summary at least weekly.

## v1 Functional Acceptance Criteria

1. Estimate conversion
- Converting an estimate creates immutable baseline snapshot and editable working budget.

2. CO propagation
- Approved change order updates project financial summary and invoice availability automatically.

3. Invoice lifecycle
- Invoice supports draft, sent, partial, paid, void states with audit trail.

4. Payment application
- A payment can be split across multiple invoices/bills and remaining balances update correctly.

5. Reporting consistency
- Project financial summary matches underlying transactional records with no manual adjustments.

## Delivery Phases

Phase 1: Financial Backbone
- Projects, customers, estimates, budgets, change orders, invoices.

Phase 2: AP + Payment Operations
- Vendor bills, payment records, reconciliation views.

Phase 3: Integrations + Stabilization
- QuickBooks sync/export, permission hardening, audit polish, production readiness.

## Immediate Build Order (Engineering)

1. Data model and API contracts for core entities.
2. Project financial summary endpoint and UI.
3. Estimate-to-budget conversion flow.
4. Change order approval + budget impact logic.
5. Invoice and payment workflows.
6. Accounting export/sync adapter.

## Risks and Mitigations

1. Risk: domain misunderstandings in billing edge cases.
- Mitigation: build explicit state machines + sample project fixtures early.

2. Risk: scope creep into enterprise PM features.
- Mitigation: keep backlog tagged as `core-money-loop` vs `later`.

3. Risk: integration drag.
- Mitigation: isolate accounting adapter interface and ship CSV/manual bridge first if needed.
