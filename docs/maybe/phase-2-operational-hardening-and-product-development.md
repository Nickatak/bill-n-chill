# Phase 2: Operational Hardening + Product Development

Last reviewed: 2026-02-28

## Status Snapshot

- This remains an active planning/iteration document.
- For execution-level day-to-day notes, use `work/for_me.md`.

## Objective

Transition from MVP demonstration quality to reliable daily-use quality while continuing to build user-facing value.

## Scope

- Operational hardening of core financial workflows.
- UX and use-case development for field and office teams.
- Release/quality guardrails needed for sustained iteration.

## Outcomes

1. Core flows are resilient under real-world edge cases.
2. User-facing flows are clearer, faster, and easier to recover from errors.
3. Team can ship safely with repeatable checks, predictable environments, and clear runbooks.

## Workstreams

### 1) Operational Hardening

- Enforce domain invariants for lifecycle transitions.
- Tighten validation and error semantics across API endpoints.
- Add safety around money movement operations (idempotent handling where required).
- Expand audit coverage for high-impact state and amount changes.
- Improve failure messaging and recovery hints (especially local/dev operations).

### 2) UX + Use-Case Development

- Convert current route consoles into clearer task-based user flows.
- Add explicit guidance, success criteria, and next-step prompts per workflow page.
- Improve field-first ergonomics for quick-add, status updates, and payment visibility.
- Improve desktop information density for estimate/budget/invoice operations.
- Add more realistic scenario fixtures aligned to GC/PM operating patterns.

### 3) Quality + Release Discipline

- Add regression tests for critical money-loop behavior.
- Add negative-path tests for key edge cases and validation boundaries.
- Define required pre-merge checks and release checklist.
- Add environment runbooks for local + dev + prod-like operation.

## Priority Sequence

1. Stabilize high-risk business rules (invoices, payments, change-order propagation).
2. Lock in API validation/error contracts for core workflows.
3. Improve route UX to match expected day-to-day usage.
4. Expand automated regression coverage.
5. Prepare deployment and operations checklist for first real-user trial.

## Done Criteria (Phase 2)

- No known data-integrity defects in core money loop.
- Clear and actionable user-facing errors in critical workflows.
- Repeatable setup/reset/seed path for all active environments.
- Documented and test-backed expected behavior for critical edge cases.
- Internal team can run a full scenario start-to-finish without manual DB intervention.
