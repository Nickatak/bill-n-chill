# Feature Map: Payments

## Purpose
Manage project cash movement (inbound and outbound), payment status lifecycle, and allocation to AR/AP targets.

## Route Surface
1. `/financials-auditing` (payments console embedded on financials page)

## Mutation Map
1. `Payment`
   - create payment (`POST /projects/{id}/payments/`)
   - update payment fields/status (`PATCH /payments/{id}/`)
2. `PaymentAllocation`
   - allocate payment to invoice/vendor bill (`POST /payments/{id}/allocate/`)

## Composition and Entry Flow
1. Entry sources:
   - financials route entry: `frontend/src/app/financials-auditing/page.tsx` renders `PaymentsConsole`
   - feature export entry: `frontend/src/features/payments/index.ts` exports `PaymentsConsole`
2. Parent/Owner:
   `PaymentsConsole` owns project scope, selected payment, policy-driven status actions, and allocation workflow.
3. Controller/Hook:
   console-level state/effects coordinate contract bootstrap, payment list loading, and create/update/allocation mutations.
4. Children:
   create form, selected-payment update form, allocation target loader, allocation creation form.
5. Default behavior:
   select project -> load payments and allocation targets -> allow create/update/allocation actions.
6. Overrides:
   contract fetch failure falls back to static local policy defaults for statuses/methods/directions/transitions.
7. Relationship flow:
   route mount -> policy/data fetch -> user action -> mutation -> payment/target list refresh.

## API Surface Used
1. `GET /projects/`:
   lists projects for payment scoping.
2. `GET /projects/{id}/payments/`:
   loads project payment rows.
3. `POST /projects/{id}/payments/`:
   creates payment record.
4. `PATCH /payments/{id}/`:
   updates selected payment fields and status.
5. `POST /payments/{id}/allocate/`:
   creates payment allocation to target object.
6. `GET /projects/{id}/invoices/`:
   loads invoice targets used for inbound allocation workflows.
7. `GET /projects/{id}/vendor-bills/`:
   loads vendor-bill targets used for outbound allocation workflows.

## Backend Contracts Used
- Contract endpoint(s): `GET /contracts/payments/`
- Consumed fields:
  - `statuses`
  - `status_labels`
  - `directions`
  - `methods`
  - `default_create_status`
  - `default_create_direction`
  - `default_create_method`
  - `allowed_status_transitions`
  - `allocation_target_by_direction`
- Behavior source: contract-backed status/method/direction/allocation rendering with endpoint responses for payment mutations
- Fallback policy: use static local policy defaults when contract fetch fails

## State Model (Remote, Local, Derived)
- State buckets:
  - Remote Data:
    - projects
    - payments
    - invoice allocation targets
    - vendor-bill allocation targets
  - Local UI State:
    - selected project
    - selected payment
    - create/edit form drafts
    - allocation target/amount draft
  - Derived State:
    - allowed next statuses
    - direction-specific allocation target type
    - payment action hints

## Error and Empty States
- Error states:
  - role-gated read-only mode for non `owner|bookkeeping`
  - create/update/allocation validation failures
- Empty states:
  - no project selected
  - selected project has no payments
  - selected direction has no allocation targets
  - contract fetch failure falls back to local policy defaults

## Test Anchors
- Existing anchors:
  - backend tests in `backend/core/tests/test_payments.py::test_payment_contract_matches_model_transition_policy`
  - backend tests in `backend/core/tests/test_payments.py::test_payment_contract_requires_authentication`
- TODO:
  - add frontend contract-adapter tests for statuses/methods/directions/transitions
  - add frontend tests for allocation target selection and mutation flow
