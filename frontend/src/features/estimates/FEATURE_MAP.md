# Feature Map: Estimates

## Purpose
Manage estimate authoring, revision flow, status lifecycle, and customer-facing public preview within project context.

## Route Surface
1. `/projects/[projectId]/estimates`
2. `/estimate/[publicRef]` (customer preview)

## Mutation Map
1. `Estimate`
   - create estimate version (`POST /projects/{id}/estimates/`)
   - update estimate fields/status (`PATCH /estimates/{id}/`)
   - clone version (`POST /estimates/{id}/clone-version/`)
   - duplicate as new draft (`POST /estimates/{id}/duplicate/`)
2. `Budget`
   - create baseline from estimate (`POST /estimates/{id}/convert-to-budget/`)
3. `PublicEstimateDecision`
   - approve/reject actions through public preview workflow (`GET /public/estimates/{public_token}/` + decision mutation path in preview flow)

## Composition and Entry Flow
1. Entry sources:
   - direct route entry: `frontend/src/app/projects/[projectId]/estimates/page.tsx` renders `EstimatesConsole`
   - direct route entry: `frontend/src/app/estimate/[publicRef]/page.tsx` renders `EstimateApprovalPreview`
   - feature export entry: `frontend/src/features/estimates/index.ts` exports `EstimatesConsole`
2. Parent/Owner:
   `EstimatesConsole` owns authenticated estimate workflows; `EstimateApprovalPreview` owns public-token customer decision flow.
3. Controller/Hook:
   console-level state/effects manage contract policy bootstrap, project datasets, filters, and status action controls.
4. Children:
   `EstimateSheet`, family/revision cards, status-event views, public preview panel.
5. Default behavior:
   load scoped estimates -> render family/revision groups -> support create/edit/status actions.
6. Overrides:
   contract fetch failure falls back to local policy maps; public preview path bypasses authenticated console flow.
7. Relationship flow:
   route mount -> policy/data fetch -> user action (edit/status/clone/convert) -> mutation -> list/state refresh.

## API Surface Used
1. `GET /projects/`:
   lists projects for estimate scoping.
2. `GET /cost-codes/`:
   loads cost-code options for estimate line items.
3. `GET /projects/{id}/estimates/`:
   loads project estimate rows and revision families.
4. `POST /projects/{id}/estimates/`:
   creates estimate version.
5. `PATCH /estimates/{id}/`:
   updates selected estimate fields and status.
6. `POST /estimates/{id}/clone-version/`:
   clones selected estimate into next revision.
7. `POST /estimates/{id}/duplicate/`:
   duplicates selected estimate as new draft lineage.
8. `POST /estimates/{id}/convert-to-budget/`:
   converts approved estimate to budget baseline.
9. `GET /estimates/{id}/status-events/`:
   loads status-history events for selected estimate.
10. `GET /public/estimates/{public_token}/`:
   hydrates customer-facing public estimate preview.
11. `GET /projects/{id}/change-orders/`:
   loads related change-order context.

## Backend Contracts Used
- Contract endpoint(s): `GET /contracts/estimates/`
- Consumed fields:
  - `statuses`
  - `status_labels`
  - `default_create_status`
  - `default_status_filters`
  - `allowed_status_transitions`
  - `quick_action_by_status`
- Behavior source: contract-backed status/filter/quick-action rendering with endpoint responses for estimate mutations
- Fallback policy: use local status/filter/transition/action maps when contract fetch fails

## State Model (Remote, Local, Derived)
- State buckets:
  - Remote Data:
    - projects
    - cost-codes
    - estimate rows
    - status events
    - related change orders
  - Local UI State:
    - selected project
    - selected estimate
    - status note
    - duplicate panel state
    - line drafts
    - filter set
  - Derived State:
    - estimate totals
    - allowed next statuses
    - family history grouping
    - quick action targets

## Error and Empty States
- Error states:
  - missing token/session for authenticated workflows
  - validation failures for line items/status transitions/conversion preconditions
  - public preview token parsing/load failures
- Empty states:
  - selected project has no estimates
  - filtered estimate view has no matches
  - contract fetch failure falls back to local policy defaults

## Test Anchors
- Existing anchors:
  - backend tests in `backend/core/tests/test_estimates.py::test_estimate_contract_matches_model_transition_policy`
  - backend tests in `backend/core/tests/test_estimates.py::test_estimate_contract_requires_authentication`
- TODO:
  - add frontend contract-adapter tests for status transitions/quick actions
  - add frontend tests for revision family rendering and public preview flows
