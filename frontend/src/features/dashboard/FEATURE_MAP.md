# Feature Map: Dashboard

## Purpose
Authenticated landing page showing portfolio health, attention items requiring action, and change order impact across all projects.

## Route Surface
1. `/` (home route, rendered via `home-route-content.tsx`)

## Mutation Map
None — read-only dashboard.

## Composition and Entry Flow
1. Entry sources:
   - home route: `frontend/src/app/home-route-content.tsx` renders `DashboardConsole`
   - feature export entry: `frontend/src/features/dashboard/index.ts` exports `DashboardConsole`
2. Parent/Owner:
   `DashboardConsole` owns report data loading and display.
3. Controller/Hook:
   console-level state/effects handle parallel report fetching via `Promise.allSettled`.
4. Children:
   portfolio metrics grid, project breakdown table (linked), attention feed list (linked), change impact summary.
5. Default behavior:
   on mount with valid token, auto-loads all three report endpoints in parallel.
6. Relationship flow:
   route mount -> auth check -> parallel API fetches -> render sections based on data availability.

## API Surface Used
1. `GET /reports/portfolio/`:
   portfolio health — active project count, AR/AP outstanding, overdue counts, per-project breakdown.
2. `GET /reports/attention-feed/`:
   actionable items with severity, labels, and deep-links to relevant pages.
3. `GET /reports/change-impact/`:
   approved change order count and total contract growth.

## Backend Contracts Used
- Contract endpoint(s): none
- Consumed fields: none
- Behavior source: standard API responses from reporting endpoints
- Fallback policy: n/a

## State Model (Remote, Local, Derived)
- State buckets:
  - Remote Data:
    - portfolio snapshot
    - attention feed
    - change impact summary
  - Local UI State:
    - loading flag
  - Derived State:
    - hasAttentionItems (item_count > 0)
    - hasChangeImpact (approved_change_order_count > 0)
    - warning styling on overdue metric cards

## Error and Empty States
- Error states:
  - individual report fetch failures are silently tolerated (graceful degradation via `Promise.allSettled`)
- Empty states:
  - no shared session (auth message shown)
  - loading state
  - no attention items ("No items need attention right now.")
  - sections with null data are simply not rendered

## Test Anchors
- Existing anchors:
  - backend tests in `backend/core/tests/test_project_reporting.py`
- TODO:
  - add frontend tests for parallel load behavior and graceful degradation
