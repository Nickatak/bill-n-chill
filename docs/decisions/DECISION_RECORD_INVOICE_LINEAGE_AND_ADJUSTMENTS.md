# Decision Record: Invoice Lineage and Adjustment Policy

Date: 2026-02-23
Status: Accepted (transitional strictness)

## Decision

- Keep exactly one canonical `InvoiceLine` set per invoice.
- Allow each invoice line to optionally reference canonical `ScopeItem` directly.
- Do not require invoice lines to reference `EstimateLineItem` or `BudgetLine`.
- Allow non-scope billing only through explicit `adjustment` lines with required reason metadata.

## Context

- We need invoice flexibility for real-world billing operations, including non-estimate charges.
- We also need strict financial traceability and auditability over time.
- We already use `ScopeItem` as canonical cross-artifact identity for "same work".

## Rationale

1. `EstimateLineItem` and `BudgetLine` are context rows, not canonical identity.
2. Invoices are billing-time artifacts that may regroup/split/partially bill prior scope.
3. Directly anchoring invoice lines to mutable estimate/budget rows would over-couple invoice workflows.
4. `ScopeItem` provides stable lineage without duplicating editable line universes.
5. Adjustment lines preserve operational flexibility while keeping exception billing explicit and auditable.

## Implications

- Client/internal parity:
  - One canonical line set drives both client-facing and internal-facing invoice views.
  - Internal-only metadata (`scope_item`, `line_type`, `adjustment_reason`, `internal_note`) is hidden in external/public rendering.
- Traceability:
  - Scope-linked lines can be traced via `ScopeItem` across estimate/budget/invoice artifacts.
  - Non-scope billed amounts are explicit `adjustment` lines, not silent free-text exceptions.
- Guardrails:
  - `adjustment` lines require `adjustment_reason`.
  - Scope over-billing protection (`INV-02`) remains in effect for billable transitions/total changes.
- Product posture:
  - This is strictness-ready but transition-friendly.
  - Future tightening can require `scope_item` on all `scope` lines once migration/onboarding supports it.

## Non-Goals (Current Revision)

- No mandatory invoice-to-budget-line FK for all invoice rows.
- No dual "client lines vs internal lines" editable source-of-truth split.
- No full invoice immutable lifecycle capture model yet (still pending in financial-audit deprecation plan).
