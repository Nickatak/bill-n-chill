# Handoff - 2026-02-21

## What was completed
- Change Orders now support revision/origin modeling and project-scoped routing.
- CO creation enforces `origin_estimate` and requires it to be an approved estimate.
- CO add/edit forms moved toward estimate-like WYSIWYG parity.
- Add CO header amount/days are derived from line items (not manually editable).
- CO viewer was reworked to be estimate-centric:
  - shows approved estimates
  - shows linked COs for selected estimate
  - supports quick status updates directly in viewer
- Viewer UX pattern added:
  - viewer toggle (`Show/Hide`) on Estimates and Change Orders
  - `Add New X` action placed outside viewer
  - viewer defaults open
- Navbar/breadcrumb/project-scoped route updates for CO flow.
- Seed/migration/test/docs updates were included with CO feature expansion.

## Known issues / follow-ups
- Backend CO-focused tests currently fail in local sqlite test run because estimate approval is returning 400 during setup in multiple tests.
  - Key files: `backend/core/tests/test_change_orders.py`, `backend/core/tests/test_mvp_regression.py`
  - Likely related to newer estimate approval validation constraints vs test fixtures.
- MySQL test database creation permission issue exists in this environment:
  - `Access denied for user 'bnc'@'%' to database 'test_bill_n_chill'`
- Frontend lint is not fully green repo-wide (some pre-existing lint issues outside CO scope).

## Suggested next sequence
1. Fix failing estimate approval path in test setup/helpers so CO + MVP regression tests pass.
2. Re-run targeted backend suite:
   - `core.tests.test_change_orders`
   - `core.tests.test_audit_trail`
   - `core.tests.test_mvp_regression`
3. Mirror final Add CO decisions to any remaining Edit CO edges (if any drift remains after QA).
4. Continue UI polish pass (button consistency, spacing, and any viewer readability refinements).

## Useful commands
- Frontend build:
  - `npm run build --prefix frontend`
- Backend targeted tests (sqlite fallback):
  - `DATABASE_URL=sqlite:///backend/db.sqlite3 backend/.venv/bin/python backend/manage.py test core.tests.test_change_orders core.tests.test_audit_trail core.tests.test_mvp_regression`
- Migrations status:
  - `backend/.venv/bin/python backend/manage.py showmigrations core`

## Branch / remote
- Branch: `main`
- Remote: `origin`
