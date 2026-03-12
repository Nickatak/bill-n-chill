# bill-n-chill MVP v1

Last reviewed: 2026-02-28

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

bill-n-chill is the operational and financial thread that keeps project scope changes and billing outcomes in sync.

## Scope Boundary (v1)

- bill-n-chill starts after initial sales conversation and high-level project intent.
- bill-n-chill owns project execution records and the financial lifecycle.
- bill-n-chill includes a light customer-intake path so field teams can quickly create the customer record needed to start a project.

## In Scope (v1)

1. Light customer intake and handoff
- Quick Add Customer (mobile-first): name, phone, project address, optional email/notes.
- Duplicate checks by phone/email.
- One-step create/reuse customer + optional project shell.

2. Project and contract setup
- Create project, customer, contract value, and baseline start/end dates.

3. Estimating
- Define line items with cost codes and markup.
- Approve estimates to establish project contract baseline.

4. Change order workflow
- Draft, approve/reject, and apply change orders.
- Auto-adjust contract value after approval.

5. Customer invoicing
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

## Post-MVP Priority: External Approval Assurance

Goal: strengthen legal enforceability and signer verification for estimate/change-order approvals shared by public link.

1. Agreement layer (e-sign)
- Capture explicit signer assent against a specific document version/hash.
- Store reproducible signed-record artifacts and consent metadata.
- Preserve immutable audit trail (timestamp, signer identity inputs, IP/user agent, document hash/version).

2. Verification layer (shared-secret)
- Require a second factor in addition to the approval link: a one-time PSK delivered out-of-band.
- Validate `link token + PSK` before allowing approve/reject actions.
- Use short-lived, single-use approval tokens with attempt/rate limits and replay protection.

3. Notes
- This is intentionally deferred until after MVP.
- TOTP enrollment is optional future exploration; baseline post-MVP plan is e-sign ceremony + PSK.

## UX Principles for v1

- Money state must be explainable in one screen per project.
- Home route (`/`) should be auth-gated and act as both splash/login and dashboard entry.
- Every financial number should trace back to source records.
- Change orders must be impossible to miss in downstream billing.
- Simple defaults first; advanced controls behind explicit toggles.
- Both dark mode and light mode are implemented, with a theme toggle. Dark mode provides high-contrast, outdoor-legible tokens; light mode is the default for public-facing pages.

## Mobile and Desktop Strategy (v1) — Superseded

Original strategy moved to `mobile-desktop-strategy-v1.md` (decision log). Superseded by `product-direction-refinement.md` — all flows now target mobile, not just quick lookups.

Theme requirements (unchanged):
- Both dark and light modes are implemented with a user-facing theme toggle.
- Dark mode provides high-contrast tokens tuned for outdoor/construction-site legibility.
- Light mode is forced on public-facing pages; internal pages respect the user's toggle.
- *(Original plan was dark-mode-only for MVP; light mode shipped ahead of schedule.)*

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

1. Estimate approval
- Approving an estimate establishes the project contract baseline.

2. CO propagation
- Approved change order updates project contract value and financial summary automatically.

3. Invoice lifecycle
- Invoice supports draft, sent, partial, paid, void states with audit trail.

4. Payment application
- A payment can be split across multiple invoices/bills and remaining balances update correctly.

5. Reporting consistency
- Project financial summary matches underlying transactional records with no manual adjustments.

## Delivery Phases

Phase 1: Financial Backbone
- Projects, customers, estimates, change orders, invoices.

Phase 2: AP + Payment Operations
- Vendor bills, payment records, reconciliation views.

Phase 3: Integrations + Stabilization
- QuickBooks sync/export, permission hardening, audit polish, production readiness.

## Immediate Build Order (Engineering)

1. Data model and API contracts for core entities.
2. Project financial summary endpoint and UI.
3. Estimate approval + contract baseline flow.
4. Change order approval + contract value impact logic.
5. Invoice and payment workflows.
6. Accounting export/sync adapter.

## Risks and Mitigations

1. Risk: domain misunderstandings in billing edge cases.
- Mitigation: build explicit state machines + sample project fixtures early.

2. Risk: scope creep into enterprise PM features.
- Mitigation: keep backlog tagged as `core-money-loop` vs `later`.

3. Risk: integration drag.
- Mitigation: isolate accounting adapter interface and ship CSV/manual bridge first if needed.
