# Invoice Call Chains

> Line anchors are pinned manually. Update after refactors that move function definitions.

## Create Invoice (POST)

`FRONTEND` — [`InvoicesConsole`](../../frontend/src/features/invoices/components/invoices-console.tsx#L721)

- [`handleCreateInvoice()`](../../frontend/src/features/invoices/components/invoices-console.tsx#L721)
  - Validates `invoiceDraftFormState` via [`invoiceCreatorAdapter.toCreatePayload()`](../../frontend/src/features/invoices/helpers.ts)
  - `fetch POST /api/v1/projects/{projectId}/invoices/`

---

`BACKEND` — [`project_invoices_view`](../../backend/core/views/accounts_receivable/invoices.py#L229)

*── validation ──*

- [`_validate_project_for_user(project_id, user)`](../../backend/core/views/helpers.py)
- [`_capability_gate(user, "invoices", "create")`](../../backend/core/rbac.py)
- [`InvoiceWriteSerializer.is_valid()`](../../backend/core/serializers)
- [`build_invoice_create_ingress(validated_data, defaults…)`](../../backend/core/views/accounts_receivable/invoice_ingress.py#L37)
  - Applies org defaults for sender identity, T&C, due date delta
  - Normalizes line items via [`_normalize_invoice_line_item()`](../../backend/core/views/accounts_receivable/invoice_ingress.py#L9)
- Empty line items → 400
- `due_date < issue_date` → 400

*── persist (atomic) ──*

- `transaction.atomic():`
  - `Invoice.objects.create(…)` — status=DRAFT, auto-generated `invoice_number` via [`_next_invoice_number()`](../../backend/core/views/accounts_receivable/invoices_helpers.py#L40)
  - [`_apply_invoice_lines_and_totals(invoice, line_items, tax_percent, user)`](../../backend/core/views/accounts_receivable/invoices_helpers.py#L77)
    - [`_calculate_invoice_line_totals(line_items_data)`](../../backend/core/views/accounts_receivable/invoices_helpers.py#L55) — per-line `quantity × unit_price`, running subtotal
    - [`_resolve_cost_codes_for_user(user, items)`](../../backend/core/views/helpers.py) — maps cost code references → model instances
    - `InvoiceLine.objects.all().delete()` + `InvoiceLine.objects.bulk_create(…)`
    - Sets `invoice.subtotal`, `tax_total`, `total`, `balance_due` → `invoice.save()`
  - [`InvoiceStatusEvent.record(from=None, to=draft)`](../../backend/core/models) — immutable audit
  - [`_activate_project_from_invoice_creation()`](../../backend/core/views/accounts_receivable/invoices_helpers.py#L151) — prospect → active if applicable

---

`HTTP 201` → `FRONTEND`

- [`handleCreateInvoice` success path](../../frontend/src/features/invoices/components/invoices-console.tsx#L793)
  - `loadInvoices()` — refreshes list
  - `setSelectedInvoiceId()` — selects new invoice
  - `loadInvoiceIntoWorkspace()` — populates editor


## PATCH Invoice (status change, line items, metadata)

`FRONTEND` — [`InvoicesConsole`](../../frontend/src/features/invoices/components/invoices-console.tsx)

Three PATCH entry points, all hitting the same backend endpoint:

1. **Status transition** — [`handleUpdateInvoiceStatus()`](../../frontend/src/features/invoices/components/invoices-console.tsx#L806)
   - Payload: `{ status, status_note? }`
   - Auto-generates send note for draft→sent or re-send

2. **Draft save** — saves line items + metadata via [`invoiceCreatorAdapter.toUpdatePayload()`](../../frontend/src/features/invoices/helpers.ts)
   - Payload: `{ line_items, tax_percent, issue_date, due_date, sender_*, terms_text, … }`

3. **Status note** — adds a note to the current status
   - Payload: `{ status_note }`

All: `fetch PATCH /api/v1/invoices/{invoiceId}/`

---

`BACKEND` — [`invoice_detail_view` (PATCH branch)](../../backend/core/views/accounts_receivable/invoices.py#L341)

*── auth + lookup ──*

- [`_ensure_membership(user)`](../../backend/core/user_helpers.py)
- `Invoice.objects.get(id=invoice_id, project__organization_id=membership.organization_id)` — org-scoped
- [`_capability_gate(user, "invoices", "edit")`](../../backend/core/rbac.py)

*── ingress + validation ──*

- [`InvoiceWriteSerializer.is_valid(partial=True)`](../../backend/core/serializers)
- [`build_invoice_patch_ingress(validated_data)`](../../backend/core/views/accounts_receivable/invoice_ingress.py#L103)
  - Per-field `has_*` presence flags (only touches fields the client sent)
- Status transition validation via [`Invoice.is_transition_allowed(current, next)`](../../backend/core/models/mixins.py#L67)
  - Allowed: draft→{sent,void}, sent→{partially_paid,paid,void}, partially_paid→{paid,sent}
  - Terminal: paid, void (no outbound)
  - Same-status allowed for re-send (sent→sent) and status notes
- `due_date < issue_date` → 400
- Line item cost code validation via [`_resolve_cost_codes_for_user()`](../../backend/core/views/helpers.py)

*── persist (atomic) ──*

- `transaction.atomic():`
  - **Scalar fields:** issue_date, due_date, status, tax_percent, sender_*, terms, footer, notes → `invoice.save(update_fields=[…])`
  - **Identity freeze on leaving draft:** When `draft → non-draft`, backfills sender_name, sender_address, sender_logo_url, terms_text from org defaults if not already set
  - **Line items branch** (three-way):
    - `has_line_items` → [`_apply_invoice_lines_and_totals()`](../../backend/core/views/accounts_receivable/invoices_helpers.py#L77) — full line replace + totals recompute, sets `balance_due = total` (or 0 if paid)
    - `has_tax_percent` only → re-applies existing lines with new tax (same helper)
    - **status change only** → recomputes `balance_due` from settled payment allocations (fixed 2026-03-15; honors `PAID` override)
  - **Status event:** [`InvoiceStatusEvent.record(from, to, note)`](../../backend/core/models) — recorded when status changed, re-sent, or note requested

*── post-commit: email ──*

- If transitioning to `sent` (first send or re-send):
  - [`send_document_sent_email()`](../../backend/core/utils/email.py) — Mailgun HTTP API
  - Response includes `email_sent` flag

---

`HTTP 200` → `FRONTEND`

- Status transition: updates invoice in list, clears selected status, shows flash
- Draft save: reloads invoices, re-selects, shows flash
- Status note: reloads invoices, clears note input


## Send Invoice (POST, dedicated endpoint)

`FRONTEND` — sends via status transition PATCH (draft→sent), not this endpoint directly.

`BACKEND` — [`invoice_send_view`](../../backend/core/views/accounts_receivable/invoices.py#L594)

*── validation ──*

- Org-scoped lookup: `Invoice.objects.get(id, project__organization_id=membership.organization_id)`
- [`_capability_gate(user, "invoices", "send")`](../../backend/core/rbac.py)
- [`Invoice.is_transition_allowed(current, SENT)`](../../backend/core/models/mixins.py#L67)

*── persist (atomic) ──*

- `transaction.atomic():`
  - `invoice.status = SENT`
  - Identity freeze (same pattern as PATCH): backfills sender fields from org if blank
  - `invoice.save(update_fields=[…])`
  - [`InvoiceStatusEvent.record(from, to=sent, note="Invoice sent.")`](../../backend/core/models)

*── post-commit: email ──*

- [`send_document_sent_email()`](../../backend/core/utils/email.py)

---

`HTTP 200` → response includes `email_sent` flag


## Public Invoice View (GET, unauthenticated)

`BACKEND` — [`public_invoice_detail_view`](../../backend/core/views/accounts_receivable/invoices.py#L50)

- `Invoice.objects.get(public_token=public_token)` — no auth required
- Serializes invoice + [`_serialize_public_project_context()`](../../backend/core/views/helpers.py) + [`_serialize_public_organization_context()`](../../backend/core/views/helpers.py)
- Includes ceremony consent text via [`get_ceremony_context()`](../../backend/core/views/public_signing_helpers.py)


## Public Invoice Decision (POST, unauthenticated)

`BACKEND` — [`public_invoice_decision_view`](../../backend/core/views/accounts_receivable/invoices.py#L79)

*── validation ──*

- Invoice must be in `sent` or `partially_paid` status
- Decision: `approve`/`pay` → marks paid, `dispute`/`reject` → records dispute note
- [`validate_ceremony_on_decision()`](../../backend/core/views/public_signing_helpers.py) — OTP email verification

*── persist (atomic) ──*

- `transaction.atomic():`
  - Approve: `invoice.status = PAID`, `invoice.save()`, `InvoiceStatusEvent.record()`
  - Dispute: `InvoiceStatusEvent.record()` (status unchanged, note recorded)
  - [`SigningCeremonyRecord.record()`](../../backend/core/models) — immutable signing audit with content hash, IP, UA, consent snapshot


## Invoice Status Events (GET)

`BACKEND` — [`invoice_status_events_view`](../../backend/core/views/accounts_receivable/invoices.py#L675)

- Org-scoped lookup
- Returns `InvoiceStatusEvent` history for one invoice


## Resolved Issues (2026-03-15)

1. **balance_due reset on status-only PATCH** — Fixed: now recomputes from settled `PaymentAllocation` records instead of naively resetting to `invoice.total`.

2. **`_apply_invoice_lines_and_totals` allocation-unaware reset** — Fixed: queries settled allocations and computes `balance_due = new_total - applied_total`, clamped to 0.
