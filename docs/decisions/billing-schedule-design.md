# Billing Schedule (Payment Periods) — Design

Source: PM feedback #9 (2026-03-28). Payment schedule by % and amount on estimates.

## Concept

A billing schedule breaks an estimate's grand total into named payment milestones (periods).
Each period represents a portion of the contract that gets invoiced when the milestone is reached.

This is purely an estimate-level feature. Invoices are unchanged — billing periods serve as a
smarter entry point into invoice creation, not a structural dependency.

## Model

### `EstimateBillingPeriod`

| Field         | Type                    | Notes                                      |
|---------------|-------------------------|--------------------------------------------|
| `estimate`    | FK(Estimate, CASCADE)   | Parent estimate                            |
| `description` | CharField(255)          | e.g. "Upon signing", "At rough-in", "Upon completion" |
| `percent`     | DecimalField(6, 2)      | Percentage of grand total                  |
| `amount`      | DecimalField(12, 2)     | Computed: `grand_total * percent / 100`    |
| `order`       | PositiveIntegerField    | Display/sort order                         |
| `invoiced`    | BooleanField(default=False) | Whether an invoice has been created for this period |
| `created_at`  | DateTimeField(auto_now_add) |                                          |
| `updated_at`  | DateTimeField(auto_now)     |                                          |

- `ordering = ["order"]`
- Constraint: `sum(percent)` across all periods for an estimate must equal `100`.
- `amount` is recomputed whenever the estimate's grand total changes.

### Default behavior

On estimate creation, one default period is created:
- description: "Lump Sum"
- percent: 100
- order: 0

User can split from there by adding periods and adjusting percentages.

## Invoice integration

### No changes to the Invoice model

Invoices remain freeform. Billing periods do not FK into invoices.

### Quick action: "Invoice a period"

Replaces the current "make deposit invoice" concept. Flow:

1. User is on a project with an approved estimate that has billing periods
2. Quick action shows available (uninvoiced) periods
3. User selects a period (e.g. "At rough-in — 30% — $15,000")
4. Invoice is pre-filled with that period's description and amount
5. Period is marked `invoiced = True`
6. User can still edit the invoice freely before sending

Periods already invoiced are greyed out / not selectable.

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

### Public estimate
- Billing schedule renders on the estimate PDF / public preview
- Shows each period with description, percent, and dollar amount

### Invoice creation
- "Invoice a period" replaces "make deposit invoice"
- Dropdown/selector of uninvoiced periods
- Pre-fills invoice, user finalizes and sends

## Resolved Questions

1. **Grand total changes after invoicing?** — Not possible. Estimate totals are locked once past draft/sent. Changes go through the change order workflow, which has its own financials. No recomputation concern.
2. **Single period auto-resets to "Lump Sum"?** — Yes. If all extra periods are removed and only one remains, it resets to "Lump Sum" at 100%.
