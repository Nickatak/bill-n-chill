# Vendor Bill Allocation on Unbudgeted Projects

## Problem

`VendorBillAllocation` hard-references `BudgetLine`. Allocations are optional at bill creation, but **required to sum to the bill total** before a bill can transition to `approved`/`scheduled`/`paid`.

On a project with no budget (i.e. the DIRECT invoice flow), there are no `BudgetLine` records to allocate against. This means:

- **Creating a bill** — works (allocations are optional at creation)
- **Approving/paying a bill** — blocked (status transition requires allocations that sum to bill total, but no budget lines exist)

Invoice payment status is irrelevant — AR (invoices) and AP (vendor bills) are fully decoupled, which is correct. The blocker is purely the missing budget lines.

## Why This Matters

Blocking vendor bills on unbudgeted projects renders half the tool (AP side) unusable for solo contractors using DIRECT invoicing. Option 4 (require estimates for bill projects) was rejected for this reason — vendor bills are B2B AP records, but contractors still need to track costs at the project level even without formal budgets.

## Decision: Option 1 now, Option 2 later

### MVP — Allow unallocated bills on unbudgeted projects (Option 1)

Skip the allocation-sum requirement when the project has no active budget. Bills are project-level cost records without line-level attribution.

**Implementation:** In the status transition guard, check `project.active_budget_id`. If `None`, skip the allocation-sum validation. When a budget exists, the allocation requirement stays in place.

**Trade-off:** No line-level cost tracking on unbudgeted projects. Acceptable because there are no budget lines to track against anyway.

### Future — Allocate bills to invoice lines (Option 2)

Extend `VendorBillAllocation` so it can reference either a `BudgetLine` OR an `InvoiceLine` (polymorphic FK or second nullable FK). This restores granular cost attribution for projects that only have DIRECT invoices.

**Deferred because:** Model complexity + migration cost. Not needed for MVP.

### Rejected

- **Option 3 (shadow budgets):** Creates implicit state the user didn't ask for. No.
- **Option 4 (require estimates for bill projects):** Makes half the app unusable for solo contractors. No.
