# HANDOFF - 2026-02-24

## Session State

- Workspace: `/home/nick/bill_n_chill`
- Branch: `main`
- HEAD: `21e4571 feat(frontend): align workflow navigation and WIP route labeling`
- Branch relation: `main...origin/main` (no ahead/behind marker in status)
- Worktree: **dirty** (12 modified files, listed below)

## Current Modified Files (not committed)

- `backend/core/models/change_orders/change_order.py`
- `backend/core/policies/change_orders.py`
- `backend/core/tests/test_change_orders.py`
- `backend/core/views/change_orders/change_orders.py`
- `frontend/src/app/change-orders/page.module.css`
- `frontend/src/app/change-orders/page.tsx`
- `frontend/src/app/projects/[projectId]/change-orders/page.tsx`
- `frontend/src/features/change-orders/FEATURE_MAP.md`
- `frontend/src/features/change-orders/components/change-orders-console.module.css`
- `frontend/src/features/change-orders/components/change-orders-console.tsx`
- `frontend/src/features/change-orders/types.ts`
- `frontend/src/features/projects/components/projects-console.tsx`

## What Is Done (CO backend + frontend behavior)

### 1) CO backend contract + enforcement tightened

- Model invariants enforced in `ChangeOrder.clean()`:
  - approval metadata required iff `status=approved`
  - approval metadata cleared for non-approved statuses
  - `origin_estimate` must belong to same project
  - revision chain integrity for `previous_change_order` + `revision_number`
- Policy contract expanded and version bumped to `2026-02-24.change_orders.v4`:
  - includes `revision_rules`, `origin_estimate_rules`, `approval_metadata_rules`, `error_rules`
- View-level validation now returns stable rule keys via `error.rule` (create/edit/clone/line validations)
- Tests updated to assert policy contract and representative `error.rule` responses

### 2) CO frontend aligned to canonical model fields

- Uses `family_key` and `previous_change_order` (legacy `number` / `supersedes_change_order` removed)
- UI CO label normalized to `CO-{family_key} v{revision_number}`
- CO feature map updated to include new contract fields (`error_rules` included)

### 3) CO page UX cleanup completed

- Removed top route blurb/WIP/back-next header sections from `/change-orders` and project-scoped CO route
- Removed wrapper border/card artifacts causing HR-like separator look
- Clarified summary stat copy:
  - `Approved Estimates (Origin)`
  - `Change Orders Pending Approval`
  - `Approved Change Orders`
- Estimate card no longer uses misleading big `APPROVED` status badge; now uses neutral origin context text
- History copy clarified:
  - `No change orders have been created yet for this approved origin estimate.`

### 4) CO form interaction model now matches Estimates pattern

- Removed create/edit toggle buttons
- Single control surface now:
  - history selector (choose origin estimate / existing CO context)
  - `Add New Change Order` button
- Form mode is selection-driven:
  - selected CO -> edit form
  - no selected CO -> create form
- Origin estimate on create form is now selector-controlled (not user-editable in form)
  - displayed as read-only `Origin estimate (from selector)`
  - create submit disabled unless an approved origin estimate is selected in history selector

## Remaining Work (user explicitly parked here)

Focus area: **CO form detail pass**

- line-item UX and field polish (copy, spacing, affordance clarity)
- decide final field ordering and labels for create/edit parity
- evaluate if line table should get quick validation hints inline (before submit)
- visual hierarchy pass for summary block vs line-item table actions

## Validation Run During This Session

Backend:

- `cd backend && source .venv/bin/activate && python manage.py test core.tests.test_change_orders --keepdb --noinput -v 2` (pass, 33 tests)
- `cd backend && source .venv/bin/activate && python manage.py test core.tests.test_mvp_regression --keepdb --noinput -v 2` (pass)

Frontend:

- `cd frontend && npx tsc --noEmit` (pass)

## Resume Checklist

1. `git status -sb` and confirm same modified file list.
2. Open CO page and verify selector-driven behavior:
   - choose origin estimate with no COs -> create form visible
   - choose existing CO -> edit form visible
   - click `Add New Change Order` -> create context reset
3. Continue only the CO form detail pass (line items/fields/copy/layout).
4. Re-run:
   - `cd frontend && npx tsc --noEmit`
   - `cd backend && source .venv/bin/activate && python manage.py test core.tests.test_change_orders --keepdb --noinput`

## Notes

- No destructive git operations were used.
- This checkpoint is intentionally left uncommitted so CO form iteration can continue before squashing into a single coherent commit.
