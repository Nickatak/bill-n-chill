# Feature Map: Customers

## Purpose
Provide operational lookup and maintenance for canonical customer records outside financial workflows.

## Route Surface
1. `/customers`

## Mutation Map
1. `Customer`
   - update selected customer (`PATCH /customers/{id}/`)
   - archive/unarchive selected customer (`PATCH /customers/{id}/` with `is_archived`)

## Composition and Entry Flow
1. Entry sources:
   - direct route entry: `frontend/src/app/customers/page.tsx` renders `ContactsConsole`
   - feature export entry: `frontend/src/features/contacts/index.ts` exports `ContactsConsole`
2. Parent/Owner:
   `ContactsConsole` owns lookup filters, row rendering, project-link indexing, and modal edit/archive mutations.
3. Controller/Hook:
   console-level state/effects manage query/filter state, selected row, and save/archive flows.
4. Children:
   - `ContactsFilters`: query + activity controls
   - `ContactsList`: row-based customer list with quick project links
   - `ContactEditorForm`: modal editor opened as a secondary action
5. Default behavior:
   load customer rows with activity filter defaulted to `active` and support search/filter plus selected-record edits.
6. Overrides:
   archive toggle is blocked when active/on-hold projects exist for the selected customer.
7. Relationship flow:
   route mount -> customer fetch -> selection/edit/archive action -> mutation -> list refresh.

## API Surface Used
1. `GET /customers/`:
   loads customers with optional query filtering.
2. `PATCH /customers/{id}/`:
   saves edits to selected customer.

## Backend Contracts Used
- Contract endpoint(s): none
- Consumed fields: none
- Behavior source: standard API responses from customers list/update endpoints
- Mutation policy: customer hard-delete is not supported; archive/unarchive is the exposed lifecycle control.
- Archive side effect: `PATCH is_archived=true` auto-cancels customer `prospect` projects on backend.
- Fallback policy: n/a (no contract adapter in this feature)

## State Model (Remote, Local, Derived)
- State buckets:
  - Remote Data:
    - customer rows
    - selected customer payload
  - Local UI State:
    - search query
    - activity filter
    - form fields
    - status messages
  - Derived State:
    - binary filtered customer lists (`all|active` and `all|with_project`)

## Error and Empty States
- Error states:
  - save/archive endpoint failures
- Empty states:
  - no customers loaded
  - search with no matches
  - activity/project filter with no matches

## Test Anchors
- Existing anchors:
  - backend tests in `backend/core/tests/*contacts*` (legacy file names)
- TODO:
  - add frontend tests for filtering logic
  - add frontend tests for edit/archive flow and selection fallback
