# Contributing

## Branching

- Use short-lived feature branches.
- Open PRs early for design and API feedback.

## Code Quality

- Keep changes scoped and reviewable.
- Add/update tests for behavior changes.
- Run linters/formatters before opening PR.

## Helper Placement

- Model-private helpers:
  - Keep in the same model module.
  - Prefix with `_`.
  - Use only from that model module (model methods/properties/local helpers).
- Reusable cross-layer helpers:
  - Move to `core/utils/` (pure utility logic) or `core/services/` (business/workflow orchestration).
  - Do not import private model helpers into views/serializers/services.
- Promotion rule:
  - If a helper is needed outside its model module, promote it out of the model file.

## Object Terminology

- Lifecycle control labels:
  - `system-managed`: not directly created/updated by users through normal API/UI flows; lifecycle changes occur as workflow side-effects.
  - `user-managed`: directly created and/or edited by authorized users (subject to role and status guards).
- Audience labels:
  - `client-facing`: intended for customer/client communication or visibility.
  - `internal-facing`: intended for internal operators only (our users), not customers/clients.
  - `non-client-facing`: acceptable plain-English synonym for `internal-facing`.
- Clarification:
  - Some objects are user-originated but still `internal-facing` (for example, canonical identity records created/reused as side-effects of user input).
  - Do not equate `internal-facing` with `system-managed`; audience and lifecycle are separate dimensions.
- Documentation rule:
  - For domain models, prefer explicitly stating lifecycle control and audience in docstrings.
  - Do not use "internal" to mean "not user-editable"; use `system-managed` or `user-managed` explicitly.

## Model Domain Boundaries

- Package-level split:
  - `core/models/financial_auditing/`: canonical identity and traceability anchors used to preserve auditable financial history.
  - Non-auditing domains: operational workflow entities (estimating, projects, contacts, etc.).
- Placement rule:
  - If a model's primary purpose is immutable financial traceability/reconciliation, place it in `financial_auditing`.
  - If a model's primary purpose is user workflow state/authoring, place it in an operational domain.
- Mutation caution for `financial_auditing`:
  - Immutability is not a hard package-wide rule, but this package is expected to be highly mutation-restrictive by default.
  - Any create/update/delete exposure (including system jobs, scripts, and admin paths) must be explicitly justified, narrowly scoped, and covered by tests.
  - Prefer append-only/event-snapshot patterns over in-place mutation whenever feasible.
- Example:
  - `ScopeItem` belongs to `financial_auditing` as canonical cross-artifact line identity, even though it is created/reused from estimate authoring flows.
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

## Commit Style

- Prefer small, atomic commits.
- Use clear imperative summaries.

## Review Focus

- Behavior correctness
- API contract compatibility
- Security and validation checks
- Test coverage for modified behavior
