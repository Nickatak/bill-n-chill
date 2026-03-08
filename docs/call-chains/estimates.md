# Estimates Call Chains

> **Line anchors are pinned manually.** Update after refactors that move function definitions.

End-to-end function call order for each estimate action. View logic lives in [`estimates.py`](../../backend/core/views/estimating/estimates.py); domain helpers in [`estimates_helpers.py`](../../backend/core/views/estimating/estimates_helpers.py).

## Load Policy Contract

Fetches the canonical estimate workflow policy (statuses, transitions, quick-actions) to drive frontend UX guards. Called on console mount.

`FRONTEND` — [`EstimatesConsole`](../../frontend/src/features/estimates/components/estimates-console.tsx#L333)

- [`loadEstimatePolicy()`](../../frontend/src/features/estimates/components/estimates-console.tsx#L333)
  - [`fetchEstimatePolicyContract({ baseUrl, token })`](../../frontend/src/features/estimates/api.ts#L25)
    - `fetch GET /contracts/estimates/`

---

`BACKEND` — [`estimate_contract_view`](../../backend/core/views/estimating/estimates.py#L195)

- [`get_estimate_policy_contract()`](../../backend/core/policies/__init__.py) — returns static policy dict

---

`HTTP 200` → `FRONTEND`

- `setEstimateStatuses(contract.statuses)`
- `setEstimateAllowedStatusTransitions(normalizedTransitions)`
- `setEstimateQuickActionByStatus(…)`

## Load Estimates (List)

Fetches all estimates for the selected project. Called on project selection change and after mutations.

`FRONTEND` — [`EstimatesConsole`](../../frontend/src/features/estimates/components/estimates-console.tsx#L705)

- [`loadEstimates(options?)`](../../frontend/src/features/estimates/components/estimates-console.tsx#L705)
  - `fetch GET /projects/{projectId}/estimates/`

---

`BACKEND` — [`project_estimates_view`](../../backend/core/views/estimating/estimates.py#L225) (GET path)

*── org scope ──*

- [`_validate_project_for_user(project_id, request.user)`](../../backend/core/views/helpers.py#L39) — resolves membership, filters `Project` by `organization_id`

*── query ──*

- `Estimate.objects.filter(project=project).prefetch_related("line_items", "line_items__cost_code").order_by("-version")`

*── serialize ──*

- [`_serialize_estimates(estimates, project)`](../../backend/core/views/estimating/estimates_helpers.py#L117)
  - `EstimateSerializer(estimates, many=True, context=context)`

---

`HTTP 200` → `FRONTEND`

- `setEstimates(rows)`
- auto-selects first visible estimate matching active status filters

## Create Estimate (POST)

Creates a new estimate version within a title family. Includes duplicate-submit suppression and family collision detection.

`FRONTEND` — [`EstimatesConsole`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1007)

- [`handleCreateEstimate(event)`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1007)
  - client-side guards: `canMutateEstimates`, `isReadOnly`, project selected, title present, all lines have cost codes
  - if editing existing draft → routes to [Save Draft](#save-draft-patch) instead
  - if title family exists + not yet confirmed → shows collision prompt, returns
  - [`submitNewEstimateWithTitle({ projectId, title, allowExistingTitleFamily })`](../../frontend/src/features/estimates/components/estimates-console.tsx#L929)
    - `fetch POST /projects/{projectId}/estimates/`
    - body: `{ title, allow_existing_title_family, valid_through, tax_percent, line_items[] }`

---

`BACKEND` — [`project_estimates_view`](../../backend/core/views/estimating/estimates.py#L225) (POST path)

*── auth + validation ──*

- [`_capability_gate(request.user, "estimates", "create")`](../../backend/core/rbac.py#L18)
- [`EstimateWriteSerializer.is_valid()`](../../backend/core/serializers/)
- `terms_text` rejection (org-managed only)
- line items non-empty check

*── duplicate-submit suppression (5s window) ──*

- [`_line_items_signature(items)`](../../backend/core/views/estimating/estimates.py#L299) — builds tuple signature from input
- [`_estimate_signature(estimate)`](../../backend/core/views/estimating/estimates.py#L314) — builds tuple signature from DB
- `Estimate.objects.filter(project, created_at__gte=window_start)` — scan recent
- if exact match found → return `200 { data, meta: { deduped: true } }`

*── family guards ──*

- approved family check → `409 estimate_family_approved_locked`
- existing family without `allow_existing_title_family` → `409 estimate_family_exists`

*── persist ──*

- [`_next_estimate_family_version(project, title)`](../../backend/core/views/estimating/estimates_helpers.py#L56)
- `Estimate.objects.create(…)` — version, status=draft, terms from org
- [`_apply_estimate_lines_and_totals(estimate, line_items, tax_percent, user)`](../../backend/core/views/estimating/estimates_helpers.py#L193)
  - [`_calculate_line_totals(line_items_data)`](../../backend/core/views/estimating/estimates_helpers.py#L163) — per-line markup math
  - [`_resolve_cost_codes_for_user(user, items)`](../../backend/core/views/helpers.py#L175) — validates cost code ownership
  - `estimate.line_items.all().delete()` + `EstimateLineItem.objects.bulk_create(…)`
  - saves totals: `subtotal`, `markup_total`, `tax_total`, `grand_total`

*── audit + archive ──*

- [`EstimateStatusEvent.record(estimate, from_status=None, to_status, note, changed_by)`](../../backend/core/models/estimating/)
- [`_archive_estimate_family(project, user, title, exclude_ids, note)`](../../backend/core/views/estimating/estimates_helpers.py#L20)
  - archives (status→archived) all same-title siblings with allowed transitions
  - records `EstimateStatusEvent` for each archived row

---

`HTTP 201` → `FRONTEND`

- `setEstimates([created, ...current])`
- `handleSelectEstimate(created)` — loads into viewer
- `setFormSuccessMessage("Created estimate #X vY.")`

*── 409 estimate_family_exists ──*

- `setFamilyCollisionPrompt({ title, latestEstimateId, latestVersion, familySize })`
- user confirms → re-submits with `allowExistingTitleFamily: true`

## Save Draft (PATCH)

Saves edits to an existing draft estimate (title, valid_through, tax_percent, line_items).

`FRONTEND` — [`EstimatesConsole`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1007)

- [`handleCreateEstimate(event)`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1007) — `isEditingDraft && selectedEstimate` branch
  - `fetch PATCH /estimates/{estimateId}/`
  - body: `{ title, valid_through, tax_percent, line_items[] }`

---

`BACKEND` — [`estimate_detail_view`](../../backend/core/views/estimating/estimates.py#L466) (PATCH path, value-edit branch)

*── auth ──*

- [`_capability_gate(request.user, "estimates", "edit")`](../../backend/core/rbac.py#L18)
- [`EstimateWriteSerializer(data, partial=True).is_valid()`](../../backend/core/serializers/)

*── guards ──*

- title immutability check (title change → `400`)
- `terms_text` rejection
- draft-lock: non-draft estimates reject mutating fields (`title`, `valid_through`, `tax_percent`, `line_items`) → `400`

*── persist ──*

- field-by-field update: `title`, `valid_through`, `status`, `tax_percent`
- `estimate.save(update_fields=[…])`
- if `line_items` present → [`_apply_estimate_lines_and_totals(…)`](../../backend/core/views/estimating/estimates_helpers.py#L193)
- if only `tax_percent` changed → recalculates totals with existing lines

---

`HTTP 200` → `FRONTEND`

- `setEstimates(current.map(…))` — replaces updated record
- `setFormSuccessMessage("Saved draft estimate #X.")`

## Status Transition (PATCH)

Applies a workflow status change (e.g. draft→sent, sent→approved, →void). Triggers side effects based on target status.

`FRONTEND` — [`EstimatesConsole`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1180)

- [`handleUpdateEstimateStatus()`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1180)
  - `fetch PATCH /estimates/{estimateId}/`
  - body: `{ status, status_note }`

---

`BACKEND` — [`estimate_detail_view`](../../backend/core/views/estimating/estimates.py#L466) (PATCH path, status branch)

*── capability gates ──*

- `sent` → [`_capability_gate(user, "estimates", "send")`](../../backend/core/rbac.py#L18)
- `approved` / `void` → [`_capability_gate(user, "estimates", "approve")`](../../backend/core/rbac.py#L18)

*── transition validation ──*

- [`Estimate.is_transition_allowed(current_status, next_status)`](../../backend/core/models/estimating/) — model-level guard
- special case: `sent→sent` (resend) is allowed
- special case: same-status with `status_note` (note-only append) is allowed

*── persist + side effects ──*

- `estimate.save(update_fields=["status", "updated_at"])`
- [`EstimateStatusEvent.record(…)`](../../backend/core/models/estimating/)

*── if status == sent ──*

- [`send_document_sent_email(document_type="Estimate", …)`](../../backend/core/utils/email.py#L84)
  - resolves org name via `OrganizationMembership`
  - `django.core.mail.send_mail(…)` — Mailgun in prod, console in dev
  - [`EmailRecord.record(…)`](../../backend/core/models/shared_operations/email_verification.py#L137) — immutable audit

*── if status == approved ──*

- [`_activate_project_from_estimate_approval(estimate, actor, note)`](../../backend/core/views/estimating/estimates_helpers.py#L134)
  - prospect/on-hold → active transition

---

`HTTP 200` → `FRONTEND`

- `setEstimates(current.map(…))` — replaces updated record
- `loadStatusEvents({ estimateId, quiet: true })` — refreshes history panel

## Add Status Note (PATCH)

Appends a note to the status history without changing the estimate's status.

`FRONTEND` — [`EstimatesConsole`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1231)

- [`handleAddEstimateStatusNote()`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1231)
  - `fetch PATCH /estimates/{estimateId}/`
  - body: `{ status_note }` (no `status` field)

---

`BACKEND` — [`estimate_detail_view`](../../backend/core/views/estimating/estimates.py#L466) (PATCH path)

- same view, `same_status_note_request` branch
- [`EstimateStatusEvent.record(from_status=current, to_status=current, note=status_note)`](../../backend/core/models/estimating/)

---

`HTTP 200` → `FRONTEND`

- `loadStatusEvents(…)` — refreshes history

## Load Status Events

Fetches the immutable status transition history for an estimate.

`FRONTEND` — [`EstimatesConsole`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1316)

- [`loadStatusEvents(options?)`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1316)
  - `fetch GET /estimates/{estimateId}/status-events/`

---

`BACKEND` — [`estimate_status_events_view`](../../backend/core/views/estimating/estimates.py#L905)

- [`_validate_estimate_for_user(estimate_id, request.user)`](../../backend/core/views/helpers.py#L51) — resolves membership, filters `Estimate` by `project__organization_id`
- `EstimateStatusEvent.objects.filter(estimate=estimate).select_related(…)`
- `EstimateStatusEventSerializer(events, many=True)`

---

`HTTP 200` → `FRONTEND`

- `setStatusEvents(rows)`

## Clone Revision

Creates a new draft from an existing sent/rejected/voided/archived estimate in the same title family. If source was `sent`, auto-rejects it.

`FRONTEND` — [`EstimatesConsole`](../../frontend/src/features/estimates/components/estimates-console.tsx#L375)

- [`cloneEstimateRevision(sourceEstimate)`](../../frontend/src/features/estimates/components/estimates-console.tsx#L375)
  - `fetch POST /estimates/{estimateId}/clone-version/`

---

`BACKEND` — [`estimate_clone_version_view`](../../backend/core/views/estimating/estimates.py#L703)

*── auth + guards ──*

- [`_capability_gate(request.user, "estimates", "create")`](../../backend/core/rbac.py#L18)
- status guard: source must be `sent`, `rejected`, `void`, or `archived`

*── persist ──*

- [`_next_estimate_family_version(project, title)`](../../backend/core/views/estimating/estimates_helpers.py#L56)
- `Estimate.objects.create(…)` — same title/terms/tax, new version, status=draft
- line items copied as dicts → [`_apply_estimate_lines_and_totals(…)`](../../backend/core/views/estimating/estimates_helpers.py#L193)

*── audit ──*

- [`EstimateStatusEvent.record(cloned, from_status=None, to_status=draft, note="Cloned from…")`](../../backend/core/models/estimating/)

*── auto-reject source (if sent) ──*

- `estimate.status = REJECTED` + `estimate.save(…)`
- [`EstimateStatusEvent.record(estimate, from_status=SENT, to_status=REJECTED, note="Auto-rejected…")`](../../backend/core/models/estimating/)

---

`HTTP 201` → `FRONTEND`

- `setEstimates([cloned, ...updated])` — prepends clone, marks source as rejected if applicable
- `handleSelectEstimate(cloned)`

## Duplicate Estimate

Duplicates an estimate into a new draft with a different title (or different project). Starts a new family.

`FRONTEND` — [`EstimatesConsole`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1134)

- [`handleDuplicateEstimate()`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1134)
  - `fetch POST /estimates/{estimateId}/duplicate/`
  - body: `{ title, project_id? }`

---

`BACKEND` — [`estimate_duplicate_view`](../../backend/core/views/estimating/estimates.py#L801)

*── auth + validation ──*

- [`_capability_gate(request.user, "estimates", "create")`](../../backend/core/rbac.py#L18)
- [`EstimateDuplicateSerializer.is_valid()`](../../backend/core/serializers/)
- same-project + same-title guard → `400` ("use clone version instead")
- target project validation via [`_validate_project_for_user(…)`](../../backend/core/views/helpers.py#L39) — filters by `organization_id`

*── persist ──*

- [`_next_estimate_family_version(target_project, target_title)`](../../backend/core/views/estimating/estimates_helpers.py#L56)
- `Estimate.objects.create(…)` — target project/title, status=draft
- line items copied → [`_apply_estimate_lines_and_totals(…)`](../../backend/core/views/estimating/estimates_helpers.py#L193)
- [`EstimateStatusEvent.record(duplicated, note="Duplicated from…")`](../../backend/core/models/estimating/)

---

`HTTP 201` → `FRONTEND`

- if same project: `setEstimates([duplicated, ...current])`
- if different project: `setSelectedProjectId(…)` — triggers project switch + reload
- `handleSelectEstimate(duplicated)`

## Public Estimate Detail

Public (unauthenticated) endpoint for customer estimate review. Served at `/estimate/{publicRef}`.

`FRONTEND` — [`EstimateApprovalPreview`](../../frontend/src/features/estimates/components/estimate-approval-preview.tsx#L51)

- `useEffect` on mount
  - `fetch GET /public/estimates/{publicToken}/`

---

`BACKEND` — [`public_estimate_detail_view`](../../backend/core/views/estimating/estimates.py#L50)

- `Estimate.objects.select_related("project__customer", "created_by").prefetch_related("line_items", "line_items__cost_code").get(public_token=…)`
- `EstimateSerializer(estimate)`
- [`_resolve_organization_for_public_actor(estimate.created_by)`](../../backend/core/views/helpers.py#L66)
- [`_serialize_public_project_context(estimate.project)`](../../backend/core/views/helpers.py#L108)
- [`_serialize_public_organization_context(organization)`](../../backend/core/views/helpers.py#L84)
- [`get_ceremony_context()`](../../backend/core/views/public_signing_helpers.py#L237) — consent text + version

---

`HTTP 200` → `FRONTEND`

- `setEstimate(nextEstimate)` — renders document viewer with approve/reject controls if `status === "sent"`

## Public OTP Request

Customer requests an OTP code to verify their identity before making a decision.

`FRONTEND` — (signing ceremony component)

- `fetch POST /public/estimates/{publicToken}/otp/`

---

`BACKEND` — [`public_estimate_request_otp_view`](../../backend/core/urls.py#L217)

- delegates to [`_request_otp_handler(request, "estimate", public_token)`](../../backend/core/views/public_signing_helpers.py#L85)
  - [`_resolve_document_and_email("estimate", public_token)`](../../backend/core/views/public_signing_helpers.py#L47)
  - rate limit: 60s between OTP requests per public_token
  - `DocumentAccessSession(…).save()` — generates 6-digit code
  - [`send_otp_email(recipient_email, code, "Estimate", document_title)`](../../backend/core/utils/email.py#L49)

---

`HTTP 200` → `FRONTEND`

- `{ data: { otp_required: true, email_hint: "n***@example.com", expires_in: 600 } }`

## Public OTP Verify

Customer submits the 6-digit OTP code to activate their session.

`FRONTEND` — (signing ceremony component)

- `fetch POST /public/estimates/{publicToken}/otp/verify/`
- body: `{ code }`

---

`BACKEND` — [`public_estimate_verify_otp_view`](../../backend/core/urls.py#L222)

- delegates to [`_verify_otp_handler(request, "estimate", public_token)`](../../backend/core/views/public_signing_helpers.py#L154)
  - [`DocumentAccessSession.lookup_for_verification(public_token, code)`](../../backend/core/models/shared_operations/document_access_session.py) — brute-force protected (max attempts)
  - `session.verified_at = now`, `session.session_expires_at = now + 60min`

---

`HTTP 200` → `FRONTEND`

- `{ data: { session_token, expires_in: 3600 } }`

## Public Decision (Approve / Reject)

Customer submits their approve/reject decision through the public share link, with signing ceremony data.

`FRONTEND` — [`EstimateApprovalPreview`](../../frontend/src/features/estimates/components/estimate-approval-preview.tsx#L130)

- [`applyDecision(decision, ceremony)`](../../frontend/src/features/estimates/components/estimate-approval-preview.tsx#L130)
  - `fetch POST /public/estimates/{publicToken}/decision/`
  - body: `{ decision, note, session_token, signer_name, consent_accepted }`

---

`BACKEND` — [`public_estimate_decision_view`](../../backend/core/views/estimating/estimates.py#L76)

*── validation ──*

- estimate must exist + `status === "sent"`
- decision must be `"approve"` or `"reject"`

*── ceremony validation ──*

- [`validate_ceremony_on_decision(request, public_token, customer_email)`](../../backend/core/views/public_signing_helpers.py#L187)
  - session token lookup via [`DocumentAccessSession.lookup_valid_session(…)`](../../backend/core/models/shared_operations/document_access_session.py)
  - `signer_name` required, `consent_accepted` must be `true`
- [`_build_public_decision_note(…)`](../../backend/core/views/helpers.py#L151) — formats note with signer info

*── atomic: status + audit + ceremony record ──*

- `transaction.atomic():`
  - `estimate.status = next_status` + `estimate.save(…)`
  - [`EstimateStatusEvent.record(…)`](../../backend/core/models/estimating/)
  - *── if approved ──*
  - [`_activate_project_from_estimate_approval(…)`](../../backend/core/views/estimating/estimates_helpers.py#L134)
  - *── signing ceremony record ──*
  - [`compute_document_content_hash("estimate", serialized)`](../../backend/core/utils/signing.py)
  - [`SigningCeremonyRecord.record(…)`](../../backend/core/models/) — document_type, decision, signer info, IP, user agent, consent snapshot, content hash

*── serialize response ──*

- [`_serialize_estimate(estimate)`](../../backend/core/views/estimating/estimates_helpers.py#L111)
- [`_serialize_public_project_context(…)`](../../backend/core/views/helpers.py#L108)
- [`_serialize_public_organization_context(…)`](../../backend/core/views/helpers.py#L84)

---

`HTTP 200` → `FRONTEND`

- `setEstimate(nextEstimate)` — re-renders with decision stamp (approved/rejected)
- `setDecisionReceiptName(ceremony.signer_name)`

## Route Summary

| Route | Method | View | Auth |
|---|---|---|---|
| `/contracts/estimates/` | GET | `estimate_contract_view` | Token |
| `/projects/{id}/estimates/` | GET | `project_estimates_view` | Token |
| `/projects/{id}/estimates/` | POST | `project_estimates_view` | Token + `estimates.create` |
| `/estimates/{id}/` | GET | `estimate_detail_view` | Token |
| `/estimates/{id}/` | PATCH | `estimate_detail_view` | Token + `estimates.edit` (+ `send`/`approve` for transitions) |
| `/estimates/{id}/status-events/` | GET | `estimate_status_events_view` | Token |
| `/estimates/{id}/clone-version/` | POST | `estimate_clone_version_view` | Token + `estimates.create` |
| `/estimates/{id}/duplicate/` | POST | `estimate_duplicate_view` | Token + `estimates.create` |
| `/public/estimates/{token}/` | GET | `public_estimate_detail_view` | None |
| `/public/estimates/{token}/otp/` | POST | `public_estimate_request_otp_view` | None |
| `/public/estimates/{token}/otp/verify/` | POST | `public_estimate_verify_otp_view` | None |
| `/public/estimates/{token}/decision/` | POST | `public_estimate_decision_view` | OTP session |
