# Handoff - 2026-02-21

## What was completed
- Removed obsolete non-project placeholder routes:
  - `frontend/src/app/expenses-placeholder/page.tsx`
  - `frontend/src/app/vendor-bills-placeholder/page.tsx`
  - `frontend/src/app/estimates-placeholder/page.tsx`
- Built and refined post-estimate workflow hub:
  - `frontend/src/app/estimates/post-create/page.tsx`
  - Added project/estimate-scoped handoff path into CO workflow.
- Change Orders now support project filtering by origin estimate via query param:
  - `origin_estimate` is accepted in `frontend/src/app/projects/[projectId]/change-orders/page.tsx`
  - `frontend/src/features/change-orders/components/change-orders-console.tsx` supports initial origin estimate selection.
- Estimates console UX improvements:
  - Card-level compact `+` action for next-step workflow/revision pathing based on estimate status.
  - "Add New Estimate" collapses viewer.
  - Successful create selects and re-opens viewer on the new estimate.
  - Removed redundant "Create revision from selected" button.
  - Price placement adjusted in card metadata for readability.
- Backend estimate status handling fix for void/archived transition:
  - `PATCH /api/v1/estimates/{id}/` now allows `status=archived` (void) through transition validation.
  - Create path still blocks direct archived creation.
  - Files:
    - `backend/core/serializers/estimates.py`
    - `backend/core/views/estimates.py`
    - `backend/core/tests/test_estimates.py`
- Tandem experiment cleanup completed:
  - Removed `sockfile`, `TANDEM_LOG.md`, tandem docs, and socket poller/send scripts.

## Known issues / follow-ups
- In this shell environment, full backend test execution is still blocked by missing dependency:
  - `ModuleNotFoundError: No module named 'pymysql'`
- Prior CO/MVP regression suite follow-up likely still needed (from earlier handoff):
  - Re-validate estimate approval setup in:
    - `backend/core/tests/test_change_orders.py`
    - `backend/core/tests/test_mvp_regression.py`
- Frontend lint may still include pre-existing repo-wide issues outside the touched estimate/CO files.

## Suggested next sequence
1. Run backend tests in a fully provisioned env (with `pymysql`) and confirm:
   - `core.tests.test_estimates`
   - `core.tests.test_change_orders`
   - `core.tests.test_mvp_regression`
2. Continue tight UX iteration in estimates/CO handoff flow:
   - Status-gated `+` action behavior
   - Card hierarchy/readability
   - Viewer open/close affordance polish
3. If CO discoverability remains strong from Estimates, evaluate whether redundant project-scope CO entry points can be reduced.
4. Start next feature exploration in parallel (new Codex session) while preserving this iterative loop on Estimates/CO UX.

## Useful commands
- Frontend build:
  - `npm run build --prefix frontend`
- Backend targeted tests:
  - `backend/.venv/bin/python backend/manage.py test core.tests.test_estimates`
  - `backend/.venv/bin/python backend/manage.py test core.tests.test_change_orders core.tests.test_audit_trail core.tests.test_mvp_regression`
- Migrations status:
  - `backend/.venv/bin/python backend/manage.py showmigrations core`

## Branch / remote
- Branches:
  - `main` at `cbcb2b9` (`feat: refine post-estimate workflow and estimate status handling`)
  - `danger` at `fa49391` (same content; mirrored)
- Remote: `origin`
