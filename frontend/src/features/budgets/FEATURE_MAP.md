# Feature Map: Budgets

## Purpose
Provide project-scoped budget baseline visibility and estimate-to-budget conversion controls.

## Route Surface
1. `/projects/[projectId]/budgets/analytics`
2. `BudgetsConsole` is exported for composition reuse and is not currently mounted by a dedicated route page.

## Mutation Map
1. `Budget`
   - create budget baseline from approved estimate (`POST /estimates/{id}/convert-to-budget/`)
2. `BudgetSelectionView`
   - update selected budget snapshot in local UI state (analytics drill-down flow)

## Composition and Entry Flow
1. Entry sources:
   - direct route entry: `frontend/src/app/projects/[projectId]/budgets/analytics/page.tsx` renders `BudgetAnalyticsConsole`
   - feature export entry: `frontend/src/features/budgets/index.ts` exports `BudgetAnalyticsConsole` and `BudgetsConsole`
2. Parent/Owner:
   `BudgetAnalyticsConsole` owns analytics rendering; `BudgetsConsole` owns conversion/edit workflow when embedded.
3. Controller/Hook:
   console-level state/effects manage scoped project, estimates/budgets fetches, and conversion action.
4. Children:
   analytics panels and conversion controls.
5. Default behavior:
   load scoped project budgets/estimates and render read-only analytics summaries.
6. Overrides:
   conversion action refreshes budgets and updates selected budget snapshot.
7. Relationship flow:
   route mount -> scoped fetch -> optional conversion action -> budget list refresh -> analytics re-render.

## API Surface Used
1. `GET /projects/{id}/`:
   loads scoped project summary context.
2. `GET /projects/{id}/estimates/`:
   loads estimate candidates for budget conversion.
3. `GET /projects/{id}/budgets/`:
   loads budget snapshots for analytics display.
4. `POST /estimates/{id}/convert-to-budget/`:
   converts approved estimate into a budget baseline.

## Backend Contracts Used
- Contract endpoint(s): none
- Consumed fields: none
- Behavior source: standard API responses from budgets and estimate-conversion endpoints
- Fallback policy: n/a (no contract adapter in this feature)

## State Model (Remote, Local, Derived)
- State buckets:
  - Remote Data:
    - scoped project
    - scoped estimates
    - scoped budgets
  - Local UI State:
    - selected estimate for conversion
    - selected budget for drill-down
    - status/error messages
  - Derived State:
    - conversion candidates
    - budget totals
    - spend/variance summaries

## Error and Empty States
- Error states:
  - endpoint reachability failures
  - conversion mutation failures
- Empty states:
  - missing scoped project context
  - no approved estimates available for conversion
  - no budgets exist for scoped project

## Test Anchors
- Existing anchors:
  - backend tests in `backend/core/tests/test_estimates.py` (budget conversion coverage)
- TODO:
  - add frontend tests for conversion candidate filtering
  - add frontend tests for analytics totals and selected-budget drill-down behavior
