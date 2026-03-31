# Feature Map: Quotes

## Purpose
Manage quote authoring, revision flow, status lifecycle, and customer-facing public preview within project context.

## Route Surface
1. `/projects/[projectId]/quotes`
2. `/quote/[publicRef]` (customer preview)

## Mutation Map
1. `Quote`
   - create quote version (`POST /projects/{id}/quotes/`)
   - update quote fields/status (`PATCH /quotes/{id}/`)
2. `PublicQuoteDecision`
   - approve/reject actions through public preview workflow (`GET /public/quotes/{public_token}/` + decision mutation path in preview flow)

## Composition and Entry Flow
1. Entry sources:
   - direct route entry: `frontend/src/app/projects/[projectId]/quotes/page.tsx` renders `QuotesConsole`
   - direct route entry: `frontend/src/app/quote/[publicRef]/page.tsx` renders `QuoteApprovalPreview`
   - feature export entry: `frontend/src/features/quotes/index.ts` exports `QuotesConsole`
2. Parent/Owner:
   `QuotesConsole` owns authenticated quote workflows; `QuoteApprovalPreview` owns public-token customer decision flow.
3. Controller/Hook:
   console-level state/effects manage contract policy bootstrap, project datasets, filters, and status action controls.
4. Children:
   `QuoteSheet`, family/revision cards, status-event views, public preview panel.
5. Default behavior:
   load scoped quotes -> render family/revision groups -> support create/edit/status actions.
6. Overrides:
   contract fetch failure falls back to local policy maps; public preview path bypasses authenticated console flow.
7. Relationship flow:
   route mount -> policy/data fetch -> user action (edit/status/clone/convert) -> mutation -> list/state refresh.

## API Surface Used
1. `GET /projects/`:
   lists projects for quote scoping.
2. `GET /cost-codes/`:
   loads cost-code options for quote line items.
3. `GET /projects/{id}/quotes/`:
   loads project quote rows and revision families.
4. `POST /projects/{id}/quotes/`:
   creates quote version.
5. `PATCH /quotes/{id}/`:
   updates selected quote fields and status.
6. `GET /quotes/{id}/status-events/`:
   loads status-history events for selected quote.
10. `GET /public/quotes/{public_token}/`:
   hydrates customer-facing public quote preview.
11. `GET /projects/{id}/change-orders/`:
   loads related change-order context.

## Backend Contracts Used
- Contract endpoint(s): `GET /contracts/quotes/`
- Consumed fields:
  - `statuses`
  - `status_labels`
  - `default_create_status`
  - `default_status_filters`
  - `allowed_status_transitions`
  - `quick_action_by_status`
- Behavior source: contract-backed status/filter/quick-action rendering with endpoint responses for quote mutations
- Fallback policy: use local status/filter/transition/action maps when contract fetch fails

## State Model (Remote, Local, Derived)
- State buckets:
  - Remote Data:
    - projects
    - cost-codes
    - quote rows
    - status events
    - related change orders
  - Local UI State:
    - selected project
    - selected quote
    - status note
    - duplicate panel state
    - line drafts
    - filter set
  - Derived State:
    - quote totals
    - allowed next statuses
    - family history grouping
    - quick action targets

## Error and Empty States
- Error states:
  - missing token/session for authenticated workflows
  - validation failures for line items/status transitions/conversion preconditions
  - public preview token parsing/load failures
- Empty states:
  - selected project has no quotes
  - filtered quote view has no matches
  - contract fetch failure falls back to local policy defaults

## Test Anchors
- Existing anchors:
  - backend tests in `backend/core/tests/test_quotes.py::test_quote_contract_matches_model_transition_policy`
  - backend tests in `backend/core/tests/test_quotes.py::test_quote_contract_requires_authentication`
- TODO:
  - add frontend contract-adapter tests for status transitions/quick actions
  - add frontend tests for revision family rendering and public preview flows
