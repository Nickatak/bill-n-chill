# Feature Map: Customers

## Purpose
Provide operational lookup, maintenance, and quick-add intake for canonical customer records outside financial workflows. Merges the former `features/intake/` module — quick-add is now a tab/mode within the customers console.

## Route Surface
1. `/customers` (Browse mode: list/edit/archive; Quick Add mode: intake form + duplicate resolution)

## Mutation Map
1. `Customer`
   - update selected customer (`PATCH /customers/{id}/`)
   - archive/unarchive selected customer (`PATCH /customers/{id}/` with `is_archived`)
   - create customer via quick-add intake (`POST /customers/quick-add/`)
2. `Project` (from customer context)
   - create project for customer (`POST /customers/{id}/projects/`)
   - create project as part of quick-add intake (`POST /customers/quick-add/` with `create_project=true`)

## Composition and Entry Flow
1. Entry sources:
   - direct route entry: `frontend/src/app/customers/page.tsx` renders `CustomersConsole`
   - feature export entry: `frontend/src/features/customers/index.ts` exports `CustomersConsole`, `QuickAddConsole`
2. Parent/Owner:
   `CustomersConsole` owns a mode toggle (Browse | Quick Add), lookup filters, row rendering, project-link indexing, modal edit/archive mutations, and quick-add intake orchestration.
3. Controller/Hook:
   - Browse mode: console-level state/effects manage query/filter state, selected row, and save/archive flows.
   - Quick Add mode: `useQuickAddController` → `useQuickAddBusinessWorkflow` orchestrates validation, submission, and duplicate resolution.
4. Children:
   - Browse mode:
     - `CustomersFilters`: query + activity controls
     - `CustomersList`: row-based customer list with quick project links
     - `CustomerEditorForm`: modal editor opened as a secondary action
   - Quick Add mode:
     - `QuickAddConsole`: intake form wrapper
     - `QuickAddForm`: lead capture fields
     - `DuplicateResolutionPanel`: conflict resolution UI
5. Default behavior:
   load in Browse mode with customer rows, activity filter defaulted to `active`, and support search/filter plus selected-record edits. Quick Add mode is available via tab toggle.
6. Overrides:
   archive toggle is blocked when active/on-hold projects exist for the selected customer.
7. Relationship flow:
   - Browse: route mount → customer fetch → selection/edit/archive action → mutation → list refresh.
   - Quick Add: route mount → form fill → submit → duplicate check → persist → confirmation.

## API Surface Used
1. `GET /customers/`:
   loads customers with optional query filtering.
2. `PATCH /customers/{id}/`:
   saves edits to selected customer.
3. `POST /customers/{id}/projects/`:
   creates a project linked to an existing customer.
4. `POST /customers/quick-add/`:
   creates a customer (+ optional project) via intake flow; returns 409 on duplicate detection.

## Backend Contracts Used
- Contract endpoint(s): none
- Consumed fields: none
- Behavior source: standard API responses from customers list/update/quick-add endpoints
- Mutation policy: customer hard-delete is not supported; archive/unarchive is the exposed lifecycle control.
- Archive side effect: `PATCH is_archived=true` auto-cancels customer `prospect` projects on backend.
- Duplicate policy: `POST /customers/quick-add/` returns 409 with candidate list on phone/email collision; client replays with `duplicate_resolution` + `duplicate_target_id`.
- Fallback policy: n/a (no contract adapter in this feature)

## State Model (Remote, Local, Derived)
- State buckets:
  - Remote Data:
    - customer rows
    - selected customer payload
    - duplicate candidates (quick-add 409 response)
  - Local UI State:
    - console mode (`browse` | `quick-add`)
    - search query
    - activity filter
    - form fields (browse edit + quick-add intake)
    - status messages
  - Derived State:
    - binary filtered customer lists (`all|active` and `all|with_project`)

## Error and Empty States
- Error states:
  - save/archive endpoint failures
  - quick-add submission failures
  - duplicate resolution failures
- Empty states:
  - no customers loaded
  - search with no matches
  - activity/project filter with no matches

## Test Anchors
- Existing anchors:
  - backend tests in `backend/core/tests/test_customers_management.py`
  - backend tests in `backend/core/tests/test_customer_intake.py`
  - frontend tests in `frontend/src/features/customers/__tests__/quick-add-validation.test.ts`
- TODO:
  - add frontend tests for filtering logic
  - add frontend tests for edit/archive flow and selection fallback
