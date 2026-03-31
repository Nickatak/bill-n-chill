# Feature Map: Change Orders

## Purpose
Manage project-scoped contract deltas with explicit lifecycle transitions and revision flow from approved quote context.

## Route Surface
1. `/change-orders`
2. `/projects/[projectId]/change-orders`

## Mutation Map
1. `ChangeOrder`
   - create change order (`POST /projects/{id}/change-orders/`)
   - update change order header/status/lines (`PATCH /change-orders/{id}/`)
   - clone revision (`POST /change-orders/{id}/clone-revision/`)

## Composition and Entry Flow
1. Entry sources:
   - direct route entry: `frontend/src/app/change-orders/page.tsx` renders `ChangeOrdersConsole`
   - direct route entry: `frontend/src/app/projects/[projectId]/change-orders/page.tsx` renders `ChangeOrdersConsole`
   - feature export entry: `frontend/src/features/change-orders/index.ts` exports `ChangeOrdersConsole`
2. Parent/Owner:
   `ChangeOrdersConsole` owns project scope, quote linkage, selected change order, and mutation actions.
3. Controller/Hook:
   console-level state/effects manage contract policy bootstrap, project datasets, drafts, and quick-status transitions.
4. Children:
   inline create/edit panels, quote-origin viewer, line-item editors.
5. Default behavior:
   load project data -> render change-order list/editor -> allow create/edit/transition paths.
6. Overrides:
   contract fetch failure falls back to static local policy; clone-revision path creates new editable revision.
7. Relationship flow:
   route mount -> policy/data fetch -> user selection/edit action -> mutation -> list/selection refresh.

## API Surface Used
1. `GET /projects/`:
   lists projects for change-order scoping.
2. `GET /projects/{id}/change-orders/`:
   loads project change-order rows.
3. `POST /projects/{id}/change-orders/`:
   creates change order from selected quote/context.
4. `PATCH /change-orders/{id}/`:
   updates selected change order fields and status.
5. `POST /change-orders/{id}/clone-revision/`:
   creates revision clone from existing change order.
6. `GET /projects/{id}/budgets/`:
   loads budget lines used in change-order composition.
7. `GET /projects/{id}/quotes/`:
   loads quote context for origin linkage.

## Backend Contracts Used
- Contract endpoint(s): `GET /contracts/change-orders/`
- Consumed fields:
  - `statuses`
  - `status_labels`
  - `default_create_status`
  - `allowed_status_transitions`
  - `revision_rules`
  - `origin_quote_rules`
  - `approval_metadata_rules`
  - `error_rules`
- Behavior source: contract-backed status/transition rendering with endpoint responses for create/update/clone workflows
- Fallback policy: use static local status/transition map when contract fetch fails

## State Model (Remote, Local, Derived)
- State buckets:
  - Remote Data:
    - projects
    - change orders
    - budget lines
    - project quotes
  - Local UI State:
    - selected project
    - selected quote
    - selected change order
    - form drafts
    - quick status
    - viewer expansion state
  - Derived State:
    - allowed quick transitions
    - line totals
    - day deltas

## Error and Empty States
- Error states:
  - role-gated read-only mode for non `owner|pm`
  - create/patch validation failures
- Empty states:
  - no project selected
  - selected project has no change orders
  - contract fetch failure falls back to static local policy

## Test Anchors
- Existing anchors:
  - backend tests in `backend/core/tests/test_change_orders.py::test_change_order_contract_matches_model_transition_policy`
  - backend tests in `backend/core/tests/test_change_orders.py::test_change_order_contract_requires_authentication`
- TODO:
  - add frontend contract-adapter tests for status transitions
  - add frontend tests for create/edit/clone revision flows
