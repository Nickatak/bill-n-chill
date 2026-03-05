# FinancialAuditEvent Deprecation Plan

Generated: 2026-02-22 09:10:17 UTC

## Why This Document Exists

This is intentionally a real-world deprecation exercise, not a shortcut deletion.

Yes, we *could* delete `FinancialAuditEvent` directly today in a small/local environment.
But the goal is to model production-grade change management for an important financial
audit structure and learn how to deprecate safely.

This is both:
- a practical engineering plan, and
- a high-quality architecture/interview discussion topic.

## Decision Summary

`FinancialAuditEvent` should be treated as a **deprecated index/timeline artifact**, not
as canonical financial truth.

Canonical financial truth should come from **domain-specific immutable capture models**
that follow a 1:1 capturable -> captured-object pattern.

Current direction:
1. Keep `FinancialAuditEvent` temporarily for compatibility.
2. Migrate writers/readers to domain-specific immutable captures.
3. Remove `FinancialAuditEvent` in a deliberate breaking DB change at the end of the revision.

## Core Principle

For financially relevant workflows, we want explicit capture objects:
- each capture has clear lifecycle semantics,
- each capture has narrow data exposure,
- each capture is immutable and constrained by design,
- each capture answers: "what happened, when, and who did it?"

This is preferable to one generic event table because it forces explicitness in:
- invariants,
- capture timing,
- replay semantics,
- and access boundaries.

## Current State

`FinancialAuditEvent` currently powers:
1. `GET /api/v1/projects/{project_id}/audit-events/`
2. The "financial" portion of project timeline assembly
3. Several view-layer write paths (`_record_financial_audit_event` and direct creates)
4. Demo seed and regression tests

`FinancialAuditEvent` is immutable at the row level, but semantically too generic to be
the long-term canonical financial ledger.

## Target State (Canonical Capture Matrix)

1. Estimate lifecycle decisions:
- `EstimateStatusEvent`

2. Estimate -> budget baseline capture:
- `Budget.baseline_snapshot_json`

3. Change-order terminal decisions:
- `ChangeOrderSnapshot` (`approved`, `rejected`, `void`)

4. Invoice lifecycle (pending model):
- dedicated immutable invoice capture model

5. Vendor-bill lifecycle:
- `VendorBillSnapshot` (implemented)

6. Payment lifecycle + allocation (pending model):
- dedicated immutable payment capture model(s)

## Safe Deprecation Strategy

### Phase 0: Deprecation Declaration
1. Mark `FinancialAuditEvent` as deprecated in model/docs.
2. State clearly: "non-canonical; compatibility only."

Exit criteria:
- Team alignment on target-state ownership.

### Phase 1: Introduce Missing Capture Models
1. Add domain-specific immutable models for invoice/vendor-bill/payment lanes.
2. Define hard invariants in model/DB constraints.
3. Add transition/capture tests per lifecycle.

Exit criteria:
- All financially relevant transitions have explicit immutable captures.

### Phase 2: Dual-Write (Optional but Recommended)
1. Keep existing `FinancialAuditEvent` writes.
2. Add writes to new canonical capture models.
3. Compare outputs in tests (parity checks).

Exit criteria:
- New captures have complete coverage in CI.

### Phase 3: Reader Migration
1. Move `/audit-events/` endpoint to read from canonical captures (or adapter layer).
2. Move timeline financial lane to canonical captures.
3. Preserve stable API shape where practical.

Exit criteria:
- No user-facing read path depends on `FinancialAuditEvent` table.

### Phase 4: Writer Shutdown
1. Remove new writes to `FinancialAuditEvent`.
2. Keep table read-only for rollback window.

Exit criteria:
- Runtime no longer emits new `FinancialAuditEvent` rows.

### Phase 5: Breaking Removal
1. Remove model imports/usages.
2. Run migration dropping table.
3. Clean seed/test fixtures.
4. Announce migration as breaking change in release notes.

Exit criteria:
- Table removed, all tests green, timeline/audit endpoints still correct.

## Risk Register

1. Hidden dependencies in timeline/reporting/tests
- Mitigation: ripgrep inventory + targeted migration checklist.

2. Gaps in replay semantics after migration
- Mitigation: define per-model replay fields before reader cutover.

3. Data drift during migration
- Mitigation: temporary dual-write + parity tests.

4. Overexposure of sensitive financial metadata
- Mitigation: narrow snapshot payload schemas per domain model.

## Suggested Interview Narrative

If asked "Why not just delete the table?":
1. Direct deletion is easy technically but unsafe organizationally.
2. Financial/audit systems need phased migration and trust-preserving controls.
3. We chose explicit immutable domain captures to improve correctness and reduce ambiguity.
4. We used a staged deprecation (declare -> dual-write -> migrate readers -> remove writers -> drop table).

This demonstrates judgment in:
- change management,
- backward compatibility,
- auditability,
- and production-risk reduction.

## Immediate Next Steps

1. Finalize schemas for:
- invoice lifecycle capture
- payment lifecycle/allocation capture

2. Decide whether we want a temporary adapter layer for `/audit-events/` and timeline.

3. Define the exact revision milestone where the breaking drop migration lands.

## Execution Checklist (No Dates)

### 0. Governance + Scope Lock
- [ ] Confirm deprecation intent: `FinancialAuditEvent` is compatibility-only, non-canonical.
- [ ] Confirm target-state principle: 1:1 capturable -> immutable captured object.
- [ ] Confirm this migration is allowed to be a breaking DB change at revision end.
- [ ] Freeze any new feature work that introduces additional `FinancialAuditEvent` dependencies.

### 1. Dependency Inventory
- [ ] Enumerate all write paths to `FinancialAuditEvent` (views/helpers/commands).
- [ ] Enumerate all read paths from `FinancialAuditEvent` (API endpoints/timeline/reporting).
- [ ] Enumerate all tests and seed flows asserting `FinancialAuditEvent` behavior.
- [ ] Capture inventory as a migration checklist artifact.

### 2. Canonical Capture Model Completion
- [ ] Define immutable invoice lifecycle capture model contract.
- [x] Define immutable vendor-bill lifecycle capture model contract.
- [ ] Define immutable payment lifecycle/allocation capture model contract.
- [ ] Define model-level + DB-level invariants for each capture model.
- [ ] Add tests proving immutability and lifecycle-capture correctness for each model.

### 3. Write-Path Migration
- [ ] Add canonical capture writes for all financially relevant transitions.
- [ ] Keep old `FinancialAuditEvent` writes temporarily (dual-write window).
- [ ] Add parity tests comparing old/new capture coverage where applicable.
- [ ] Verify no financially relevant transition is write-only to `FinancialAuditEvent`.

### 4. Read-Path Migration
- [ ] Design adapter/query layer for audit/timeline reads from canonical captures.
- [ ] Migrate `/api/v1/projects/{project_id}/audit-events/` off `FinancialAuditEvent`.
- [ ] Migrate timeline financial lane off `FinancialAuditEvent`.
- [ ] Keep response contract stable unless intentional versioned API change is approved.
- [ ] Update/expand regression tests for migrated read paths.

### 5. Writer Shutdown
- [ ] Remove runtime writes to `FinancialAuditEvent`.
- [ ] Keep read compatibility during short rollback window.
- [ ] Confirm dual-write parity tests are no longer needed and retire them safely.

### 6. Breaking Removal
- [ ] Remove `FinancialAuditEvent` imports/usages from runtime code.
- [ ] Remove serializer/endpoints that are no longer valid or replace with adapters.
- [ ] Create and apply migration dropping `FinancialAuditEvent` table.
- [ ] Update seed/demo commands and fixtures accordingly.
- [ ] Remove dead tests and replace with canonical-capture tests.

### 7. Final Verification Gate
- [ ] Full backend test suite passes.
- [ ] Timeline/audit UX still renders correct financial history from canonical captures.
- [ ] Documentation/HANDOFF updated to reflect post-removal architecture.
- [ ] Breaking change notes are recorded for future contributors and deploy operators.
