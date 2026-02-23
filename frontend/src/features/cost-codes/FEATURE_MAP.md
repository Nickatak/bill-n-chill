# Feature Map: Cost Codes

## Purpose
Manage the shared cost-code catalog used by estimating, budgeting, and invoice line attribution.

## Route Surface
1. `/cost-codes`

## Mutation Map
1. `CostCode`
   - create cost code (`POST /cost-codes/`)
   - update cost code (`PATCH /cost-codes/{id}/`)
2. `CostCodeCatalog`
   - preview/apply CSV import (`POST /cost-codes/import-csv/`)

## Composition and Entry Flow
1. Entry sources:
   - direct route entry: `frontend/src/app/cost-codes/page.tsx` renders `CostCodesConsole`
   - feature export entry: `frontend/src/features/cost-codes/index.ts` exports `CostCodesConsole`
2. Parent/Owner:
   `CostCodesConsole` owns catalog list, selection, and create/edit/import actions.
3. Controller/Hook:
   console-level state/effects manage list hydration, selected row, form drafts, and CSV import flow.
4. Children:
   create/edit forms and CSV import preview/apply section.
5. Default behavior:
   load catalog rows and allow create/edit operations.
6. Overrides:
   CSV preview/apply actions branch into import result rendering and list refresh behavior.
7. Relationship flow:
   route mount -> list fetch -> form/import action -> mutation -> list/selection refresh.

## API Surface Used
1. `GET /cost-codes/`:
   loads catalog rows for selection/editing.
2. `POST /cost-codes/`:
   creates a new cost-code row.
3. `PATCH /cost-codes/{id}/`:
   updates selected cost-code row.
4. `POST /cost-codes/import-csv/`:
   previews and applies CSV import rows.

## Backend Contracts Used
- Contract endpoint(s): none
- Consumed fields: none
- Behavior source: standard API responses from cost-code list/create/update/import endpoints
- Fallback policy: n/a (no contract adapter in this feature)

## State Model (Remote, Local, Derived)
- State buckets:
  - Remote Data:
    - cost-code rows
    - selected row payload
    - CSV import result payload
  - Local UI State:
    - create/edit form fields
    - CSV text input
    - status messages
  - Derived State:
    - selected-row hydration view
    - import summary rendering

## Error and Empty States
- Error states:
  - create/update uniqueness failures
  - CSV parse/validation failures
  - endpoint reachability failures
- Empty states:
  - no cost-code rows loaded yet

## Test Anchors
- Existing anchors:
  - backend tests in `backend/core/tests/test_cost_codes.py`
- TODO:
  - add frontend tests for CSV preview/apply rendering paths
  - add frontend tests for selection hydration and create/edit flows
