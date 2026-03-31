# Billing Schedule (Payment Periods) — Design

Source: PM feedback #9 (2026-03-28). Payment schedule by % on quotes/projects.

## Concept

A billing schedule breaks an quote into named payment milestones (periods).
Each period is a **percentage** — the dollar amount is computed at render/invoice
time against the quote's total, not stored on the period itself.

**Key decision:** Billing periods are **quote-scoped**, not project-scoped.
A project can have multiple quotes, and "33% on bathroom completion" is
meaningless for a different quote covering a garage remodel. Each quote
owns its own billing schedule.

Periods are embedded in the quote payload (like sections) — they create/update
atomically with the quote in a single request. No separate endpoint.

## Model

### `BillingPeriod` (quote-scoped)

| Field         | Type                        | Notes                                          |
|---------------|-----------------------------|-------------------------------------------------|
| `quote`    | FK(Quote, CASCADE)       | Parent quote                                 |
| `description` | CharField(255)              | e.g. "Upon signing", "At rough-in", "Final"    |
| `percent`     | DecimalField(6, 2)          | Percentage of quote total                    |
| `due_date`    | DateField (nullable, blank) | Expected payment date                           |
| `order`       | PositiveIntegerField        | Display/sort order                              |
| `created_at`  | DateTimeField(auto_now_add) |                                                 |
| `updated_at`  | DateTimeField(auto_now)     |                                                 |

- `ordering = ["order"]`
- Validation: `sum(percent)` across all periods for an quote must equal `100` (serializer-level, not DB constraint since it spans rows).
- Descriptions required — validated in `QuoteWriteSerializer.validate_billing_periods`.
- No `amount` or `amount_invoiced` fields — amounts are computed at render time.

### How amounts work

Periods store only percentages. Dollar amounts are computed:

```
period_amount = quote.grand_total * period.percent / 100
```

This means:
- No stored amounts on periods — nothing to recompute when COs land
- No tracking of invoiced amounts on the period itself
- Tracking lives on the invoice side (optional FK — see Invoice integration)

### Default behavior

The frontend seeds a default "Lump Sum" 100% period with due date =
today + org's `default_invoice_due_delta`. User can split from there
by adding periods and adjusting percentages. Billing periods are optional —
an quote with no periods has no billing schedule.

### Embedding pattern

Billing periods follow the same pattern as sections:
- Included in `QuoteWriteSerializer` as `billing_periods` (list, optional, default `[]`)
- Returned in `QuoteSerializer` as nested read-only `billing_periods`
- Prefetched in `_prefetch_quote_qs`
- On create: bulk-created within the quote's atomic transaction
- On update (draft save): delete-all + bulk-create within `_handle_quote_document_save`
- Locked on non-draft quotes (included in `mutating_fields` set)

## Authoring surfaces

### Quote creator (primary — implemented)

- `BillingScheduleEditor` component below line items / totals area
- Editable table: description, %, due date, computed $ amount, remove button
- "Add Period" button in footer
- Total % shown with invalid styling when != 100%
- Periods included in create/update payload — no separate save cycle
- Default Lump Sum seeded on form reset / initial load

### Public quote preview (Phase 5 — not yet implemented)

- Read-only rendering with computed dollar amounts
- Same `BillingScheduleEditor` component with `readOnly` prop

## Invoice integration

### Tracking FK (implemented in migration)

`Invoice.billing_period` — nullable FK(BillingPeriod, SET_NULL).
When the future "invoice a period" quick action creates an invoice, it stamps
this FK so the UI can show invoiced/not-yet-invoiced state on the schedule.

No enforcement — users can still create freeform invoices, manually invoice
any amount, or re-bill a period. The tracking covers the common case:
quote -> bill each period in order -> done.

### "Invoice a period" quick action (Phase 6 — not yet implemented)

1. User picks an **quote** and a **billing period**
2. Amount computed: `quote.grand_total * period.percent / 100`
3. Invoice pre-filled with period description and computed amount
4. User can edit freely before sending

### IC workflow preserved

Independent contractors who skip the quote flow create invoices directly —
freeform, no billing periods involved. This path is unchanged.

## Two workflow paths

| Path | Flow | Billing periods? |
|------|------|-------------------|
| **IC** | Create invoice directly | No — freeform |
| **GC / Remodeler** | Quote -> billing periods -> "invoice this period" | Yes — structured |

No forced coupling. Billing periods are opt-in, only relevant when quotes exist.

## Error handling

Serializer errors from billing period validation are wrapped in the standard
`{"error": {"code": "...", "message": "..."}}` envelope. The quote views
use manual `is_valid()` instead of `raise_exception=True` so that nested
serializer errors (e.g. invalid percent on a period row) produce readable
messages via `_format_serializer_errors`.

## Implementation status

### Done (Phases 1-3)

- `BillingPeriod` model (quote-scoped) + migration
- Billing period serializers (read + input)
- Embedded in `QuoteWriteSerializer` / `QuoteSerializer`
- Validation: sum to 100%, descriptions required
- Create/update handling in quote views + helpers
- Prefetch for N+1 prevention
- Invoice `billing_period` FK (migration only — UI not wired yet)
- `BillingScheduleEditor` component (editable + read-only)
- Quote creator integration (state, payload, hydration, duplication)
- Default Lump Sum seeding from org invoice due delta
- Responsive CSS (desktop table, mobile card, print flattening)
- Public quote preview (read-only billing schedule)

### Remaining

- **Phase 6:** Invoice integration ("invoice a period" quick action) — **deferred**
- **Phase 7:** Tests (backend model/API + frontend component)

## Open decisions

1. **Editing after partial invoicing:** Allow description/date edits on invoiced periods, block percent changes? Prevents silent financial drift.
2. **Duplicate-as-new behavior:** Currently copies billing periods from source quote. Should due dates be recalculated relative to today?
