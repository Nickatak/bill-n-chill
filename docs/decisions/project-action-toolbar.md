# Project Action Toolbar

**Decided:** 2026-03-21
**Status:** Active
**Related:** [payment-allocation-rules.md](payment-allocation-rules.md), [accounting-page-redesign.md](accounting-page-redesign.md)

## Context

The project overview page has a pipeline (Estimates → COs → Invoices → Bills)
and a right panel with tabbed quick-entry forms (customer payment, expense
receipt). These work, but they're isolated from each other. The pipeline shows
state; the forms let you act — but there's no connection between "where is this
project?" and "what should I do next?"

Additionally, the payment allocation rules now require every payment to target a
document. This means actions like "record a deposit" require an invoice to exist
first. Without a clear path from estimate approval to deposit invoice creation,
users hit a friction wall.

More broadly, construction billing involves cross-domain actions that don't
belong to any single feature module: invoicing from an approved estimate,
creating an invoice that incorporates change orders, recording a payment against
an invoice, logging a receipt against a bill. These are inter-model actions
scoped to a single project — and the project overview is the natural home for
them.

## Decisions

### 1. Add a persistent action toolbar to the project overview

A horizontal toolbar below the pipeline, ordered left-to-right to match the
workflow stages above it: estimate actions → CO actions → invoice actions →
payment/receipt actions.

The toolbar is **always visible**. Actions are enabled or disabled based on
project state (e.g., "Invoice Deposit" is enabled when an approved estimate
exists). The user always sees the full set of possible actions — the state
determines which are available, not which are shown.

### 2. The toolbar controls the right panel

The current QuickEntryTabs component (tabbed payment/receipt forms) is replaced.
The toolbar owns what the right panel displays:

- **Quick actions** (record payment, log receipt) → clicking the toolbar button
  swaps the right panel to the corresponding inline form.
- **Launch actions** (create invoice from estimate, invoice deposit) → clicking
  navigates to the dedicated workflow (e.g., invoice creator pre-filled from
  estimate data).

One form visible at a time, driven by toolbar selection. The right panel is a
render target, not a self-contained component with its own navigation.

### 3. Toolbar ordering mirrors the pipeline

Left to right, the toolbar follows workflow order:

1. **Estimate stage:** Invoice Deposit (creates deposit invoice from approved estimate)
2. **Invoice stage:** Invoice from Estimate + COs (creates invoice pre-filled from current contract state)
3. **Payment stage:** Record Customer Payment (inline form in right panel)
4. **Expense stage:** Log Expense Receipt (inline form in right panel)

This ordering is self-documenting — a new user reads the toolbar left to right
and learns the construction billing workflow.

The action set grows incrementally as features are added. New actions slot into
the appropriate workflow position.

### 4. Enable/disable logic derived from existing data

The pipeline already fetches document counts and statuses per stage. The toolbar
reads the same data to determine action availability:

- **Invoice Deposit:** enabled when an approved estimate exists and no deposit invoice has been created
- **Invoice from Estimate + COs:** enabled when an approved estimate exists
- **Record Customer Payment:** enabled when sent/partially-paid invoices exist
- **Log Expense Receipt:** always enabled (receipts don't require a pre-existing document)

No new API calls required — all state is already available on the project
overview.

## What this replaces

- `QuickEntryTabs` component loses its own tab bar. The tabs become toolbar
  buttons instead. The forms themselves stay largely the same — they just render
  in the right panel when selected from the toolbar rather than from a local
  tab switcher.

## Scope

- **Project overview only.** This toolbar is scoped to a single project's
  cross-domain actions. It does not extend to the accounting page or other
  org-wide views.
- **MVP action set** is the four actions listed above. Future additions (e.g.,
  create change order from estimate, generate lien waiver) slot into the
  existing toolbar pattern.

## Rationale

- Solves the deposit invoice friction: the path from approved estimate to
  deposit invoice is one click, visible in the toolbar.
- Unifies the "what can I do?" surface into one place instead of splitting it
  across a pipeline, a tab bar, and implicit knowledge.
- The toolbar teaches the workflow through its ordering.
- Scales naturally — adding an action is adding a button, not redesigning the
  layout.
- Keeps quick actions inline (fast, stay on page) and launch actions navigating
  (appropriate for heavier workflows). Users intuit the difference because it
  maps to task weight.
