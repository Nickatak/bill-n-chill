# Feature Map: Vendor Bills

## Purpose
Manage project-scoped AP bill intake, lifecycle transitions, and budget-line allocation behavior.

## Route Surface
1. `/projects/[projectId]/vendor-bills`

## Mutation Map
1. `VendorBill`
   - create vendor bill (`POST /projects/{id}/vendor-bills/`)
   - update vendor bill fields/status (`PATCH /vendor-bills/{id}/`)
2. `VendorBillAllocation`
   - create/replace allocation rows via vendor-bill update payload (`PATCH /vendor-bills/{id}/`)

## Composition and Entry Flow
1. Entry sources:
   - direct route entry: `frontend/src/app/projects/[projectId]/vendor-bills/page.tsx` renders `VendorBillsConsole`
   - feature export entry: `frontend/src/features/vendor-bills/index.ts` exports `VendorBillsConsole`
2. Parent/Owner:
   `VendorBillsConsole` owns project scope, selected bill, and allocation/editor workflow.
3. Controller/Hook:
   console-level state/effects coordinate contract bootstrap, list filters, pagination, and bill/allocation mutations.
4. Children:
   inline create/edit forms, allocation rows editor, list/filter controls.
5. Default behavior:
   select project -> load vendor bills + budgets/vendors -> allow create/edit/transition flows.
6. Overrides:
   contract fetch failure falls back to local status policy; duplicate conflict path enables resolution flow.
7. Relationship flow:
   route mount -> policy + data fetch -> user edits/quick actions -> mutations -> list/selection refresh.

## API Surface Used
1. `GET /projects/`:
   lists projects for bill scoping.
2. `GET /vendors/`:
   loads vendor options for bill create/edit forms.
3. `GET /projects/{id}/vendor-bills/`:
   loads vendor bill rows for selected project.
4. `POST /projects/{id}/vendor-bills/`:
   creates vendor bill records.
5. `PATCH /vendor-bills/{id}/`:
   updates bill metadata, status, and allocation rows.
6. `GET /projects/{id}/budgets/`:
   loads budget lines used for bill allocation.

## Backend Contracts Used
- Contract endpoint(s): `GET /contracts/vendor-bills/`
- Consumed fields:
  - `statuses`
  - `status_labels`
  - `default_create_status`
  - `create_shortcut_statuses`
  - `allowed_status_transitions`
- Behavior source: contract-backed status/filter/transition rendering with endpoint responses for create/update workflows
- Fallback policy: use local status/transition defaults when contract fetch fails

## State Model (Remote, Local, Derived)
- State buckets:
  - Remote Data:
    - projects
    - vendors
    - vendor bills
    - budget-line groups
  - Local UI State:
    - selected bill
    - form draft state
    - status filters
    - due filter
    - pagination
  - Derived State:
    - allocation totals
    - unallocated amount
    - over-allocation flags
    - allowed next statuses

## Error and Empty States
- Error states:
  - role-gated read-only mode for non `owner|pm|bookkeeping`
  - duplicate bill conflict (`409 duplicate_detected`)
  - allocation/validation failures on save/create
- Empty states:
  - no project selected
  - selected project has no vendor bills
  - contract fetch failure falls back to local policy defaults

## Test Anchors
- Existing anchors:
  - backend tests in `backend/core/tests/test_vendor_bills.py::test_vendor_bill_contract_matches_model_transition_policy`
  - backend tests in `backend/core/tests/test_vendor_bills.py::test_vendor_bill_contract_requires_authentication`
- TODO:
  - add frontend contract-adapter tests for filters/create shortcuts/transitions
  - add frontend tests for allocation totals and duplicate-resolution handling
