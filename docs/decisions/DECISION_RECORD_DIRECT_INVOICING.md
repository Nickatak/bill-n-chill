# Decision Record: Direct Invoicing (Invoices Without Estimates)

Date: 2026-03-05
Status: Accepted

## The Problem

The current invoice workflow enforces a strict pipeline:

```
Estimate -> Approval -> Invoice (against approved scope) -> Payment
```

This pipeline provides excellent financial controls for GCs running structured projects
with detailed scope breakdowns. But it's a poor fit for:

- **Solo operators** (drywallers, painters, electricians) who give verbal quotes and
  just need to send a bill
- **Small service providers** doing T&M work where formal estimates aren't part of the
  workflow
- **Quick jobs** where the overhead of estimate -> approve -> invoice exceeds the value
  of the financial controls

Our ICP is 1-10 person GCs. The 1-person end of that spectrum — especially
non-full-remodeler service providers — needs a direct path from project to invoice.

## What Enforces the Pipeline Today

The model layer is already flexible. Invoice lines don't require rigid upstream linkage.

This matches the existing decision record (DECISION_RECORD_INVOICE_LINEAGE_AND_ADJUSTMENTS):
*"Do not require invoice lines to reference EstimateLineItem."*

But the helper layer adds enforcement the model doesn't require:

1. **`_apply_invoice_lines_and_totals()`** — Previously rejected SCOPE lines without
   upstream linkage. Without an approved estimate, the only way to create an invoice was
   with ADJUSTMENT lines, which semantically mean discounts/fees/credits — not "work performed."

2. **`_enforce_invoice_scope_guard()`** *(not yet implemented)* — Compares invoice total
   against `project.contract_value_current`. Without an approved estimate this value is
   0.00, so *any* invoice for *any* amount is blocked from being sent.

3. **Frontend invoice console** — The line editor requires cost code selection for SCOPE
   lines. Without an approved estimate, the invoice workflow was effectively blocked.

## Decision

Allow creating and sending invoices on projects that have no approved estimate.

### New Line Type: `DIRECT`

Add a third `InvoiceLine.LineType` choice:

| Type | Meaning | Requires |
|------|---------|----------|
| `scope` | Work billed against approved scope | `cost_code` (existing) |
| `adjustment` | Discount, fee, credit, or correction | `adjustment_reason` (existing) |
| `direct` | Work billed without approved scope backing | description + amount (new) |

DIRECT lines are free-form: description, quantity, unit, unit_price. No cost_code
required. They represent "I did this work and I'm billing for it" without the financial
control chain.

**Why a new type instead of relaxing SCOPE:** SCOPE lines carry a semantic guarantee —
they can be traced back through the approved estimate scope. Relaxing that guarantee
would degrade the traceability of all scope lines. A distinct type keeps the contract
clean: if `line_type == "scope"`, the scope linkage is trustworthy.

**Why this matters legally:** In a billing dispute between the user and their client,
the line type is the first thing legal counsel will look at. `scope` means "there is an
approved estimate behind this charge." `direct` means "there is not." These
are two fundamentally different evidentiary positions. Collapsing them into one type
would make it impossible to distinguish the two cases after the fact.

### Scope Guard Behavior

When sending an invoice on a project with **no approved estimate**:

- The scope guard is bypassed entirely. There is no approved scope ceiling to enforce
  against.
- The user is operating without financial controls and accepts that tradeoff.
- The invoice, its status events, and payment allocations still work normally.

When sending an invoice on a project **with** an approved estimate:

- Existing scope guard behavior is unchanged.
- DIRECT lines still count toward the invoice total (and thus the scope guard ceiling).
  Mixing DIRECT and SCOPE lines on a project with approved scope is allowed but the
  scope guard still applies to the full total.

### Financial Summary Behavior

Projects without approved estimates still produce valid financial summaries:

- `accepted_contract_total`: already returns 0 when no approved estimate exists
- AR fields (`invoiced_to_date`, `paid_to_date`, `ar_outstanding`): work regardless of
  estimate existence — they read from invoices and payments directly

## What Changes

### Backend

1. **InvoiceLine model** — Add `DIRECT = "direct"` to `LineType` choices. Migration.
2. **`_apply_invoice_lines_and_totals()`** — Accept DIRECT lines without cost code.
   DIRECT lines require only description + amount (same as today's ADJUSTMENT minus the
   `adjustment_reason` requirement).
3. **`_enforce_invoice_scope_guard()`** *(not yet implemented)* — Skip when no approved
   estimate exists on the project.
4. **Invoice serializer** — No changes needed. `line_type` is already a string field.

### Frontend

5. **Invoice console line editor** — When no approved estimate exists on the selected
   project, the line type defaults to `direct`. The editor shows description + quantity +
   unit + unit_price.
6. **When an approved estimate exists** — The line type dropdown gains a third option
   (`Direct`). Selecting it allows free-form billing without cost code linkage.

### Estimates

This decision does **not** change estimates. Estimates remain structured documents with
cost code line items. The relaxation is specifically: a project doesn't need an approved
estimate to be invoiceable.

A separate future consideration: whether estimates themselves should support a "simple
mode" without cost codes for small operators. That's a different question with different
tradeoffs and is not in scope here.

## What Doesn't Change

- **Invoices still require a project and customer.** Always. There is no concept of a
  "floating invoice" — if you're billing someone, you know who and for what project.
- **SCOPE lines still require cost_code.** The existing traceability contract is
  preserved.
- **ADJUSTMENT lines still require adjustment_reason.** No change.
- **Payment allocation** — Works the same regardless of line type.
- **Audit trail** — Invoice status events, scope override events all work as before.
- **Public invoice preview** — Renders line items by description/amount regardless of
  line type. No changes needed.

## Audit Trail and Legal Traceability

This is the most important section. If the user's client disputes a charge, either
party's legal counsel may request the billing paper trail. The system must produce an
unambiguous narrative for each invoice that makes the evidentiary basis immediately
clear.

### Two Distinct Audit Narratives

**Scope-backed invoice (full pipeline):**

```
1. Estimate #EST-0001 created by {user} on {date}
   └─ Line items with cost codes, quantities, unit prices
2. Estimate sent to customer on {date}
3. Customer approved estimate on {date} (public decision, IP + timestamp recorded)
4. Invoice #INV-0001 created by {user} on {date}
   └─ Each SCOPE line references cost code from approved estimate scope
   └─ Scope guard passed: invoice total ${X} within approved ceiling ${Y}
5. Invoice sent to customer on {date}
6. Payment received on {date}, allocated to invoice
```

Every link in this chain is immutable and timestamped. Legal counsel can trace any
charge back to the customer-approved estimate scope.

**Direct invoice (no pipeline):**

```
1. Invoice #INV-0001 created by {user} on {date}
   └─ DIRECT lines: description + amount only
   └─ No approved scope backing — scope guard not applicable
2. Invoice sent to customer on {date}
3. Payment received on {date}, allocated to invoice
```

The audit trail is shorter because there is less to trace. This is not a deficiency —
it is an accurate representation of what happened. The user billed without a formal
estimate, and the system records exactly that.

### What the `line_type` Field Guarantees

The `line_type` on every `InvoiceLine` row is a **permanent, immutable marker** of the
evidentiary basis for that charge:

| `line_type` | Evidentiary basis | What counsel can request |
|-------------|-------------------|------------------------|
| `scope` | Cost code from customer-approved estimate scope | Full chain: estimate, approval decision, cost code |
| `direct` | User's description of work performed | Invoice only: creation timestamp, creator, status history, payment records |
| `adjustment` | Explicit fee/credit/discount with stated reason | Invoice + adjustment_reason field |

These types cannot be changed after invoice creation. A SCOPE line cannot be
retroactively downgraded to DIRECT to hide a broken scope link, and a DIRECT line
cannot be upgraded to SCOPE to fabricate a paper trail that doesn't exist.

### What the System Records Regardless of Path

Both paths produce identical audit coverage for everything downstream of invoice
creation:

- **InvoiceStatusEvent** for every lifecycle transition (draft -> sent -> paid) with
  actor, timestamp, and optional note
- **Payment + PaymentAllocation** records with settlement timestamps
- **InvoiceScopeOverrideEvent** *(not yet implemented)* — if the user explicitly exceeds
  approved scope (only applicable when a budget exists)

### What Direct Invoicing Explicitly Lacks

When a user creates direct invoices without estimates, the following are absent from the
audit trail — not because the system failed to capture them, but because they never
existed:

- No estimate document (no scope breakdown agreed upon in writing)
- No customer approval decision (no public decision record with IP/timestamp)
- No contract value ceiling protection

**This is the user's choice, and the system makes it visible.** If counsel asks "was
there an approved estimate behind this invoice?", the answer is unambiguously "no" —
the DIRECT line type says so in the data. The system does not attempt to obscure or
soften this distinction.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Mix SCOPE + DIRECT lines on budgeted project | Allowed. Scope guard applies to full invoice total. |
| Approve estimate on previously unscoped project | Existing DIRECT-line invoices remain valid. New invoices can use SCOPE lines. |
| DIRECT line with cost_code | Allowed but optional. Provides categorization without requiring scope linkage. |
| "Bill All" button with no approved estimate | Creates one empty DIRECT line (or is hidden — TBD in frontend pass). |

## Implementation Constraint: Line Type Immutability

Once an invoice line is created, its `line_type` must not change. This is enforced at
the helper layer: `_apply_invoice_lines_and_totals()` replaces all lines on every save
(delete + bulk_create), but the line type for each line is determined at creation time
and the API does not accept type changes on existing lines.

If a user wants to change a DIRECT line to a SCOPE line (e.g., they later created an
estimate and want to link up), they delete the line and add a new SCOPE line. This
preserves the audit trail — the original DIRECT line existed and was removed, the new
SCOPE line was added.

Future consideration: if we ever need line-level immutability (preserving the exact
state of lines at each status transition), that would be handled by the invoice snapshot
model in the financial auditing layer, not by constraining line edits on draft invoices.

## Relationship to Existing Decision Records

This is consistent with DECISION_RECORD_INVOICE_LINEAGE_AND_ADJUSTMENTS, which states:

> *"Do not require invoice lines to reference EstimateLineItem."*

The model was designed for this flexibility. This decision catches the enforcement layer
up to the stated architectural intent.
