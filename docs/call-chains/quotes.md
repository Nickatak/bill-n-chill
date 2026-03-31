# Quotes Call Chains

> **Line anchors are pinned manually.** Update after refactors that move function definitions.

End-to-end function call order for each quote action. View logic lives in [`quotes.py`](../../backend/core/views/quoting/quotes.py); domain helpers in [`quotes_helpers.py`](../../backend/core/views/quoting/quotes_helpers.py).

## Load Policy Contract

Fetches the canonical quote workflow policy (statuses, transitions, quick-actions) to drive frontend UX guards. Called on console mount.

`FRONTEND` — [`QuotesConsole`](../../frontend/src/features/quotes/components/quotes-console.tsx#L333)

- [`loadQuotePolicy()`](../../frontend/src/features/quotes/components/quotes-console.tsx#L333)
  - [`fetchQuotePolicyContract({ baseUrl, token })`](../../frontend/src/features/quotes/api.ts#L25)
    - `fetch GET /contracts/quotes/`

---

`BACKEND` — [`quote_contract_view`](../../backend/core/views/quoting/quotes.py#L195)

- [`get_quote_policy_contract()`](../../backend/core/policies/__init__.py) — returns static policy dict

---

`HTTP 200` → `FRONTEND`

- `setQuoteStatuses(contract.statuses)`
- `setQuoteAllowedStatusTransitions(normalizedTransitions)`
- `setQuoteQuickActionByStatus(…)`

## Load Quotes (List)

Fetches all quotes for the selected project. Called on project selection change and after mutations.

`FRONTEND` — [`QuotesConsole`](../../frontend/src/features/quotes/components/quotes-console.tsx#L705)

- [`loadQuotes(options?)`](../../frontend/src/features/quotes/components/quotes-console.tsx#L705)
  - `fetch GET /projects/{projectId}/quotes/`

---

`BACKEND` — [`project_quotes_view`](../../backend/core/views/quoting/quotes.py#L225) (GET path)

*── org scope ──*

- [`_validate_project_for_user(project_id, request.user)`](../../backend/core/views/helpers.py#L39) — resolves membership, filters `Project` by `organization_id`

*── query ──*

- `Quote.objects.filter(project=project).prefetch_related("line_items", "line_items__cost_code").order_by("-version")`

*── serialize ──*

- [`_serialize_quotes(quotes, project)`](../../backend/core/views/quoting/quotes_helpers.py#L117)
  - `QuoteSerializer(quotes, many=True, context=context)`

---

`HTTP 200` → `FRONTEND`

- `setQuotes(rows)`
- auto-selects first visible quote matching active status filters

## Create Quote (POST)

Creates a new quote version within a title family. Includes duplicate-submit suppression and family collision detection.

`FRONTEND` — [`QuotesConsole`](../../frontend/src/features/quotes/components/quotes-console.tsx#L1007)

- [`handleCreateQuote(event)`](../../frontend/src/features/quotes/components/quotes-console.tsx#L1007)
  - client-side guards: `canMutateQuotes`, `isReadOnly`, project selected, title present, all lines have cost codes
  - if editing existing draft → routes to [Save Draft](#save-draft-patch) instead
  - if title family exists + not yet confirmed → shows collision prompt, returns
  - [`submitNewQuoteWithTitle({ projectId, title, allowExistingTitleFamily })`](../../frontend/src/features/quotes/components/quotes-console.tsx#L929)
    - `fetch POST /projects/{projectId}/quotes/`
    - body: `{ title, allow_existing_title_family, valid_through, tax_percent, line_items[] }`

---

`BACKEND` — [`project_quotes_view`](../../backend/core/views/quoting/quotes.py#L225) (POST path)

*── auth + validation ──*

- [`_capability_gate(request.user, "quotes", "create")`](../../backend/core/rbac.py#L18)
- [`QuoteWriteSerializer.is_valid()`](../../backend/core/serializers/)
- `terms_text` rejection (org-managed only)
- line items non-empty check

*── duplicate-submit suppression (5s window) ──*

- [`_line_items_signature(items)`](../../backend/core/views/quoting/quotes.py#L299) — builds tuple signature from input
- [`_quote_signature(quote)`](../../backend/core/views/quoting/quotes.py#L314) — builds tuple signature from DB
- `Quote.objects.filter(project, created_at__gte=window_start)` — scan recent
- if exact match found → return `200 { data, meta: { deduped: true } }`

*── family guards ──*

- approved family check → `409 quote_family_approved_locked`
- existing family without `allow_existing_title_family` → `409 quote_family_exists`

*── persist ──*

- [`_next_quote_family_version(project, title)`](../../backend/core/views/quoting/quotes_helpers.py#L56)
- `Quote.objects.create(…)` — version, status=draft, terms from org
- [`_apply_quote_lines_and_totals(quote, line_items, tax_percent, user)`](../../backend/core/views/quoting/quotes_helpers.py#L193)
  - [`_calculate_line_totals(line_items_data)`](../../backend/core/views/quoting/quotes_helpers.py#L163) — per-line markup math
  - [`_resolve_cost_codes_for_user(user, items)`](../../backend/core/views/helpers.py#L175) — validates cost code ownership
  - `quote.line_items.all().delete()` + `QuoteLineItem.objects.bulk_create(…)`
  - saves totals: `subtotal`, `markup_total`, `tax_total`, `grand_total`

*── audit + archive ──*

- [`QuoteStatusEvent.record(quote, from_status=None, to_status, note, changed_by)`](../../backend/core/models/quoting/)
- [`_archive_quote_family(project, user, title, exclude_ids, note)`](../../backend/core/views/quoting/quotes_helpers.py#L20)
  - archives (status→archived) all same-title siblings with allowed transitions
  - records `QuoteStatusEvent` for each archived row

---

`HTTP 201` → `FRONTEND`

- `setQuotes([created, ...current])`
- `handleSelectQuote(created)` — loads into viewer
- `setFormSuccessMessage("Created quote #X vY.")`

*── 409 quote_family_exists ──*

- `setFamilyCollisionPrompt({ title, latestQuoteId, latestVersion, familySize })`
- user confirms → re-submits with `allowExistingTitleFamily: true`

## Save Draft (PATCH)

Saves edits to an existing draft quote (title, valid_through, tax_percent, line_items).

`FRONTEND` — [`QuotesConsole`](../../frontend/src/features/quotes/components/quotes-console.tsx#L1007)

- [`handleCreateQuote(event)`](../../frontend/src/features/quotes/components/quotes-console.tsx#L1007) — `isEditingDraft && selectedQuote` branch
  - `fetch PATCH /quotes/{quoteId}/`
  - body: `{ title, valid_through, tax_percent, line_items[] }`

---

`BACKEND` — [`quote_detail_view`](../../backend/core/views/quoting/quotes.py#L466) (PATCH path, value-edit branch)

*── auth ──*

- [`_capability_gate(request.user, "quotes", "edit")`](../../backend/core/rbac.py#L18)
- [`QuoteWriteSerializer(data, partial=True).is_valid()`](../../backend/core/serializers/)

*── guards ──*

- title immutability check (title change → `400`)
- `terms_text` rejection
- draft-lock: non-draft quotes reject mutating fields (`title`, `valid_through`, `tax_percent`, `line_items`) → `400`

*── persist ──*

- field-by-field update: `title`, `valid_through`, `status`, `tax_percent`
- `quote.save(update_fields=[…])`
- if `line_items` present → [`_apply_quote_lines_and_totals(…)`](../../backend/core/views/quoting/quotes_helpers.py#L193)
- if only `tax_percent` changed → recalculates totals with existing lines

---

`HTTP 200` → `FRONTEND`

- `setQuotes(current.map(…))` — replaces updated record
- `setFormSuccessMessage("Saved draft quote #X.")`

## Status Transition (PATCH)

Applies a workflow status change (e.g. draft→sent, sent→approved, →void). Triggers side effects based on target status.

`FRONTEND` — [`QuotesConsole`](../../frontend/src/features/quotes/components/quotes-console.tsx#L1180)

- [`handleUpdateQuoteStatus()`](../../frontend/src/features/quotes/components/quotes-console.tsx#L1180)
  - `fetch PATCH /quotes/{quoteId}/`
  - body: `{ status, status_note }`

---

`BACKEND` — [`quote_detail_view`](../../backend/core/views/quoting/quotes.py#L466) (PATCH path, status branch)

*── capability gates ──*

- `sent` → [`_capability_gate(user, "quotes", "send")`](../../backend/core/rbac.py#L18)
- `approved` / `void` → [`_capability_gate(user, "quotes", "approve")`](../../backend/core/rbac.py#L18)

*── transition validation ──*

- [`Quote.is_transition_allowed(current_status, next_status)`](../../backend/core/models/quoting/) — model-level guard
- special case: `sent→sent` (resend) is allowed
- special case: same-status with `status_note` (note-only append) is allowed

*── persist + side effects ──*

- `quote.save(update_fields=["status", "updated_at"])`
- [`QuoteStatusEvent.record(…)`](../../backend/core/models/quoting/)

*── if status == sent ──*

- [`send_document_sent_email(document_type="Quote", …)`](../../backend/core/utils/email.py#L84)
  - resolves org name via `OrganizationMembership`
  - `django.core.mail.send_mail(…)` — Mailgun in prod, console in dev
  - [`EmailRecord.record(…)`](../../backend/core/models/shared_operations/email_verification.py#L137) — immutable audit

*── if status == approved ──*

- [`_activate_project_from_quote_approval(quote, actor, note)`](../../backend/core/views/quoting/quotes_helpers.py#L134)
  - prospect/on-hold → active transition

---

`HTTP 200` → `FRONTEND`

- `setQuotes(current.map(…))` — replaces updated record
- `loadStatusEvents({ quoteId, quiet: true })` — refreshes history panel

## Add Status Note (PATCH)

Appends a note to the status history without changing the quote's status.

`FRONTEND` — [`QuotesConsole`](../../frontend/src/features/quotes/components/quotes-console.tsx#L1231)

- [`handleAddQuoteStatusNote()`](../../frontend/src/features/quotes/components/quotes-console.tsx#L1231)
  - `fetch PATCH /quotes/{quoteId}/`
  - body: `{ status_note }` (no `status` field)

---

`BACKEND` — [`quote_detail_view`](../../backend/core/views/quoting/quotes.py#L466) (PATCH path)

- same view, `same_status_note_request` branch
- [`QuoteStatusEvent.record(from_status=current, to_status=current, note=status_note)`](../../backend/core/models/quoting/)

---

`HTTP 200` → `FRONTEND`

- `loadStatusEvents(…)` — refreshes history

## Load Status Events

Fetches the immutable status transition history for an quote.

`FRONTEND` — [`QuotesConsole`](../../frontend/src/features/quotes/components/quotes-console.tsx#L1316)

- [`loadStatusEvents(options?)`](../../frontend/src/features/quotes/components/quotes-console.tsx#L1316)
  - `fetch GET /quotes/{quoteId}/status-events/`

---

`BACKEND` — [`quote_status_events_view`](../../backend/core/views/quoting/quotes.py#L905)

- [`_validate_quote_for_user(quote_id, request.user)`](../../backend/core/views/helpers.py#L51) — resolves membership, filters `Quote` by `project__organization_id`
- `QuoteStatusEvent.objects.filter(quote=quote).select_related(…)`
- `QuoteStatusEventSerializer(events, many=True)`

---

`HTTP 200` → `FRONTEND`

- `setStatusEvents(rows)`

## Clone Revision

Creates a new draft from an existing sent/rejected/voided/archived quote in the same title family. If source was `sent`, auto-rejects it.

`FRONTEND` — [`QuotesConsole`](../../frontend/src/features/quotes/components/quotes-console.tsx#L375)

- [`cloneQuoteRevision(sourceQuote)`](../../frontend/src/features/quotes/components/quotes-console.tsx#L375)
  - `fetch POST /quotes/{quoteId}/clone-version/`

---

`BACKEND` — [`quote_clone_version_view`](../../backend/core/views/quoting/quotes.py#L703)

*── auth + guards ──*

- [`_capability_gate(request.user, "quotes", "create")`](../../backend/core/rbac.py#L18)
- status guard: source must be `sent`, `rejected`, `void`, or `archived`

*── persist ──*

- [`_next_quote_family_version(project, title)`](../../backend/core/views/quoting/quotes_helpers.py#L56)
- `Quote.objects.create(…)` — same title/terms/tax, new version, status=draft
- line items copied as dicts → [`_apply_quote_lines_and_totals(…)`](../../backend/core/views/quoting/quotes_helpers.py#L193)

*── audit ──*

- [`QuoteStatusEvent.record(cloned, from_status=None, to_status=draft, note="Cloned from…")`](../../backend/core/models/quoting/)

*── auto-reject source (if sent) ──*

- `quote.status = REJECTED` + `quote.save(…)`
- [`QuoteStatusEvent.record(quote, from_status=SENT, to_status=REJECTED, note="Auto-rejected…")`](../../backend/core/models/quoting/)

---

`HTTP 201` → `FRONTEND`

- `setQuotes([cloned, ...updated])` — prepends clone, marks source as rejected if applicable
- `handleSelectQuote(cloned)`

## Duplicate Quote

Duplicates an quote into a new draft with a different title (or different project). Starts a new family.

`FRONTEND` — [`QuotesConsole`](../../frontend/src/features/quotes/components/quotes-console.tsx#L1134)

- [`handleDuplicateQuote()`](../../frontend/src/features/quotes/components/quotes-console.tsx#L1134)
  - `fetch POST /quotes/{quoteId}/duplicate/`
  - body: `{ title, project_id? }`

---

`BACKEND` — [`quote_duplicate_view`](../../backend/core/views/quoting/quotes.py#L801)

*── auth + validation ──*

- [`_capability_gate(request.user, "quotes", "create")`](../../backend/core/rbac.py#L18)
- [`QuoteDuplicateSerializer.is_valid()`](../../backend/core/serializers/)
- same-project + same-title guard → `400` ("use clone version instead")
- target project validation via [`_validate_project_for_user(…)`](../../backend/core/views/helpers.py#L39) — filters by `organization_id`

*── persist ──*

- [`_next_quote_family_version(target_project, target_title)`](../../backend/core/views/quoting/quotes_helpers.py#L56)
- `Quote.objects.create(…)` — target project/title, status=draft
- line items copied → [`_apply_quote_lines_and_totals(…)`](../../backend/core/views/quoting/quotes_helpers.py#L193)
- [`QuoteStatusEvent.record(duplicated, note="Duplicated from…")`](../../backend/core/models/quoting/)

---

`HTTP 201` → `FRONTEND`

- if same project: `setQuotes([duplicated, ...current])`
- if different project: `setSelectedProjectId(…)` — triggers project switch + reload
- `handleSelectQuote(duplicated)`

## Public Quote Detail

Public (unauthenticated) endpoint for customer quote review. Served at `/quote/{publicRef}`.

`FRONTEND` — [`QuoteApprovalPreview`](../../frontend/src/features/quotes/components/quote-approval-preview.tsx#L51)

- `useEffect` on mount
  - `fetch GET /public/quotes/{publicToken}/`

---

`BACKEND` — [`public_quote_detail_view`](../../backend/core/views/quoting/quotes.py#L50)

- `Quote.objects.select_related("project__customer", "created_by").prefetch_related("line_items", "line_items__cost_code").get(public_token=…)`
- `QuoteSerializer(quote)`
- [`_resolve_organization_for_public_actor(quote.created_by)`](../../backend/core/views/helpers.py#L66)
- [`_serialize_public_project_context(quote.project)`](../../backend/core/views/helpers.py#L108)
- [`_serialize_public_organization_context(organization)`](../../backend/core/views/helpers.py#L84)
- [`get_ceremony_context()`](../../backend/core/views/public_signing_helpers.py#L237) — consent text + version

---

`HTTP 200` → `FRONTEND`

- `setQuote(nextQuote)` — renders document viewer with approve/reject controls if `status === "sent"`

## Public OTP Request

Customer requests an OTP code to verify their identity before making a decision.

`FRONTEND` — (signing ceremony component)

- `fetch POST /public/quotes/{publicToken}/otp/`

---

`BACKEND` — [`public_quote_request_otp_view`](../../backend/core/urls.py#L217)

- delegates to [`_request_otp_handler(request, "quote", public_token)`](../../backend/core/views/public_signing_helpers.py#L85)
  - [`_resolve_document_and_email("quote", public_token)`](../../backend/core/views/public_signing_helpers.py#L47)
  - rate limit: 60s between OTP requests per public_token
  - `DocumentAccessSession(…).save()` — generates 6-digit code
  - [`send_otp_email(recipient_email, code, "Quote", document_title)`](../../backend/core/utils/email.py#L49)

---

`HTTP 200` → `FRONTEND`

- `{ data: { otp_required: true, email_hint: "n***@example.com", expires_in: 600 } }`

## Public OTP Verify

Customer submits the 6-digit OTP code to activate their session.

`FRONTEND` — (signing ceremony component)

- `fetch POST /public/quotes/{publicToken}/otp/verify/`
- body: `{ code }`

---

`BACKEND` — [`public_quote_verify_otp_view`](../../backend/core/urls.py#L222)

- delegates to [`_verify_otp_handler(request, "quote", public_token)`](../../backend/core/views/public_signing_helpers.py#L154)
  - [`DocumentAccessSession.lookup_for_verification(public_token, code)`](../../backend/core/models/shared_operations/document_access_session.py) — brute-force protected (max attempts)
  - `session.verified_at = now`, `session.session_expires_at = now + 60min`

---

`HTTP 200` → `FRONTEND`

- `{ data: { session_token, expires_in: 3600 } }`

## Public Decision (Approve / Reject)

Customer submits their approve/reject decision through the public share link, with signing ceremony data.

`FRONTEND` — [`QuoteApprovalPreview`](../../frontend/src/features/quotes/components/quote-approval-preview.tsx#L130)

- [`applyDecision(decision, ceremony)`](../../frontend/src/features/quotes/components/quote-approval-preview.tsx#L130)
  - `fetch POST /public/quotes/{publicToken}/decision/`
  - body: `{ decision, note, session_token, signer_name, consent_accepted }`

---

`BACKEND` — [`public_quote_decision_view`](../../backend/core/views/quoting/quotes.py#L76)

*── validation ──*

- quote must exist + `status === "sent"`
- decision must be `"approve"` or `"reject"`

*── ceremony validation ──*

- [`validate_ceremony_on_decision(request, public_token, customer_email)`](../../backend/core/views/public_signing_helpers.py#L187)
  - session token lookup via [`DocumentAccessSession.lookup_valid_session(…)`](../../backend/core/models/shared_operations/document_access_session.py)
  - `signer_name` required, `consent_accepted` must be `true`
- [`_build_public_decision_note(…)`](../../backend/core/views/helpers.py#L151) — formats note with signer info

*── atomic: status + audit + ceremony record ──*

- `transaction.atomic():`
  - `quote.status = next_status` + `quote.save(…)`
  - [`QuoteStatusEvent.record(…)`](../../backend/core/models/quoting/)
  - *── if approved ──*
  - [`_activate_project_from_quote_approval(…)`](../../backend/core/views/quoting/quotes_helpers.py#L134)
  - *── signing ceremony record ──*
  - [`compute_document_content_hash("quote", serialized)`](../../backend/core/utils/signing.py)
  - [`SigningCeremonyRecord.record(…)`](../../backend/core/models/) — document_type, decision, signer info, IP, user agent, consent snapshot, content hash

*── serialize response ──*

- [`_serialize_quote(quote)`](../../backend/core/views/quoting/quotes_helpers.py#L111)
- [`_serialize_public_project_context(…)`](../../backend/core/views/helpers.py#L108)
- [`_serialize_public_organization_context(…)`](../../backend/core/views/helpers.py#L84)

---

`HTTP 200` → `FRONTEND`

- `setQuote(nextQuote)` — re-renders with decision stamp (approved/rejected)
- `setDecisionReceiptName(ceremony.signer_name)`

## Route Summary

| Route | Method | View | Auth |
|---|---|---|---|
| `/contracts/quotes/` | GET | `quote_contract_view` | Token |
| `/projects/{id}/quotes/` | GET | `project_quotes_view` | Token |
| `/projects/{id}/quotes/` | POST | `project_quotes_view` | Token + `quotes.create` |
| `/quotes/{id}/` | GET | `quote_detail_view` | Token |
| `/quotes/{id}/` | PATCH | `quote_detail_view` | Token + `quotes.edit` (+ `send`/`approve` for transitions) |
| `/quotes/{id}/status-events/` | GET | `quote_status_events_view` | Token |
| `/quotes/{id}/clone-version/` | POST | `quote_clone_version_view` | Token + `quotes.create` |
| `/quotes/{id}/duplicate/` | POST | `quote_duplicate_view` | Token + `quotes.create` |
| `/public/quotes/{token}/` | GET | `public_quote_detail_view` | None |
| `/public/quotes/{token}/otp/` | POST | `public_quote_request_otp_view` | None |
| `/public/quotes/{token}/otp/verify/` | POST | `public_quote_verify_otp_view` | None |
| `/public/quotes/{token}/decision/` | POST | `public_quote_decision_view` | OTP session |
