# Invoice Call Chains

> Line anchors are pinned manually. Update after refactors that move function definitions.


## Policy Contract (GET)

`FRONTEND` — [`InvoicesConsole`](../../frontend/src/features/invoices/components/invoices-console.tsx#L219)

- [`fetchInvoicePolicyContract()`](../../frontend/src/features/invoices/api.ts#L19) — on mount
  - `fetch GET /api/v1/contracts/invoices/`

---

`BACKEND` — [`invoice_contract_view`](../../backend/core/views/accounts_receivable/invoices.py#L224)

- [`get_invoice_policy_contract()`](../../backend/core/policies) — returns canonical workflow rules for frontend UX guards

---

`HTTP 200` → `FRONTEND`

- Populates `statusPolicy` — allowed transitions, labels, filter pills


## List Invoices (GET)

`FRONTEND` — [`InvoicesConsole`](../../frontend/src/features/invoices/components/invoices-console.tsx#L219)

- [`loadInvoices()`](../../frontend/src/features/invoices/components/invoices-console.tsx#L444)
  - `fetch GET /api/v1/projects/{projectId}/invoices/`

---

`BACKEND` — [`project_invoices_view` (GET branch)](../../backend/core/views/accounts_receivable/invoices.py#L231)

- [`_validate_project_for_user(project_id, user)`](../../backend/core/views/helpers.py) — org-scoped project check
- `Invoice.objects.filter(project=project).select_related(…).prefetch_related(…)`
- [`InvoiceSerializer(rows, many=True)`](../../backend/core/serializers/invoices.py#L50)

---

`HTTP 200` → `FRONTEND`

- `setInvoices()` — replaces list
- Reconciles `selectedInvoiceId` if previous selection is gone
- Auto-selects first invoice into workspace on initial load


## Create Invoice (POST)

`FRONTEND` — [`InvoicesConsole`](../../frontend/src/features/invoices/components/invoices-console.tsx#L219)

- [`handleCreateInvoice()`](../../frontend/src/features/invoices/components/invoices-console.tsx#L711)
  - Permission guard: `canMutateInvoices`
  - Workspace lock check: `workspaceIsLocked`
  - Line validation: cost code required on every line, description required
  - Serializes via [`invoiceCreatorAdapter.toCreatePayload()`](../../frontend/src/features/invoices/document-adapter.ts#L82)
  - `fetch POST /api/v1/projects/{projectId}/invoices/`

---

`BACKEND` — [`project_invoices_view` (POST branch)](../../backend/core/views/accounts_receivable/invoices.py#L231)

*── validation ──*

- [`_validate_project_for_user(project_id, user)`](../../backend/core/views/helpers.py)
- [`_capability_gate(user, "invoices", "create")`](../../backend/core/rbac.py)
- [`_ensure_org_membership(user)`](../../backend/core/user_helpers.py)
- [`InvoiceWriteSerializer.is_valid()`](../../backend/core/serializers/invoices.py#L111)
- [`build_invoice_create_ingress(validated_data, defaults…)`](../../backend/core/views/accounts_receivable/invoice_ingress.py#L37)
  - Applies org defaults for sender identity, T&C, due date delta
  - Normalizes line items via [`_normalize_invoice_line_item()`](../../backend/core/views/accounts_receivable/invoice_ingress.py#L9)
- Empty line items → 400
- `due_date < issue_date` → 400

*── persist (atomic) ──*

- `transaction.atomic():`
  - `Invoice.objects.create(…)` — status=DRAFT, auto-generated `invoice_number` via [`_next_invoice_number()`](../../backend/core/views/accounts_receivable/invoices_helpers.py#L42)
  - [`_apply_invoice_lines_and_totals(invoice, line_items, tax_percent, user)`](../../backend/core/views/accounts_receivable/invoices_helpers.py#L79)
    - [`_calculate_invoice_line_totals(line_items_data)`](../../backend/core/views/accounts_receivable/invoices_helpers.py#L57) — per-line `quantity × unit_price`, running subtotal
    - [`_resolve_cost_codes_for_user(user, items)`](../../backend/core/views/helpers.py) — maps cost code references → model instances
    - `InvoiceLine.objects.all().delete()` + `InvoiceLine.objects.bulk_create(…)`
    - Computes `balance_due` from settled `PaymentAllocation` records
    - Sets `invoice.subtotal`, `tax_total`, `total`, `balance_due` → `invoice.save()`
  - [`InvoiceStatusEvent.record(from=None, to=draft)`](../../backend/core/models) — immutable audit
  - [`_activate_project_from_invoice_creation()`](../../backend/core/views/accounts_receivable/invoices_helpers.py#L165) — prospect → active if applicable

---

`HTTP 201` → `FRONTEND`

- [`handleCreateInvoice` success path](../../frontend/src/features/invoices/components/invoices-console.tsx#L711)
  - `loadInvoices()` — refreshes list
  - `setSelectedInvoiceId()` — selects new invoice
  - `loadInvoiceIntoWorkspace()` — populates editor
  - `flashCreator()` — visual feedback


## PATCH Invoice (status change, line items, metadata)

`FRONTEND` — [`InvoicesConsole`](../../frontend/src/features/invoices/components/invoices-console.tsx#L219)

Three PATCH entry points, all hitting the same backend endpoint:

1. **Status transition** — [`handleUpdateInvoiceStatus()`](../../frontend/src/features/invoices/components/invoices-console.tsx#L796)
   - Payload: `{ status, status_note? }`
   - Auto-generates send note for draft→sent ("Invoice sent.") or re-send ("Invoice re-sent.")

2. **Draft save** — [`handleCreateInvoice()` with `editingDraftInvoiceId`](../../frontend/src/features/invoices/components/invoices-console.tsx#L711)
   - Saves line items + metadata via [`invoiceCreatorAdapter.toUpdatePayload()`](../../frontend/src/features/invoices/document-adapter.ts#L82)
   - Payload: `{ line_items, tax_percent, issue_date, due_date, sender_*, terms_text, … }`

3. **Status note** — [`handleAddInvoiceStatusNote()`](../../frontend/src/features/invoices/components/invoices-console.tsx#L856)
   - Payload: `{ status_note }`

All: `fetch PATCH /api/v1/invoices/{invoiceId}/`

---

`BACKEND` — [`invoice_detail_view` (PATCH branch)](../../backend/core/views/accounts_receivable/invoices.py#L345)

*── auth + lookup ──*

- [`_ensure_org_membership(user)`](../../backend/core/user_helpers.py)
- `Invoice.objects.get(id=invoice_id, project__organization_id=membership.organization_id)` — org-scoped
- [`_capability_gate(user, "invoices", "edit")`](../../backend/core/rbac.py)

*── ingress + validation ──*

- [`InvoiceWriteSerializer.is_valid(partial=True)`](../../backend/core/serializers/invoices.py#L111)
- [`build_invoice_patch_ingress(validated_data)`](../../backend/core/views/accounts_receivable/invoice_ingress.py#L103)
  - Per-field `has_*` presence flags (only touches fields the client sent)
- Status transition validation via `Invoice.ALLOWED_STATUS_TRANSITIONS` map
  - Allowed: draft→{sent,void}, sent→{closed,void}, outstanding→{closed}
  - Terminal: closed, void (no outbound)
  - Same-status allowed for re-send (sent→sent) and status notes
- `due_date < issue_date` → 400
- Line item cost code validation via [`_resolve_cost_codes_for_user()`](../../backend/core/views/helpers.py)

*── persist (atomic) ──*

- `transaction.atomic():`
  - **Scalar fields:** issue_date, due_date, status, tax_percent, sender_*, terms, footer, notes → `invoice.save(update_fields=[…])`
  - **Identity freeze on leaving draft:** When `draft → non-draft`, backfills sender_name, sender_address, sender_logo_url, terms_text from org defaults if not already set
  - **Line items branch** (three-way):
    - `has_line_items` → [`_apply_invoice_lines_and_totals()`](../../backend/core/views/accounts_receivable/invoices_helpers.py#L79) — full line replace + totals recompute, balance_due from settled allocations
    - `has_tax_percent` only → re-applies existing lines with new tax (same helper)
    - **status change only** → recomputes `balance_due` from settled `PaymentAllocation` records; honors `CLOSED` override (balance_due=0)
  - **Status event:** [`InvoiceStatusEvent.record(from, to, note)`](../../backend/core/models) — recorded when status changed, re-sent, or note requested

*── post-commit: email ──*

- If transitioning to `sent` (first send or re-send):
  - [`send_document_sent_email()`](../../backend/core/utils/email.py) — Mailgun HTTP API
  - Response includes `email_sent` flag

---

`HTTP 200` → `FRONTEND`

- **Status transition:** updates invoice in list, refreshes status events, checks `email_sent === false` to warn about missing customer email, shows flash
- **Draft save:** updates invoice in list, re-selects, shows flash
- **Status note:** updates invoice in list, refreshes status events, clears note input


## Send Invoice (POST, dedicated endpoint)

`FRONTEND` — sends via status transition PATCH (draft→sent), not this endpoint directly.

`BACKEND` — [`invoice_send_view`](../../backend/core/views/accounts_receivable/invoices.py#L609)

*── validation ──*

- [`_ensure_org_membership(user)`](../../backend/core/user_helpers.py)
- Org-scoped lookup: `Invoice.objects.get(id, project__organization_id=membership.organization_id)`
- [`_capability_gate(user, "invoices", "send")`](../../backend/core/rbac.py)
- `Invoice.ALLOWED_STATUS_TRANSITIONS` — validates current → SENT is allowed

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


## Duplicate Invoice as Draft (POST)

`FRONTEND` — [`InvoicesConsole`](../../frontend/src/features/invoices/components/invoices-console.tsx#L219)

- [`handleDuplicateInvoiceIntoDraft()`](../../frontend/src/features/invoices/components/invoices-console.tsx#L905)
  - Extracts line items from selected invoice via [`invoiceToWorkspaceLines()`](../../frontend/src/features/invoices/components/invoices-console.tsx#L529)
  - Computes fresh issue/due dates from org defaults
  - Builds form state: same lines/tax/terms, new dates
  - Serializes via [`invoiceCreatorAdapter.toCreatePayload()`](../../frontend/src/features/invoices/document-adapter.ts#L82)
  - `fetch POST /api/v1/projects/{projectId}/invoices/`

---

`BACKEND` — same as [Create Invoice](#create-invoice-post)

---

`HTTP 201` → `FRONTEND`

- `loadInvoices()` — refreshes list
- `loadInvoiceIntoWorkspace(created)` — populates editor with new draft
- `flashCreator()` — visual feedback


## Public Invoice View (GET, unauthenticated)

`BACKEND` — [`public_invoice_detail_view`](../../backend/core/views/accounts_receivable/invoices.py#L52)

- `Invoice.objects.get(public_token=public_token)` — no auth required
- [`InvoiceSerializer(invoice)`](../../backend/core/serializers/invoices.py#L50)
- [`_resolve_organization_for_public_actor(invoice.created_by)`](../../backend/core/views/helpers.py) — org from creator
- [`_serialize_public_project_context()`](../../backend/core/views/helpers.py)
- [`_serialize_public_organization_context()`](../../backend/core/views/helpers.py)
- [`get_ceremony_context()`](../../backend/core/views/public_signing_helpers.py) — consent text + version


## Public Invoice Decision (POST, unauthenticated)

`FRONTEND` — [`InvoicePublicPreview`](../../frontend/src/features/invoices/components/invoice-public-preview.tsx#L51)

- [`applyDecision(decision, ceremony)`](../../frontend/src/features/invoices/components/invoice-public-preview.tsx#L113)
  - `fetch PATCH /api/v1/public/invoices/{publicToken}/`
  - Body: `{ decision, ceremony_payload: { … } }`

---

`BACKEND` — [`public_invoice_decision_view`](../../backend/core/views/accounts_receivable/invoices.py#L81)

*── validation ──*

- Invoice must be in `sent` or `partially_paid` status
- Decision: `approve`/`pay` → marks paid, `dispute`/`reject` → records dispute note
- [`validate_ceremony_on_decision()`](../../backend/core/views/public_signing_helpers.py) — OTP email verification
- [`compute_document_content_hash("invoice", …)`](../../backend/core/utils/signing.py) — content integrity

*── persist (atomic) ──*

- `transaction.atomic():`
  - **Approve:** `invoice.status = PAID`, `invoice.balance_due = 0` (auto in save), `InvoiceStatusEvent.record()`
  - **Dispute:** status unchanged, `InvoiceStatusEvent.record()` with dispute note (same from/to)
  - [`SigningCeremonyRecord.record()`](../../backend/core/models) — immutable signing audit with content hash, IP, UA, consent snapshot

---

`HTTP 200` → `FRONTEND`

- `loadInvoice()` — reloads to reflect updated status
- Shows decision receipt name, flashes section


## Invoice Status Events (GET)

`FRONTEND` — [`InvoicesConsole`](../../frontend/src/features/invoices/components/invoices-console.tsx#L219)

- [`loadInvoiceStatusEvents(invoiceId)`](../../frontend/src/features/invoices/components/invoices-console.tsx#L503)
  - `fetch GET /api/v1/invoices/{invoiceId}/status-events/`

---

`BACKEND` — [`invoice_status_events_view`](../../backend/core/views/accounts_receivable/invoices.py#L690)

- [`_ensure_org_membership(user)`](../../backend/core/user_helpers.py)
- Org-scoped lookup
- `InvoiceStatusEvent.objects.filter(invoice=invoice)`
- [`InvoiceStatusEventSerializer`](../../backend/core/serializers/invoices.py#L129) — computes `action_type` from from/to/note

---

`HTTP 200` → `FRONTEND`

- `setSelectedInvoiceStatusEvents()` — populates history panel
- Action labels derived via [`invoiceStatusEventActionLabel()`](../../frontend/src/features/invoices/helpers.ts#L132)


## Contract Breakdown (GET, reference data)

`FRONTEND` — [`InvoicesConsole`](../../frontend/src/features/invoices/components/invoices-console.tsx#L219)

- [`loadContractBreakdown(projectId)`](../../frontend/src/features/invoices/components/invoices-console.tsx#L480)
  - `fetch GET /api/v1/projects/{projectId}/contract-breakdown/`

---

`BACKEND` — returns active quote + approved change orders for the project

---

`HTTP 200` → `FRONTEND`

- `setContractBreakdown()` — populates reference panel
- Each line renders a "+" button via [`duplicateContractLineToInvoice()`](../../frontend/src/features/invoices/components/invoices-console.tsx#L1022) to copy scope lines into the invoice workspace


## Resolved Issues (2026-03-15)

1. **balance_due reset on status-only PATCH** — Fixed: now recomputes from settled `PaymentAllocation` records instead of naively resetting to `invoice.total`.

2. **`_apply_invoice_lines_and_totals` allocation-unaware reset** — Fixed: queries settled allocations and computes `balance_due = new_total - applied_total`, clamped to 0.
