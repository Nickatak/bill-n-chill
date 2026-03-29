# Billing Schedule (Payment Periods) — Design

Source: PM feedback #9 (2026-03-28). Payment schedule by % and amount on estimates.

## Concept

A billing schedule breaks a project's contract value into named payment milestones (periods).
Each period represents a portion of the contract that gets invoiced when the milestone is reached.

**Key insight:** The billing schedule belongs to the **project**, not any individual estimate.
The estimate is the *authoring surface* where the user defines the schedule, but on approval
it graduates to the project level — same pattern as contract values (estimate seeds it, COs evolve it).

This is because:
- Multiple estimates can be approved against the same project
- Change orders modify the contract value after estimate approval
- The schedule must always reflect the *current* contract value, not a frozen estimate total
- IRL, contractors have one payment schedule per contract, not per estimate

## Model

### `BillingPeriod` (project-scoped)

| Field            | Type                    | Notes                                      |
|------------------|-------------------------|--------------------------------------------|
| `project`        | FK(Project, CASCADE)    | Parent project (the contract-level entity) |
| `description`    | CharField(255)          | e.g. "Upon signing", "At rough-in", "Upon completion" |
| `percent`        | DecimalField(6, 2)      | Percentage of total contract value — fixed by user |
| `amount`         | DecimalField(12, 2)     | Computed: `current_contract_value * percent / 100` — moves when COs land |
| `amount_invoiced`| DecimalField(12, 2)     | Accumulated from invoices created against this period |
| `order`          | PositiveIntegerField    | Display/sort order                         |
| `created_at`     | DateTimeField(auto_now_add) |                                          |
| `updated_at`     | DateTimeField(auto_now)     |                                          |

- `ordering = ["order"]`
- Constraint: `sum(percent)` across all periods for a project must equal `100`.
- `balance` is computed: `amount - amount_invoiced` (not stored).

### How amounts move

The period's `percent` is fixed (set by the user). The `amount` is always derived from
`percent * current_contract_value`. When the contract value changes (new estimate approved,
CO approved), every period's `amount` shifts automatically. Already-invoiced dollars
(`amount_invoiced`) don't change — the delta shows up in the `balance`.

**Example:**
1. Estimate1 approved for $5. Schedule: 10% now / 90% later.
2. Period 1 amount = $0.50. Customer pays $0.50. `amount_invoiced = 0.50`.
3. Estimate2 approved for $7. Contract value is now $12.
4. Period 1 amount = $1.20. `amount_invoiced` still $0.50. Balance = $0.70.
5. Period 2 amount = $10.80. Balance = $10.80.
6. Total: $0.50 + $0.70 + $10.80 = $12. ✓

### Lifecycle

- **Created on the estimate** — user defines schedule while authoring the estimate
- **Graduates to project on estimate approval** — same pattern as contract values
- **Evolved by COs** — COs can add/modify periods against updated contract value
- **Referenced by invoicing** — "invoice this period" pulls from project-level schedule

### Default behavior

On estimate creation, one default period is created:
- description: "Lump Sum"
- percent: 100
- order: 0

User can split from there by adding periods and adjusting percentages.
If all extra periods are removed and only one remains, it resets to "Lump Sum" at 100%.

## Invoice integration

### No changes to the Invoice model

Invoices remain freeform. Billing periods do not FK into invoices.

### Quick action: "Invoice a period"

Replaces the current "make deposit invoice" concept. Flow:

1. User is on a project with billing periods
2. Quick action shows available periods with their current balance
3. User selects a period (e.g. "At rough-in — 30% — $3,600 remaining")
4. Invoice is pre-filled with that period's description and remaining balance
5. `amount_invoiced` is incremented on the period
6. User can still edit the invoice freely before sending

Periods with zero balance are greyed out / not selectable.

### IC workflow preserved

Independent contractors who skip the estimate flow create invoices directly — freeform,
no billing periods involved. This path is unchanged.

## Two workflow paths

| Path | Flow | Billing periods? |
|------|------|-------------------|
| **IC** | Create invoice directly | No — freeform |
| **GC / Remodeler** | Estimate → billing periods → "invoice this period" | Yes — structured |

No forced coupling. Billing periods are opt-in, only relevant when an estimate exists.

## UX

### Estimate creator
- Billing schedule section below the line items / totals area
- Default: single "Lump Sum" row at 100%
- "Add Period" button to split into multiple milestones
- Each row: description, percent, computed amount (read-only)
- Validation: percentages must sum to 100% before save
- On estimate approval, schedule graduates to project level

### Project level
- Billing schedule visible on project overview
- Shows each period: description, percent, amount, invoiced, balance
- Periods with remaining balance show "Invoice" action
- CO approval can modify the schedule

### Public estimate
- Billing schedule renders on the estimate PDF / public preview
- Shows each period with description, percent, and dollar amount

### Invoice creation
- "Invoice a period" replaces "make deposit invoice"
- Shows uninvoiced/partially-invoiced periods with remaining balance
- Pre-fills invoice, user finalizes and sends

## Resolved Questions

1. **Grand total changes after invoicing?** — The *estimate* total is locked, but the *contract value* changes when COs or new estimates are approved. Period amounts recompute against current contract value. Already-invoiced amounts are untouched — the delta appears in the balance.
2. **Single period auto-resets to "Lump Sum"?** — Yes. If all extra periods are removed and only one remains, it resets to "Lump Sum" at 100%.
3. **Estimate-scoped or project-scoped?** — Project-scoped. Authored on the estimate, graduates to project on approval. This mirrors how contract values work and handles multi-estimate / CO scenarios correctly.
