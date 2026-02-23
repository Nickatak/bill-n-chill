# Feature Map: Vendors

## Purpose
Maintain canonical vendor directory records with duplicate safeguards and CSV import support for AP workflows.

## Route Surface
1. `/vendors`

## Mutation Map
1. `Vendor`
   - create vendor (`POST /vendors/`)
   - create vendor with duplicate override (`POST /vendors/` with duplicate resolution payload)
   - update vendor details/active status (`PATCH /vendors/{id}/`)
2. `VendorCatalog`
   - preview/apply CSV import (`POST /vendors/import-csv/`)

## Composition and Entry Flow
1. Entry sources:
   - direct route entry: `frontend/src/app/vendors/page.tsx` renders `VendorsConsole`
   - feature export entry: `frontend/src/features/vendors/index.ts` exports `VendorsConsole`
2. Parent/Owner:
   `VendorsConsole` owns list/filter/pagination state and create/edit/import/duplicate flows.
3. Controller/Hook:
   console-level state/effects manage vendor fetch, selected row, duplicate resolution context, and import actions.
4. Children:
   search/filter and paged table, create/edit forms, CSV import preview/apply controls.
5. Default behavior:
   load vendors and allow create/edit operations with filter/pagination controls.
6. Overrides:
   duplicate conflict (`409 duplicate_detected`) pivots to duplicate-resolution flow with pending payload state.
7. Relationship flow:
   route mount -> list fetch -> form/import/duplicate action -> mutation -> list/selection refresh.

## API Surface Used
1. `GET /vendors/`:
   loads vendor rows with optional query filtering.
2. `POST /vendors/`:
   creates vendor, including duplicate-resolution override path.
3. `PATCH /vendors/{id}/`:
   updates selected vendor row.
4. `POST /vendors/import-csv/`:
   previews and applies vendor CSV import.

## Backend Contracts Used
- Contract endpoint(s): none
- Consumed fields: none
- Behavior source: standard API responses from vendor list/create/update/import endpoints
- Fallback policy: n/a (no contract adapter in this feature)

## State Model (Remote, Local, Derived)
- State buckets:
  - Remote Data:
    - vendor rows
    - duplicate candidates
    - import result details
  - Local UI State:
    - selected row
    - search query
    - activity filter
    - page index
    - create/edit form fields
    - pending duplicate-resolution payload
  - Derived State:
    - paged rows
    - total pages
    - duplicate-resolution display context

## Error and Empty States
- Error states:
  - missing shared session token
  - duplicate conflict on create/update (`409 duplicate_detected`)
  - CSV import validation failures
- Empty states:
  - filtered vendor list has no matches

## Test Anchors
- Existing anchors:
  - backend tests in `backend/core/tests/test_vendors.py`
- TODO:
  - add frontend tests for duplicate-resolution workflow
  - add frontend tests for pagination/filter interactions and CSV import states
