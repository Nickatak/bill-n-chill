# Feature Map: Contacts

## Purpose
Provide operational lookup and maintenance for canonical customer/contact records outside financial workflows.

## Route Surface
1. `/contacts`

## Mutation Map
1. `Contact`
   - update selected contact (`PATCH /contacts/{id}/`)
   - delete selected contact (`DELETE /contacts/{id}/`)

## Composition and Entry Flow
1. Entry sources:
   - direct route entry: `frontend/src/app/contacts/page.tsx` renders `ContactsConsole`
   - feature export entry: `frontend/src/features/contacts/index.ts` exports `ContactsConsole`
2. Parent/Owner:
   `ContactsConsole` owns lookup filters, record selection, and edit/delete mutations.
3. Controller/Hook:
   console-level state/effects manage query/filter state, selected row, and save/delete flows.
4. Children:
   - `ContactsFilters`: query + activity controls
   - `ContactsList`: selectable customer records list
   - `ContactEditorForm`: selected record edit/delete form
5. Default behavior:
   load contact rows and support search/filter plus selected-record edits.
6. Overrides:
   delete action updates selection fallback and list state.
7. Relationship flow:
   route mount -> contacts fetch -> selection/edit/delete action -> mutation -> list refresh.

## API Surface Used
1. `GET /contacts/`:
   loads contacts with optional query filtering.
2. `PATCH /contacts/{id}/`:
   saves edits to selected contact.
3. `DELETE /contacts/{id}/`:
   removes selected contact from canonical list.

## Backend Contracts Used
- Contract endpoint(s): none
- Consumed fields: none
- Behavior source: standard API responses from contacts list/update/delete endpoints
- Fallback policy: n/a (no contract adapter in this feature)

## State Model (Remote, Local, Derived)
- State buckets:
  - Remote Data:
    - contact rows
    - selected contact payload
  - Local UI State:
    - search query
    - activity filter
    - form fields
    - status messages
  - Derived State:
    - active/inactive filtered contact lists

## Error and Empty States
- Error states:
  - save/delete endpoint failures
- Empty states:
  - no contacts loaded
  - search with no matches
  - activity filter with no matches

## Test Anchors
- Existing anchors:
  - backend tests in `backend/core/tests/*contacts*`
- TODO:
  - add frontend tests for filtering logic
  - add frontend tests for edit/delete flow and selection fallback
