# Decision Record: Invoice Lineage and Adjustment Policy

Date: 2026-02-23
Status: Accepted (transitional strictness)

## Decision

- Keep exactly one canonical `InvoiceLine` set per invoice.
- Allow each invoice line to optionally reference a `CostCode` for categorization.
- Do not require invoice lines to reference `EstimateLineItem`.
- Allow non-scope billing only through explicit `adjustment` lines with required reason metadata.

## Context

- We need invoice flexibility for real-world billing operations, including non-estimate charges.
- We also need strict financial traceability and auditability over time.

## Rationale

1. `EstimateLineItem` rows are context rows, not canonical identity.
2. Invoices are billing-time artifacts that may regroup/split/partially bill prior scope.
3. Directly anchoring invoice lines to mutable estimate rows would over-couple invoice workflows.
4. Cost codes provide categorization and traceability without rigid line-level coupling.
5. Adjustment lines preserve operational flexibility while keeping exception billing explicit and auditable.

## Implications

- Client/internal parity:
  - One canonical line set drives both client-facing and internal-facing invoice views.
  - Internal-only metadata (`cost_code`, `line_type`, `adjustment_reason`, `internal_note`) is hidden in external/public rendering.
- Traceability:
  - Lines can be categorized via cost codes across estimate and invoice artifacts.
  - Non-scope billed amounts are explicit `adjustment` lines, not silent free-text exceptions.
- Guardrails:
  - `adjustment` lines require `adjustment_reason`.
  - Scope over-billing protection (`INV-02`) remains in effect for billable transitions/total changes.
- Product posture:
  - This is strictness-ready but transition-friendly.
  - Future tightening can require `cost_code` on all `scope` lines once migration/onboarding supports it.

## Non-Goals (Current Revision)

- No dual "client lines vs internal lines" editable source-of-truth split.
- No full invoice immutable lifecycle capture model yet.
