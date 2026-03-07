# Estimates Call Chains

> **Line anchors are pinned manually.** Update after refactors that move function definitions.

End-to-end function call order for each estimate action. View logic lives in [`estimates.py`](../../backend/core/views/estimating/estimates.py); domain helpers in [`estimates_helpers.py`](../../backend/core/views/estimating/estimates_helpers.py); budget conversion in [`budgets_helpers.py`](../../backend/core/views/estimating/budgets_helpers.py).

## Load Policy Contract

Fetches the canonical estimate workflow policy (statuses, transitions, quick-actions) to drive frontend UX guards. Called on console mount.

`FRONTEND` — [`EstimatesConsole`](../../frontend/src/features/estimates/components/estimates-console.tsx#L326)

- [`loadEstimatePolicy()`](../../frontend/src/features/estimates/components/estimates-console.tsx#L326)
  - [`fetchEstimatePolicyContract({ baseUrl, token })`](../../frontend/src/features/estimates/api.ts#L25)
    - `fetch GET /contracts/estimates/`

---

`BACKEND` — [`estimate_contract_view`](../../backend/core/views/estimating/estimates.py#L196)

- [`get_estimate_policy_contract()`](../../backend/core/policies/__init__.py) — returns static policy dict

---

`HTTP 200` → `FRONTEND`

- `setEstimateStatuses(contract.statuses)`
- `setEstimateAllowedStatusTransitions(normalizedTransitions)`
- `setEstimateQuickActionByStatus(…)`

## Load Estimates (List)

Fetches all estimates for the selected project. Called on project selection change and after mutations.

`FRONTEND` — [`EstimatesConsole`](../../frontend/src/features/estimates/components/estimates-console.tsx#L719)

- [`loadEstimates(options?)`](../../frontend/src/features/estimates/components/estimates-console.tsx#L719)
  - `fetch GET /projects/{projectId}/estimates/`

---

`BACKEND` — [`project_estimates_view`](../../backend/core/views/estimating/estimates.py#L226) (GET path)

*── org scope ──*

- [`_organization_user_ids(request.user)`](../../backend/core/views/helpers.py)
- [`_ensure_membership(request.user)`](../../backend/core/user_helpers.py#L134)
- [`_validate_project_for_user(project_id, request.user)`](../../backend/core/views/helpers.py)

*── query ──*

- `Estimate.objects.filter(project=project, created_by_id__in=actor_user_ids).prefetch_related("line_items", "line_items__cost_code").order_by("-version")`

*── serialize ──*

- [`_serialize_estimates(estimates, project, actor_user_ids)`](../../backend/core/views/estimating/estimates_helpers.py#L115)
  - [`_estimate_financial_baseline_context(project, actor_user_ids)`](../../backend/core/views/estimating/estimates_helpers.py#L73)
    - `Budget.objects.filter(project=…).select_related("source_estimate")` — builds financial baseline status map
  - `EstimateSerializer(estimates, many=True, context=context)`

---

`HTTP 200` → `FRONTEND`

- `setEstimates(rows)`
- auto-selects first visible estimate matching active status filters

## Create Estimate (POST)

Creates a new estimate version within a title family. Includes duplicate-submit suppression and family collision detection.

`FRONTEND` — [`EstimatesConsole`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1045)

- [`handleCreateEstimate(event)`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1045)
  - client-side guards: `canMutateEstimates`, `isReadOnly`, project selected, title present, all lines have cost codes
  - if editing existing draft → routes to [Save Draft](#save-draft-patch) instead
  - if title family exists + not yet confirmed → shows collision prompt, returns
  - [`submitNewEstimateWithTitle({ projectId, title, allowExistingTitleFamily })`](../../frontend/src/features/estimates/components/estimates-console.tsx#L967)
    - `fetch POST /projects/{projectId}/estimates/`
    - body: `{ title, allow_existing_title_family, valid_through, tax_percent, line_items[] }`

---

`BACKEND` — [`project_estimates_view`](../../backend/core/views/estimating/estimates.py#L226) (POST path)

*── auth + validation ──*

- [`_capability_gate(request.user, "estimates", "create")`](../../backend/core/rbac.py#L18)
- [`EstimateWriteSerializer.is_valid()`](../../backend/core/serializers/)
- `terms_text` rejection (org-managed only)
- line items non-empty check

*── duplicate-submit suppression (5s window) ──*

- [`_line_items_signature(items)`](../../backend/core/views/estimating/estimates.py#L302) — builds tuple signature from input
- [`_estimate_signature(estimate)`](../../backend/core/views/estimating/estimates.py#L317) — builds tuple signature from DB
- `Estimate.objects.filter(project, created_by__in, created_at__gte=window_start)` — scan recent
- if exact match found → return `200 { data, meta: { deduped: true } }`

*── family guards ──*

- approved family check → `409 estimate_family_approved_locked`
- existing family without `allow_existing_title_family` → `409 estimate_family_exists`

*── persist ──*

- [`_next_estimate_family_version(project, user, title)`](../../backend/core/views/estimating/estimates_helpers.py#L57)
- `Estimate.objects.create(…)` — version, status=draft, terms from org
- [`_apply_estimate_lines_and_totals(estimate, line_items, tax_percent, user)`](../../backend/core/views/estimating/estimates_helpers.py#L194)
  - [`_calculate_line_totals(line_items_data)`](../../backend/core/views/estimating/estimates_helpers.py#L164) — per-line markup math
  - [`_resolve_cost_codes_for_user(user, items)`](../../backend/core/views/helpers.py) — validates cost code ownership
  - `estimate.line_items.all().delete()` + `EstimateLineItem.objects.bulk_create(…)`
  - `ScopeItem` get-or-create for each described line
  - saves totals: `subtotal`, `markup_total`, `tax_total`, `grand_total`

*── audit + archive ──*

- [`EstimateStatusEvent.record(estimate, from_status=None, to_status, note, changed_by)`](../../backend/core/models/estimating/)
- [`_archive_estimate_family(project, user, title, exclude_ids, note)`](../../backend/core/views/estimating/estimates_helpers.py#L23)
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

`FRONTEND` — [`EstimatesConsole`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1078)

- [`handleCreateEstimate(event)`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1045) — `isEditingDraft && selectedEstimate` branch
  - `fetch PATCH /estimates/{estimateId}/`
  - body: `{ title, valid_through, tax_percent, line_items[] }`

---

`BACKEND` — [`estimate_detail_view`](../../backend/core/views/estimating/estimates.py#L472) (PATCH path, value-edit branch)

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
- if `line_items` present → [`_apply_estimate_lines_and_totals(…)`](../../backend/core/views/estimating/estimates_helpers.py#L194)
- if only `tax_percent` changed → recalculates totals with existing lines

---

`HTTP 200` → `FRONTEND`

- `setEstimates(current.map(…))` — replaces updated record
- `setFormSuccessMessage("Saved draft estimate #X.")`

## Status Transition (PATCH)

Applies a workflow status change (e.g. draft→sent, sent→approved, →void). Triggers side effects based on target status.

`FRONTEND` — [`EstimatesConsole`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1218)

- [`handleUpdateEstimateStatus()`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1218)
  - `fetch PATCH /estimates/{estimateId}/`
  - body: `{ status, status_note }`

---

`BACKEND` — [`estimate_detail_view`](../../backend/core/views/estimating/estimates.py#L472) (PATCH path, status branch)

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
  - [`EmailRecord.record(…)`](../../backend/core/models/shared_operations/email_verification.py#L135) — immutable audit

*── if status == approved ──*

- [`_activate_project_from_estimate_approval(estimate, actor, note)`](../../backend/core/views/estimating/estimates_helpers.py#L135)
  - prospect/on-hold → active transition
  - [`FinancialAuditEvent.record(…)`](../../backend/core/models/financial_auditing/)
- [`_ensure_budget_from_approved_estimate(estimate, user, note, allow_supersede=True)`](../../backend/core/views/estimating/budgets_helpers.py#L157)
  - [`_sync_project_contract_baseline_if_unset(estimate)`](../../backend/core/views/estimating/estimates_helpers.py#L124) — sets contract values if zero
  - idempotency: returns `"already_converted"` if budget exists
  - conflict: returns `"requires_supersede"` if another estimate's budget is active
  - [`_create_budget_from_estimate(estimate, user)`](../../backend/core/views/estimating/budgets_helpers.py#L102)
    - [`_supersede_active_project_budgets(…)`](../../backend/core/views/estimating/budgets_helpers.py#L59)
    - `Budget.objects.create(…)` with [`_build_budget_baseline_snapshot(estimate)`](../../backend/core/views/estimating/budgets_helpers.py#L19)
    - `BudgetLine.objects.bulk_create(…)` — estimate lines + system overhead lines
  - [`FinancialAuditEvent.record(…)`](../../backend/core/models/financial_auditing/)

---

`HTTP 200` → `FRONTEND`

- `setEstimates(current.map(…))` — replaces updated, marks superseded baselines
- `loadStatusEvents({ estimateId, quiet: true })` — refreshes history panel
- budget conversion feedback: `"Estimate approved and set as the active estimate."`

## Add Status Note (PATCH)

Appends a note to the status history without changing the estimate's status.

`FRONTEND` — [`EstimatesConsole`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1270)

- [`handleAddEstimateStatusNote()`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1270)
  - `fetch PATCH /estimates/{estimateId}/`
  - body: `{ status_note }` (no `status` field)

---

`BACKEND` — [`estimate_detail_view`](../../backend/core/views/estimating/estimates.py#L472) (PATCH path)

- same view, `same_status_note_request` branch
- [`EstimateStatusEvent.record(from_status=current, to_status=current, note=status_note)`](../../backend/core/models/estimating/)

---

`HTTP 200` → `FRONTEND`

- `loadStatusEvents(…)` — refreshes history

## Load Status Events

Fetches the immutable status transition history for an estimate.

`FRONTEND` — [`EstimatesConsole`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1356)

- [`loadStatusEvents(options?)`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1356)
  - `fetch GET /estimates/{estimateId}/status-events/`

---

`BACKEND` — [`estimate_status_events_view`](../../backend/core/views/estimating/estimates.py#L925)

- [`_organization_user_ids(request.user)`](../../backend/core/views/helpers.py)
- `EstimateStatusEvent.objects.filter(estimate=estimate).select_related(…)`
- `EstimateStatusEventSerializer(events, many=True)`

---

`HTTP 200` → `FRONTEND`

- `setStatusEvents(rows)`

## Clone Revision

Creates a new draft from an existing sent/rejected/voided/archived estimate in the same title family. If source was `sent`, auto-rejects it.

`FRONTEND` — [`EstimatesConsole`](../../frontend/src/features/estimates/components/estimates-console.tsx#L388)

- [`cloneEstimateRevision(sourceEstimate)`](../../frontend/src/features/estimates/components/estimates-console.tsx#L388)
  - `fetch POST /estimates/{estimateId}/clone-version/`

---

`BACKEND` — [`estimate_clone_version_view`](../../backend/core/views/estimating/estimates.py#L711)

*── auth + guards ──*

- [`_capability_gate(request.user, "estimates", "create")`](../../backend/core/rbac.py#L18)
- status guard: source must be `sent`, `rejected`, `void`, or `archived`

*── persist ──*

- [`_next_estimate_family_version(project, user, title)`](../../backend/core/views/estimating/estimates_helpers.py#L57)
- `Estimate.objects.create(…)` — same title/terms/tax, new version, status=draft
- line items copied as dicts → [`_apply_estimate_lines_and_totals(…)`](../../backend/core/views/estimating/estimates_helpers.py#L194)

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

`FRONTEND` — [`EstimatesConsole`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1172)

- [`handleDuplicateEstimate()`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1172)
  - `fetch POST /estimates/{estimateId}/duplicate/`
  - body: `{ title, project_id? }`

---

`BACKEND` — [`estimate_duplicate_view`](../../backend/core/views/estimating/estimates.py#L815)

*── auth + validation ──*

- [`_capability_gate(request.user, "estimates", "create")`](../../backend/core/rbac.py#L18)
- [`EstimateDuplicateSerializer.is_valid()`](../../backend/core/serializers/)
- same-project + same-title guard → `400` ("use clone version instead")
- target project validation via [`_validate_project_for_user(…)`](../../backend/core/views/helpers.py)

*── persist ──*

- [`_next_estimate_family_version(target_project, user, target_title)`](../../backend/core/views/estimating/estimates_helpers.py#L57)
- `Estimate.objects.create(…)` — target project/title, status=draft
- line items copied → [`_apply_estimate_lines_and_totals(…)`](../../backend/core/views/estimating/estimates_helpers.py#L194)
- [`EstimateStatusEvent.record(duplicated, note="Duplicated from…")`](../../backend/core/models/estimating/)

---

`HTTP 201` → `FRONTEND`

- if same project: `setEstimates([duplicated, ...current])`
- if different project: `setSelectedProjectId(…)` — triggers project switch + reload
- `handleSelectEstimate(duplicated)`

## Convert to Budget

Manually converts an approved estimate to the active financial baseline (budget). Idempotent.

`FRONTEND` — [`EstimatesConsole`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1313)

- [`handleActivateFinancialBaseline()`](../../frontend/src/features/estimates/components/estimates-console.tsx#L1313)
  - `fetch POST /estimates/{estimateId}/convert-to-budget/`
  - body: `{ supersede_active: true }`

---

`BACKEND` — [`estimate_convert_to_budget_view`](../../backend/core/views/estimating/estimates.py#L945)

*── auth ──*

- [`_capability_gate(request.user, "estimates", "approve")`](../../backend/core/rbac.py#L18)
- `supersede_active` requires `org_identity.edit` capability (owner-only)

*── validation ──*

- estimate must be `approved` status

*── conversion ──*

- [`_ensure_budget_from_approved_estimate(estimate, user, note, allow_supersede)`](../../backend/core/views/estimating/budgets_helpers.py#L157)
  - see [Status Transition → if approved](#status-transition-patch) for full sub-chain

---

`HTTP 201` (converted) / `HTTP 200` (already_converted) / `HTTP 409` (requires_supersede) → `FRONTEND`

- `loadEstimates({ preserveSelection: true })` — full reload to reflect baseline changes
- `loadStatusEvents(…)` — refresh history

## Public Estimate Detail

Public (unauthenticated) endpoint for customer estimate review. Served at `/estimate/{publicRef}`.

`FRONTEND` — [`EstimateApprovalPreview`](../../frontend/src/features/estimates/components/estimate-approval-preview.tsx#L107)

- `useEffect` on mount
  - `fetch GET /public/estimates/{publicToken}/`

---

`BACKEND` — [`public_estimate_detail_view`](../../backend/core/views/estimating/estimates.py#L50)

- `Estimate.objects.select_related("project__customer", "created_by").prefetch_related("line_items", "line_items__cost_code").get(public_token=…)`
- `EstimateSerializer(estimate)`
- [`_resolve_organization_for_public_actor(estimate.created_by)`](../../backend/core/views/helpers.py)
- [`_serialize_public_project_context(estimate.project)`](../../backend/core/views/helpers.py)
- [`_serialize_public_organization_context(organization)`](../../backend/core/views/helpers.py)
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
- [`_build_public_decision_note(…)`](../../backend/core/views/helpers.py) — formats note with signer info

*── atomic: status + audit + ceremony record ──*

- `transaction.atomic():`
  - `estimate.status = next_status` + `estimate.save(…)`
  - [`EstimateStatusEvent.record(…)`](../../backend/core/models/estimating/)
  - *── if approved ──*
  - [`_activate_project_from_estimate_approval(…)`](../../backend/core/views/estimating/estimates_helpers.py#L135)
  - [`_ensure_budget_from_approved_estimate(…, allow_supersede=True)`](../../backend/core/views/estimating/budgets_helpers.py#L157)
  - *── signing ceremony record ──*
  - [`compute_document_content_hash("estimate", serialized)`](../../backend/core/utils/signing.py)
  - [`SigningCeremonyRecord.record(…)`](../../backend/core/models/) — document_type, decision, signer info, IP, user agent, consent snapshot, content hash

*── serialize response ──*

- [`_serialize_estimate(estimate, actor_user_ids)`](../../backend/core/views/estimating/estimates_helpers.py#L106)
- [`_serialize_public_project_context(…)`](../../backend/core/views/helpers.py)
- [`_serialize_public_organization_context(…)`](../../backend/core/views/helpers.py)

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
| `/estimates/{id}/convert-to-budget/` | POST | `estimate_convert_to_budget_view` | Token + `estimates.approve` (+ `org_identity.edit` for supersede) |
| `/public/estimates/{token}/` | GET | `public_estimate_detail_view` | None |
| `/public/estimates/{token}/otp/` | POST | `public_estimate_request_otp_view` | None |
| `/public/estimates/{token}/otp/verify/` | POST | `public_estimate_verify_otp_view` | None |
| `/public/estimates/{token}/decision/` | POST | `public_estimate_decision_view` | OTP session |
