# HANDOFF

## Session Summary
Major iteration completed across estimates workflow, lifecycle rules, revision/duplicate semantics, and estimate-sheet UX polish.

## Key Product/Logic Changes
- Enforced estimate lifecycle:
  - `draft -> sent` only
  - `sent -> approved|rejected`
  - no direct `draft -> approved|rejected`
- Revisions:
  - only from `sent` or `rejected`
  - creating a revision from `sent` auto-rejects the source estimate
- Duplicate-as-new flow implemented and separated from revision semantics.
- Estimate title made immutable after creation (including draft updates).

## UX Changes (Estimates)
- Project selector removed from estimates screen; estimates now project-scoped.
- `/estimates` now requires `?project=<id>` and redirects to `/projects` otherwise.
- Added project-context entry links from Projects (`Open Estimates`).
- Status events auto-load on estimate selection.
- Status events converted to tabular view with status-color chips.
- Version selector/history received improved active-state highlighting.
- Estimate sheet:
  - TO block now mailing-style (customer + address)
  - non-editable fields switched to disabled (non-reactive)
  - row actions hidden for non-draft
  - save/create CTA moved below totals on right
  - sortable line-item headers added for Qty, Cost Code (lexicographic), Unit Price, Markup, Amount
  - sort indicator resets when manually reordering lines
- Header separator styling iterated; left a TODO near separator rule for future polish.

## Related Backend/API Updates
- Project serializers now expose `customer_billing_address`.
- Error messaging improved for invalid estimate transitions and forbidden title edits.
- Tests expanded around transition rules, revision constraints, duplicate behavior, and title immutability.

## Known Follow-ups
- Revisit line-item header separator aesthetics:
  - see TODO in `frontend/src/features/estimates/components/estimates-console.module.css`.
- Consider redirecting workflow-nav Estimates link to selected project context in future.

## Verification Notes
- Full backend test execution was not run in this shell due missing local runtime deps/config (`pymysql`/env setup).
- Frontend changes were validated iteratively via visual/manual behavior checks.

## Resume Quick Start
1. `git pull` (if needed)
2. install backend deps/env (including `pymysql`)
3. run targeted tests:
   - `backend/core/tests/test_estimates.py`
4. smoke test:
   - projects -> open estimates (scoped)
   - create draft -> send -> revision -> source auto-rejected
   - status events table + selectors + sheet interactions
