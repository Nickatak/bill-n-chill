# Billing Schedule (Payment Periods) — Design

Source: PM feedback #9 (2026-03-28). Payment schedule by % on estimates/projects.

## Concept

A billing schedule breaks a project's contract into named payment milestones (periods).
Each period is a **percentage** — the dollar amount is computed at invoice time against
a specific estimate's total, not stored on the period itself.

**Key insight:** The billing schedule belongs to the **project**, not any individual estimate.
The estimate creator is the natural *authoring surface* (GCs think about payment splits when
the numbers are in front of them), but the data is always project-scoped.

This is because:
- Multiple estimates can be approved against the same project
- A contractor has one payment schedule per contract, not per estimate
- The schedule is just percentages — dollar amounts are derived per-estimate at invoice time

## Model

### `BillingPeriod` (project-scoped)

| Field         | Type                        | Notes                                          |
|---------------|-----------------------------|-------------------------------------------------|
| `project`     | FK(Project, CASCADE)        | Parent project (the contract-level entity)      |
| `description` | CharField(255)              | e.g. "Upon signing", "At rough-in", "Final"    |
| `percent`     | DecimalField(6, 2)          | Percentage of total contract value              |
| `due_date`    | DateField (nullable, blank) | Expected payment date                           |
| `order`       | PositiveIntegerField        | Display/sort order                              |
| `created_at`  | DateTimeField(auto_now_add) |                                                 |
| `updated_at`  | DateTimeField(auto_now)     |                                                 |

- `ordering = ["order"]`
- Validation: `sum(percent)` across all periods for a project must equal `100` (serializer-level, not DB constraint since it spans rows).
- No `amount` or `amount_invoiced` fields — amounts are computed at invoice time.

### How amounts work

Periods store only percentages. When invoicing, the user picks an estimate and a period.
The amount is computed:

```
period_amount = estimate.total * period.percent / 100
```

This means:
- No stored amounts on periods — nothing to recompute when COs land
- No tracking of invoiced amounts on the period itself
- Tracking lives on the invoice side (optional FKs — see Invoice integration)

### Default behavior

On estimate creation (for a project with no existing periods), one default period:
- description: "Lump Sum"
- percent: 100
- order: 0

User can split from there by adding periods and adjusting percentages.

## Authoring surfaces

### Estimate creator (primary)

- Billing schedule section below the line items / totals area
- Editable — saves directly to the project's `BillingPeriod` rows
- If the project already has periods, they show up pre-populated
- Labeled "Project Billing Schedule" to clarify this is project-wide, not estimate-specific
- Validation: percentages must sum to 100% before save

### Project overview

- Billing schedule visible on project overview
- Editable — add/remove/rename/reorder periods, adjust percentages
- Same data as estimate creator (project-scoped rows)

### Public estimate preview

- Billing schedule renders read-only on the estimate public page
- Shows each period with description, percent, and computed dollar amount

## Invoice integration

### "Invoice a period" quick action

1. User is on a project with billing periods and approved estimates
2. User picks an **estimate** and a **billing period**
3. Amount is computed: `estimate.total * period.percent / 100`
4. Invoice is pre-filled with the period's description and computed amount
5. User can edit the invoice freely before sending

This means with two approved estimates ($50k and $30k) and a 30/40/30 schedule,
each estimate's milestones are invoiced independently — not lumped into one
contract-value calculation.

### Tracking (not enforcement)

When the quick action creates an invoice, it stamps two optional FKs on the Invoice:
- `source_estimate` — nullable FK to Estimate
- `billing_period` — nullable FK to BillingPeriod

This lets the UI grey out estimate+period combos that already have an invoice,
and show invoiced/not-yet-invoiced state on the billing schedule view.

No enforcement — the user can still create freeform invoices (both FKs null),
manually invoice any amount, or even re-bill a period if they choose. The tracking
covers the common case: estimate → bill each period in order → done.

### IC workflow preserved

Independent contractors who skip the estimate flow create invoices directly — freeform,
no billing periods involved. This path is unchanged.

## Two workflow paths

| Path | Flow | Billing periods? |
|------|------|-------------------|
| **IC** | Create invoice directly | No — freeform |
| **GC / Remodeler** | Estimate → billing periods → "invoice this period" | Yes — structured |

No forced coupling. Billing periods are opt-in, only relevant when estimates exist.

## Implementation Plan

### Phase 1 — Backend: Model, Migration, Serializers, API

Foundation — everything else depends on this.

**Create:**
- `backend/core/models/billing_periods/__init__.py`
- `backend/core/models/billing_periods/billing_period.py` — `BillingPeriod` model
- `backend/core/serializers/billing_periods.py` — read serializer + bulk-write serializer (sum-to-100 validation)
- `backend/core/views/billing_periods/__init__.py`
- `backend/core/views/billing_periods/billing_periods.py` — `GET/PUT /projects/<id>/billing-periods/`
- Migration: `BillingPeriod` table + `billing_period` nullable FK on Invoice

**Modify:**
- `backend/core/models/__init__.py` — register BillingPeriod
- `backend/core/models/accounts_receivable/invoice.py` — add `billing_period` FK (SET_NULL, nullable)
- `backend/core/serializers/__init__.py` — register new serializers
- `backend/core/serializers/invoices.py` — add `billing_period` to read + write serializers
- `backend/core/views/__init__.py` — register new view
- `backend/core/urls.py` — add route
- `backend/core/views/estimating/estimates.py` — trigger default "Lump Sum" on first estimate creation
- `backend/core/views/accounts_receivable/invoices.py` — validate billing_period belongs to project on invoice create

**API shape:**
- `GET /projects/<id>/billing-periods/` — list periods for project
- `PUT /projects/<id>/billing-periods/` — bulk replace (delete-all + bulk_create, atomic)

### Phase 2 — Frontend: Types, API Client, Editor Component

Reusable primitives consumed by all three surfaces.

**Create:**
- `frontend/src/features/estimates/components/billing-schedule-editor.tsx` — editable/read-only rows (description, percent, due date, computed dollar amount, remove button)
- `frontend/src/features/estimates/components/billing-schedule-editor.module.css`

**Modify:**
- `frontend/src/features/estimates/types.ts` — add `BillingPeriodRecord`, `BillingPeriodInput`
- `frontend/src/features/estimates/api.ts` — add `fetchBillingPeriods()`, `saveBillingPeriods()`

### Phase 3 — Estimate Creator Integration

Primary authoring surface. Section below totals, above submit.

**Modify:**
- `frontend/src/features/estimates/components/estimate-sheet-v2.tsx` — render `BillingScheduleEditor` below totals
- `frontend/src/features/estimates/components/estimates-console.tsx` — fetch periods on project load, save as separate API call after estimate save
- `frontend/src/features/estimates/hooks/use-estimate-form-fields.ts` — add billing period state

### Phase 4 — Project Overview Integration

Same editor, same endpoint, different surface.

**Modify:**
- `frontend/src/features/projects/components/projects-console.tsx` — billing schedule section in financial snapshot
- `frontend/src/features/projects/api.ts` — add/re-export billing period fetch functions

### Phase 5 — Public Estimate Preview

Read-only rendering with computed dollar amounts.

**Modify:**
- `backend/core/views/estimating/estimates.py` — include billing periods in public estimate response
- `frontend/src/features/estimates/components/estimate-approval-preview.tsx` — render read-only `BillingScheduleEditor`

### Phase 6 — Invoice Integration ("Invoice a Period")

Evolve deposit panel into period-aware invoice creation.

**Modify:**
- `frontend/src/features/projects/components/deposit-panel.tsx` — pick estimate + period → auto-compute amount, grey out invoiced combos
- `frontend/src/features/projects/components/projects-console.tsx` — compute invoiced combos from invoice list, pass to deposit panel

### Phase 7 — Tests

**Create:**
- `backend/core/tests/test_billing_periods.py` — model basics, CRUD, sum-to-100 validation, org scoping, invoice linkage, default lump sum
- `frontend/src/features/estimates/__tests__/billing-schedule-editor.test.tsx` — rendering, add/remove, validation, dollar computation

## Open Decisions

1. **Editing after partial invoicing:** Allow description/date edits on invoiced periods, block percent changes. Prevents silent financial drift.
2. **Default "Lump Sum" timing:** Triggered on first estimate creation for a project. Explicit, happens once, avoids write-side-effects on GET.
