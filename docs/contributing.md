# Contributing

Last reviewed: 2026-03-04

## Table of Contents

- [Contribution Workflow and Code Style](#contribution-workflow-and-code-style)
  - [Branching](#branching)
  - [Code Quality](#code-quality)
  - [Helper Placement](#helper-placement)
  - [Walrus Operator for Validation Guards](#walrus-operator-for-validation-guards)
  - [View Docstrings](#view-docstrings)
  - [Commit Style](#commit-style)
  - [Review Focus](#review-focus)
- [RBAC Patterns](#rbac-patterns)
- [Call Chain Documentation](#call-chain-documentation)
- [Architecture and Modeling Conventions (Meta Choices)](#architecture-and-modeling-conventions-meta-choices)
  - [Object Terminology](#object-terminology)
  - [Mutable + Immutable Pattern](#mutable--immutable-pattern)
  - [Model Domain Boundaries](#model-domain-boundaries)
  - [Enforcement Hierarchy](#enforcement-hierarchy)
  - [Revision Numbering](#revision-numbering)

## Contribution Workflow and Code Style

## Branching

- Use short-lived feature branches.
- Open PRs early for design and API feedback.

## Code Quality

- Keep changes scoped and reviewable.
- Add/update tests for behavior changes.
- Run linters/formatters before opening PR.

## Helper Placement

### Model helpers
- Model-private helpers:
  - Keep in the same model module.
  - Prefix with `_`.
  - Use only from that model module (model methods/properties/local helpers).
- Reusable cross-layer helpers:
  - Move to `core/utils/` (pure utility logic) or `core/services/` (business/workflow orchestration).
  - Do not import private model helpers into views/serializers/services.
- Promotion rule:
  - If a helper is needed outside its model module, promote it out of the model file.

### View helpers
- **Views own their flow.** Validation, orchestration, transaction blocks, and response assembly live inline in the view function. Views are not empty shells.
- **No private helpers or constants in view files.** Reusable functions (`_apply_estimate_lines_and_totals`), shared constants (`_VERIFY_ERROR_MAP`), and logic called by multiple views go in a sibling `*_helpers.py` file (e.g., `estimates.py` → `estimates_helpers.py`). Views import and call helpers; helpers never import from views.
- **Constant placement in helper files:** Constants imported by views (e.g., `_VERIFY_ERROR_MAP`) go at the top of the helpers file. Constants only used by a single helper function sit directly above that function. This keeps view-facing exports visible at the top and internal details co-located with their consumers.
- Cross-domain shared utilities and re-exports live in `views/helpers.py`, which stays slim and acts as a single import point for common operations (RBAC gates, org scoping, pagination, etc.).
- **Multi-method views use explicit branching.** When a view handles multiple HTTP methods, use `if`/`elif`/`else` — not early returns from the first branch. This keeps the structure consistent whether the view handles 2 or 4 methods, and avoids implicit fall-through that relies on the reader knowing a prior branch already returned.

### Walrus operator for validation guards

When a helper returns an error-or-`None`, use the walrus operator (`:=`) to assign and test in one expression:

```python
# Preferred
if error := validate_positive_amount(amount):
    return Response(error, status=400)

# Instead of
error = validate_positive_amount(amount)
if error:
    return Response(error, status=400)
```

This only works for single-return helpers. Tuple-returning functions like `_capability_gate` still need the two-line pattern. When designing new validation helpers, prefer the single-return (error-or-`None`) shape so callers can use walrus.

### Type hints
- **Helpers: yes.** Helper functions (in `*_helpers.py`, `utils/`, `services/`) should use type hints on parameters and return types — especially for non-obvious signatures like tuple returns, generic model parameters, and `Optional`/union types.
- **Views: no.** View function signatures are dictated by the framework (`request` is always `HttpRequest`, path params are typed by the URL conf). Type hints on views are redundant noise.
- **Models: no.** Django model fields are self-documenting via their field classes. Don't add type hints to model attributes or standard model methods (`save`, `clean`, etc.).

### View docstrings

Every view function should have a docstring following this structure:

```python
def some_view(request, ...):
    """One-line summary of what this endpoint does.

    Brief context paragraph — what the endpoint is for, any non-obvious
    behavior (e.g. "does NOT create records", side-effects, graceful
    degradation).

    Flow:
        1. First step (e.g. validate membership / capability gate).
        2. Next step.
        3. ...

    URL: ``METHOD /api/v1/path/to/endpoint/``

    Request body: description or (none).

    Success NNN::

        { "data": { ... } }

    Errors:
        - 400: When and why.
        - 403: When and why.
        - 404: When and why.
    """
```

- **Flow** is a numbered list of the view's steps in execution order. It should read like a recipe — someone unfamiliar with the code should be able to follow the logic without reading the implementation.
- **URL** uses reStructuredText double-backtick literals.
- **Success** uses the `::` literal-block syntax with an indented JSON example.
- **Errors** lists each status code with a short condition. Omit codes that don't apply.

## Commit Style

- Prefer small, atomic commits.
- Use clear imperative summaries.

## Review Focus

- Behavior correctness
- API contract compatibility
- Security and validation checks
- Test coverage for modified behavior

## Frontend CSS Conventions

### Two-Tone Surface Contrast

The app uses a two-tone surface system (`--surface` and `--surface-secondary`). Cards, panels, and viewer sections typically use `--surface-secondary` as their background. This creates a recurring problem: **interactive elements (buttons, pills, toggles) that also default to `--surface-secondary` will visually blend into their parent container.**

**Rule:** When placing a button or interactive control inside a `--surface-secondary` container, use `--surface` (or another visually distinct token) as the element's background. Do not assume the default button background will contrast with its parent — always verify.

Known examples of this pattern:
- Collapse toggle buttons inside viewer panels
- Secondary action buttons inside status/action cards
- Filter action buttons inside filter bars

### Responsive Breakpoints

The app uses desktop-first CSS with `max-width` overrides at three standard breakpoints:

| Breakpoint | Role | Typical changes |
|---|---|---|
| `900px` | Tablet / narrow desktop | Two-col → single-col, side panels collapse |
| `700px` | Mobile | Major layout shifts, nav transforms, padding/margin reduction |
| `640px` | Small mobile | Font size tweaks, compact form fields, fine-tuning |

**Rules:**
- Use `@media (max-width: Npx)` — not `min-width` — for responsive overrides (desktop-first).
- Not every page needs all three tiers. Use the ones that make sense for the content.
- Every flow must be usable at 375px width. No flow is desktop-only.
- Shared shell components (`mobile-bottom-nav`, `mobile-drawer`, `page-shell`) already handle nav and layout chrome at 700px. Page-level CSS handles content-specific adjustments.

## Frontend Form Validation

### No Browser `required` — Use Custom Validation Only

Do not use the HTML `required` attribute on form inputs. Browser-native validation tooltips are visually inconsistent with our custom error rendering and cannot be styled or controlled.

**Policy:**
- All field validation must use custom logic (controller hooks, handler guards, or inline checks).
- Display errors via styled inline messages (`fieldErrors`, `formMessage`, `inlineWarning`, etc.).
- If a field is mandatory, validate in the submit handler and show a custom error message — never rely on the browser tooltip.

**Rationale:** Mixing `required` tooltips with custom `fieldErrors` rendering creates a split UX where some fields show browser chrome and others show styled inline text. One pattern, consistently.

**Migration:** Existing forms still have `required` attributes. Remove them when touching a form and add custom validation in the same change. Do not remove `required` without adding a replacement check.

## RBAC Patterns

### Backend: Capability Gates

All write endpoints must use capability-based gating:
```python
permission_error, _ = _capability_gate(request.user, "resource_name", "action")
if permission_error:
    return Response(permission_error, status=403)
```

- Use `_capability_gate` for all permission-gated endpoints.
- For status-dependent actions within a single endpoint, gate each action separately:
  ```python
  if new_status == "sent":
      _err, _ = _capability_gate(request.user, "estimates", "send")
  elif new_status == "approved":
      _err, _ = _capability_gate(request.user, "estimates", "approve")
  ```
- The capability surface is defined in `RoleTemplate.capability_flags_json` and documented in `docs/api.md`.

### Frontend: `canDo` UI Gating

Use `canDo(capabilities, resource, action)` from `session/rbac.ts` to gate mutation UI:
```typescript
const { capabilities } = useSharedSessionAuth();
const canMutate = canDo(capabilities, "estimates", "create");
```

- Gate create forms, submit buttons, and status dropdowns behind `canMutate*` booleans.
- Show a read-only hint when the user lacks mutation capabilities.
- The backend always enforces — frontend gating is UX, not security.

## Call Chain Documentation

Per-domain call chain docs live in [`docs/call-chains/`](call-chains/README.md). See the README there for format, conventions, and the domain index.

## Architecture and Modeling Conventions (Meta Choices)

## Object Terminology

- Lifecycle control labels:
  - `system-managed`: not directly created/updated by users through normal API/UI flows; lifecycle changes occur as workflow side-effects.
  - `user-managed`: directly created and/or edited by authorized users (subject to role and status guards).
- Audience labels:
  - `customer-facing`: intended for customer communication or visibility.
  - `internal-facing`: intended for internal operators only (our users), not customers.
  - `non-customer-facing`: acceptable plain-English synonym for `internal-facing`.
- Clarification:
  - Some objects are user-originated but still `internal-facing` (for example, canonical identity records created/reused as side-effects of user input).
  - Do not equate `internal-facing` with `system-managed`; audience and lifecycle are separate dimensions.
- Documentation rule:
  - For domain models, prefer explicitly stating lifecycle control and audience in docstrings.
  - Do not use "internal" to mean "not user-editable"; use `system-managed` or `user-managed` explicitly.

## Mutable + Immutable Pattern

- Baseline rule:
  - Operational workflow models can be user-managed/mutable.
  - Financially relevant actions on those models must append immutable capture rows.
  - System-managed state machines must append immutable capture rows on each lifecycle transition.
- Why:
  - We accept user-driven workflow input, but still need replayable provenance for RBAC, forensics, and audit timelines.
- Capture requirements (minimum):
  - actor (`recorded_by`/equivalent)
  - capture source (`manual_ui`, automation/webhook/import lanes, etc.)
  - event type (`created`, `updated`, `status_changed`, `applied`, etc.)
  - immutable timestamp (`created_at`)
  - point-in-time snapshot payload (`snapshot_json`)
  - supplemental context (`metadata_json`/note/source reference)
- Immutability enforcement:
  - Capture models should block update/delete at model/queryset level.
  - Prefer append-only `*Record` or `*Snapshot` models in `financial_auditing`.
- Current examples:
  - `Customer` -> `CustomerRecord`
  - `Organization` -> `OrganizationRecord`
  - `OrganizationMembership` -> `OrganizationMembershipRecord`
  - `Payment` -> `PaymentRecord`
  - `PaymentAllocation` -> `PaymentAllocationRecord`
  - `AccountingSyncEvent` -> `AccountingSyncRecord`
  - `Estimate` -> `EstimateStatusEvent`
  - `Invoice` -> `InvoiceStatusEvent`
  - `ChangeOrder` -> `ChangeOrderSnapshot`
  - `VendorBill` -> `VendorBillSnapshot`
- Testing expectation:
  - For each new write path, add/extend tests proving capture-row creation and immutability behavior.

## Model Domain Boundaries

- Package-level split:
  - `core/models/financial_auditing/`: canonical identity and traceability anchors used to preserve auditable financial history.
  - Non-auditing domains: operational workflow entities (estimating, projects, customer management, cash-management, etc.).
- Placement rule:
  - If a model's primary purpose is immutable financial traceability/reconciliation, place it in `financial_auditing`.
  - If a model's primary purpose is user workflow state/authoring, place it in an operational domain.
- Mutation caution for `financial_auditing`:
  - Immutability is not a hard package-wide rule, but this package is expected to be highly mutation-restrictive by default.
  - Any create/update/delete exposure (including system jobs, scripts, and admin paths) must be explicitly justified, narrowly scoped, and covered by tests.
  - Prefer append-only/event-snapshot patterns over in-place mutation whenever feasible.
- Refactor policy:
  - Favor explicit, domain-named collection packages over oversized single files once a model file carries multiple concerns.

## Enforcement Hierarchy

- Prefer invariant enforcement at the lowest reliable layer:
  - Database constraints/indexes first (`CheckConstraint`, `UniqueConstraint`, indexes) for non-negotiable data integrity.
  - Model validation second (`clean`, guarded `save`) for lifecycle/state rules that should hold across all write paths.
  - Serializer/view validation third for request-shape, UX-quality errors, and endpoint-specific policy.
- Treat API-layer validation as additive, not authoritative.
- When practical, add tests at both:
  - API level (behavior/contract)
  - model or DB-integrity level (hard guardrails)

## Revision Numbering

- For user-visible revisioned artifacts (for example `Estimate.version`, `ChangeOrder.revision_number`), use 1-based numbering.
- First revision/version is `1` (not `0`).
- Rationale:
  - aligns with document-style version language (`v1`, `v2`, ...)
  - avoids off-by-one confusion in UI, API, and audit records
