# Feature Map: Invoices

## Purpose
Manage AR invoice composition, lifecycle transitions, and send operations.

## Route Surface
1. `/invoices`

## Mutation Map
1. `Invoice`
   - create invoice (`POST /projects/{id}/invoices/`)
   - update invoice fields/status (`PATCH /invoices/{id}/`)
   - send invoice (`POST /invoices/{id}/send/`)
2. `InvoiceLineItem`
   - create/update as part of invoice create/patch payloads (`POST /projects/{id}/invoices/`, `PATCH /invoices/{id}/`)

## Composition and Entry Flow
1. Entry sources:
   - direct route entry: `frontend/src/app/invoices/page.tsx` renders `InvoicesConsole`
   - feature export entry: `frontend/src/features/invoices/index.ts` exports `InvoicesConsole`
2. Parent/Owner:
   `InvoicesConsole` owns project scope, invoice selection, and invoice mutation actions.
3. Controller/Hook:
   console-level state/effects manage dependency loading (projects/cost-codes), form drafts, and send/status actions.
4. Children:
   dependency loader views, create invoice form, line-item editor, status/send action controls.
5. Default behavior:
   select project -> load project invoices -> allow create/edit/send workflows.
6. Overrides:
   quick status actions and send flow mutate selected invoice and refresh invoice list state.
7. Relationship flow:
   route mount -> project selection -> invoice fetch -> form/action mutation -> list/state refresh.

## API Surface Used
1. `GET /projects/`:
   lists projects used to scope invoice work.
2. `GET /cost-codes/`:
   loads cost-code options used in line-item attribution.
3. `GET /projects/{id}/invoices/`:
   loads project invoice rows.
4. `POST /projects/{id}/invoices/`:
   creates invoice with line items.
5. `PATCH /invoices/{id}/`:
   updates selected invoice details and status.
6. `POST /invoices/{id}/send/`:
   triggers invoice send operation.

## Backend Contracts Used
- Contract endpoint(s): none
- Consumed fields: none
- Behavior source: standard API responses from invoice create/list/patch/send endpoints
- Fallback policy: n/a (no contract adapter in this feature)

## State Model (Remote, Local, Derived)
- State buckets:
  - Remote Data:
    - projects
    - cost-codes
    - invoice rows
  - Local UI State:
    - selected project
    - selected invoice
    - invoice create/edit form fields
    - line-item drafts
    - scope override fields
  - Derived State:
    - next-action hints
    - invoice status display context

## Error and Empty States
- Error states:
  - role-gated read-only mode for non `owner|pm|bookkeeping`
  - create/patch/send endpoint failures
  - validation failures for invoice or line-item payloads
- Empty states:
  - no project selected
  - selected project has no invoices

## Test Anchors
- Existing anchors:
  - backend tests in `backend/core/tests/test_invoices.py`
- TODO:
  - add frontend tests for line-item payload construction
  - add frontend tests for status/send action rendering and mutation updates
