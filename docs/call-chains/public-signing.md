# Public Signing Call Chains

> **Line anchors are pinned manually.** Update after refactors that move function definitions.

OTP-verified e-sign ceremony for public document approval links — estimates, change orders, invoices.

## Key Source Files

| Layer | File | Purpose |
|-------|------|---------|
| Frontend | [`shared/document-viewer/signing-ceremony.tsx`](../../frontend/src/shared/document-viewer/signing-ceremony.tsx) | Shared ceremony component (OTP + consent + decision) |
| Frontend | [`features/estimates/components/estimate-approval-preview.tsx`](../../frontend/src/features/estimates/components/estimate-approval-preview.tsx) | Estimate public preview page |
| Frontend | [`features/change-orders/components/change-order-public-preview.tsx`](../../frontend/src/features/change-orders/components/change-order-public-preview.tsx) | Change order public preview page |
| Frontend | [`features/invoices/components/invoice-public-preview.tsx`](../../frontend/src/features/invoices/components/invoice-public-preview.tsx) | Invoice public preview page |
| Backend | [`views/public_signing.py`](../../backend/core/views/public_signing.py) | Thin OTP endpoint wrappers |
| Backend | [`views/public_signing_helpers.py`](../../backend/core/views/public_signing_helpers.py) | OTP handlers + ceremony validation |
| Backend | [`views/estimating/estimates.py`](../../backend/core/views/estimating/estimates.py) | Estimate decision view |
| Backend | [`views/change_orders/change_orders.py`](../../backend/core/views/change_orders/change_orders.py) | Change order decision view |
| Backend | [`views/accounts_receivable/invoices.py`](../../backend/core/views/accounts_receivable/invoices.py) | Invoice decision view |
| Backend | [`utils/signing.py`](../../backend/core/utils/signing.py) | Content hashing, consent text, email masking |
| Backend | [`utils/email.py`](../../backend/core/utils/email.py) | OTP email sender |
| Backend | [`models/shared_operations/document_access_session.py`](../../backend/core/models/shared_operations/document_access_session.py) | OTP + session lifecycle model |
| Backend | [`models/shared_operations/signing_ceremony.py`](../../backend/core/models/shared_operations/signing_ceremony.py) | Immutable audit artifact |

---

## 1. Request OTP

Customer clicks "Send verification code" in the signing ceremony panel.

`FRONTEND` — [`SigningCeremony`](../../frontend/src/shared/document-viewer/signing-ceremony.tsx#L77)
- [`requestOtp()`](../../frontend/src/shared/document-viewer/signing-ceremony.tsx#L131)
  - `fetch POST /api/v1/public/{docType}/{publicToken}/otp/`

---

`BACKEND` — thin view wrapper (one per document type):
- [`public_estimate_request_otp_view`](../../backend/core/views/public_signing.py#L20)
- [`public_change_order_request_otp_view`](../../backend/core/views/public_signing.py#L39)
- [`public_invoice_request_otp_view`](../../backend/core/views/public_signing.py#L58)

Each delegates to [`_request_otp_handler(request, document_type, public_token)`](../../backend/core/views/public_signing_helpers.py#L85):

*── resolve document ──*

- [`_resolve_document_and_email(document_type, public_token)`](../../backend/core/views/public_signing_helpers.py#L47)
  - `Model.objects.select_related("project__customer").get(public_token=...)`
  - Extracts `project.customer.email`
  - No email → **422** `customer_email_required`
  - Document not found → **404**

*── rate limit ──*

- `DocumentAccessSession.objects.filter(public_token=...).order_by("-created_at").first()`
- Most recent session created <60s ago → **429** `rate_limited`

*── create session + send email ──*

- `DocumentAccessSession(document_type, document_id, public_token, recipient_email)` → `.save()`
  - [`save()`](../../backend/core/models/shared_operations/document_access_session.py#L44) auto-generates:
    - 6-digit OTP code via [`_generate_unique_code()`](../../backend/core/models/shared_operations/document_access_session.py#L54) (collision-checked against unexpired codes)
    - `session_token` via `secrets.token_urlsafe(32)`
    - `expires_at` = now + 10 minutes
- [`send_otp_email(recipient_email, code, type_label, title)`](../../backend/core/utils/email.py#L45)
  - Sends email with 6-digit code + document context
  - `EmailRecord.record(type=EmailType.OTP, ...)`

---

`HTTP 200` → `FRONTEND`

- Response: `{ "data": { "otp_required": true, "email_hint": "o***@example.com", "expires_in": 600 } }`
- [`mask_email()`](../../backend/core/utils/signing.py#L99) produces the hint (first char + `***` + domain)
- UI transitions to `otp_requested` phase — shows code input + masked email hint

---

## 2. Verify OTP

Customer enters 6-digit code and clicks "Verify Code".

`FRONTEND` — [`SigningCeremony`](../../frontend/src/shared/document-viewer/signing-ceremony.tsx#L77)
- [`verifyOtp()`](../../frontend/src/shared/document-viewer/signing-ceremony.tsx#L165)
  - `fetch POST /api/v1/public/{docType}/{publicToken}/otp/verify/`
  - Body: `{ "code": "123456" }`

---

`BACKEND` — thin view wrapper:
- [`public_estimate_verify_otp_view`](../../backend/core/views/public_signing.py#L27)
- [`public_change_order_verify_otp_view`](../../backend/core/views/public_signing.py#L46)
- [`public_invoice_verify_otp_view`](../../backend/core/views/public_signing.py#L65)

Each delegates to [`_verify_otp_handler(request, document_type, public_token)`](../../backend/core/views/public_signing_helpers.py#L151):

*── validate code ──*

- Empty code → **400** `validation_error`
- [`DocumentAccessSession.lookup_for_verification(public_token, code)`](../../backend/core/models/shared_operations/document_access_session.py#L91)
  - Finds unverified session matching `(public_token, code)`
  - Not found → checks if already verified → **409** `already_verified` or **404** `not_found`
  - Found but expired → **410** `expired`

*── activate session ──*

- Sets `verified_at = now()`
- Sets `session_expires_at = now() + 60 minutes`
- `session.save(update_fields=["verified_at", "session_expires_at"])`

---

`HTTP 200` → `FRONTEND`

- Response: `{ "data": { "session_token": "...", "expires_in": 3600 } }`
- UI transitions to `ceremony_ready` phase — shows document summary, name field, consent checkbox, action buttons
- `session_token` stored in component state for decision submission

---

## 3. Submit Decision (Estimate — Approve/Reject)

Customer types name, checks consent, clicks "Approve Estimate" or "Reject Estimate".

`FRONTEND` — [`SigningCeremony`](../../frontend/src/shared/document-viewer/signing-ceremony.tsx#L77) calls `onDecision(decision, ceremonyPayload)`

→ [`EstimateApprovalPreview`](../../frontend/src/features/estimates/components/estimate-approval-preview.tsx#L41)
- [`applyDecision(decision, ceremony)`](../../frontend/src/features/estimates/components/estimate-approval-preview.tsx#L130)
  - `fetch POST /api/v1/public/estimates/{publicToken}/decision/`
  - Body: `{ decision, note, session_token, signer_name, consent_accepted }`

---

`BACKEND` — [`public_estimate_decision_view`](../../backend/core/views/estimating/estimates.py#L71)

*── lookup + status guard ──*

- `Estimate.objects.select_related(...).prefetch_related(...).get(public_token=...)`
- Not `sent` status → **409** `conflict`
- Invalid decision value → **400** `validation_error`

*── ceremony validation ──*

- [`validate_ceremony_on_decision(request, public_token, customer_email)`](../../backend/core/views/public_signing_helpers.py#L184)
  - No customer email → **422** `customer_email_required`
  - Missing `session_token` → **403** `session_required`
  - [`DocumentAccessSession.lookup_valid_session(public_token, session_token)`](../../backend/core/models/shared_operations/document_access_session.py#L113)
    - Not found → **403** `session_invalid`
    - Expired → **403** `session_expired`
  - Missing `signer_name` → **400** `validation_error`
  - `consent_accepted` not `true` → **400** `validation_error`
  - Returns `(session, signer_name, None)`

*── build audit note ──*

- [`_build_public_decision_note(action_label, note, decider_name, decider_email)`](../../backend/core/views/helpers.py#L136)
  - Uses verified `signer_name` + `session.recipient_email` (not self-reported)

*── persist decision (atomic) ──*

- `transaction.atomic():`
  - Approve: `estimate.status = APPROVED`, `estimate.save()`
    - `EstimateStatusEvent.record(from=SENT, to=APPROVED, note=...)`
    - Auto-activates project if PROSPECT → ACTIVE
  - Reject: `estimate.status = REJECTED`, `estimate.save()`
    - `EstimateStatusEvent.record(from=SENT, to=REJECTED, note=...)`

*── signing ceremony artifact ──*

- [`get_ceremony_context()`](../../backend/core/views/public_signing_helpers.py#L234) → `(consent_text, consent_version)`
- [`compute_document_content_hash("estimate", serialized_data)`](../../backend/core/utils/signing.py#L55)
  - Extracts: title, version, tax_percent, terms_text, line_items (description, quantity, unit_cost, markup_percent, cost_code, unit)
  - JSON-serializes with sorted keys → SHA-256
- [`SigningCeremonyRecord.record(...)`](../../backend/core/models/shared_operations/signing_ceremony.py#L55)
  - Immutable record: document_type, document_id, public_token, decision, signer_name, signer_email, content_hash, ip_address, user_agent, consent_text_version, consent_text_snapshot, access_session FK

---

`HTTP 200` → `FRONTEND`

- Response: `{ "data": { ...refreshed estimate... } }`
- `setEstimate(nextEstimate)` — re-renders with new status
- Decision stamp flashes in via `sheetFlash` animation
- `canDecide` becomes `false` → ceremony section replaced by stamp

---

## 4. Submit Decision (Change Order — Approve/Reject)

Same ceremony flow. Different document type and decision side effects.

`FRONTEND` — [`ChangeOrderPublicPreview`](../../frontend/src/features/change-orders/components/change-order-public-preview.tsx#L58)
- [`applyDecision(decision, ceremony)`](../../frontend/src/features/change-orders/components/change-order-public-preview.tsx#L130)
  - `fetch POST /api/v1/public/change-orders/{publicToken}/decision/`

---

`BACKEND` — [`public_change_order_decision_view`](../../backend/core/views/change_orders/change_orders.py#L76)

*── ceremony validation ──*

- Same as estimate: [`validate_ceremony_on_decision()`](../../backend/core/views/public_signing_helpers.py#L184)

*── persist decision (atomic) ──*

- Approve:
  - `change_order.status = APPROVED`, sets `approved_by`, `approved_at`
  - Updates `project.contract_value_current`
- Reject:
  - `change_order.status = REJECTED`

*── signing ceremony artifact ──*

- Content hash fields: family_key, revision_number, reason, amount_delta, terms_text, line_items (description, amount_delta, line_type, adjustment_reason)
- `SigningCeremonyRecord.record(...)`

---

## 5. Submit Decision (Invoice — Approve/Dispute)

`FRONTEND` — [`InvoicePublicPreview`](../../frontend/src/features/invoices/components/invoice-public-preview.tsx#L51)
- [`applyDecision(decision, ceremony)`](../../frontend/src/features/invoices/components/invoice-public-preview.tsx#L135)
  - `fetch POST /api/v1/public/invoices/{publicToken}/decision/`

---

`BACKEND` — [`public_invoice_decision_view`](../../backend/core/views/accounts_receivable/invoices.py#L80)

*── ceremony validation ──*

- Same pattern: [`validate_ceremony_on_decision()`](../../backend/core/views/public_signing_helpers.py#L184)

*── persist decision (atomic) ──*

- Approve (`approve`/`pay`):
  - `invoice.status = PAID`, `balance_due = 0`
  - `InvoiceStatusEvent.record(from=SENT, to=PAID, ...)`
- Dispute (`dispute`/`reject`):
  - Status unchanged — records notation event
  - `InvoiceStatusEvent.record(from=SENT, to=SENT, note=...)`

*── signing ceremony artifact ──*

- Content hash fields: invoice_number, total, balance_due, tax_percent, terms_text, line_items (description, quantity, unit_price, cost_code, unit, line_type)
- `SigningCeremonyRecord.record(...)`

---

## Data Flow Summary

```
Customer visits public link
  ↓
Document renders read-only (no auth change)
  ↓
"Send verification code" → POST /otp/
  ↓
Backend: resolve document → extract customer email → rate limit check → create DocumentAccessSession → send OTP email
  ↓
Customer enters 6-digit code → POST /otp/verify/
  ↓
Backend: lookup session by (public_token, code) → verify → activate session (1hr) → return session_token
  ↓
Ceremony UI appears: document summary + name field + consent checkbox + decision buttons
  ↓
Customer submits decision → POST /decision/
  ↓
Backend: validate session_token → validate signer_name + consent → run decision logic → create SigningCeremonyRecord
  ↓
Frontend: re-render with new status + decision stamp
```

## Error Paths

| Scenario | Status | Code | Where |
|----------|--------|------|-------|
| No customer email on file | 422 | `customer_email_required` | OTP request or decision |
| OTP requested <60s ago | 429 | `rate_limited` | OTP request |
| Wrong OTP code | 404 | `not_found` | OTP verify |
| Expired OTP code (>10 min) | 410 | `expired` | OTP verify |
| Code already verified | 409 | `already_verified` | OTP verify |
| Missing session_token on decision | 403 | `session_required` | Decision |
| Invalid/unknown session_token | 403 | `session_invalid` | Decision |
| Expired session (>1 hr) | 403 | `session_expired` | Decision |
| Missing signer_name | 400 | `validation_error` | Decision |
| consent_accepted not true | 400 | `validation_error` | Decision |
| Document not in decidable status | 409 | `conflict` | Decision |

## Audit Artifact: SigningCeremonyRecord

Immutable (`ImmutableModelMixin`) — cannot be updated or deleted after creation.

| Field | Source |
|-------|--------|
| `signer_name` | Typed by customer in ceremony |
| `signer_email` | From `DocumentAccessSession.recipient_email` (= customer email on file) |
| `email_verified` | Always `true` (OTP required) |
| `content_hash` | SHA-256 of content-relevant fields at signing time |
| `ip_address` | `request.META["REMOTE_ADDR"]` |
| `user_agent` | `request.META["HTTP_USER_AGENT"]` |
| `consent_text_snapshot` | Full consent text shown to customer |
| `consent_text_version` | SHA-256 of consent text (tracks language changes) |
| `access_session` | FK to `DocumentAccessSession` (SET_NULL) |
| `ceremony_completed_at` | `timezone.now()` at creation |

> **[DRAFT]** All consent language is placeholder requiring attorney review before production use.
