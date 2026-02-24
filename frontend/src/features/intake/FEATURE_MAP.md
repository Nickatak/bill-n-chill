# Feature Map: Intake

## Purpose
Capture qualified customers quickly with duplicate detection and optional immediate project creation.

## Route Surface
1. `/intake/quick-add`
2. `/` when authenticated (home route renders intake console)

## Mutation Map
1. `CustomerIntakeRecord`
   - create intake record (`POST /customers/quick-add/`)
   - duplicate-resolution create path (`POST /customers/quick-add/` with `duplicate_resolution` and optional `duplicate_target_id`)
2. `Customer`
   - create/reuse inside quick-add submit (`POST /customers/quick-add/`)
3. `Project`
   - optional create inside quick-add submit (`POST /customers/quick-add/`)

## Composition and Entry Flow
1. Entry sources:
   - direct route entry: `frontend/src/app/intake/quick-add/page.tsx` renders `QuickAddConsole` unconditionally
   - home-route conditional entry: `frontend/src/app/home-route-content.tsx` renders `QuickAddConsole` only when session is authenticated
   - feature export entry: `frontend/src/features/intake/index.ts` exports `QuickAddConsole` for reuse
2. Parent/Owner:
   `QuickAddConsole` is the feature composition owner; it wires controller state/actions into child components and renders shared status output.
3. Controller/Hook:
   `useQuickAddController` composes auth + workflow + validation modules and returns explicit parent API object `QuickAddControllerApi`.
4. Children:
   `QuickAddForm` (customer/project input + dual submit intents), `DuplicateResolutionPanel` (duplicate selection + resolution actions).
5. Default behavior:
   `QuickAddForm` is visible, duplicate panel is hidden, and console renders auth/intake/project messages.
6. Overrides:
   duplicate conflict (`409 duplicate_detected`) shows `DuplicateResolutionPanel`; submit intent `customer_and_project` requests customer+project creation; missing/invalid token shifts to auth-error messaging path.
7. Relationship flow:
   user action -> child callback -> controller mutation -> state update -> parent re-renders children with new state.

## API Surface Used
1. `GET /auth/me/`:
   verifies shared token validity and resolves user-facing auth status messaging before submit flows.
2. `POST /customers/quick-add/`:
   creates intake record + customer (and optional project), including duplicate-detection conflict response (`409 duplicate_detected`) used by resolution UI.

## Backend Contracts Used
- Contract endpoint(s): none
- Consumed fields: none
- Behavior source: standard API responses from:
  - `POST /customers/quick-add/`
  - `GET /auth/me/`
- Fallback policy: n/a (no contract adapter in this feature)

## Known Tradeoffs
- Temporary auth double-check on `/`:
  - `HomeRouteContent` verifies `GET /auth/me/` before rendering authenticated home.
  - `QuickAddConsole` also verifies `GET /auth/me/` inside feature controller flow.
  - This redundancy is intentionally kept for now because `QuickAddConsole` must also run standalone on `/intake/quick-add` without assuming route-level auth gate state.
  - Refactor later: pass verified-auth context from home route into intake feature so home path can skip the second verification call.

## State Model (Remote, Local, Derived)
- State buckets:
  - Remote Data:
    - duplicate candidates
    - last submitted intake record
    - creation result messages
  - Local UI State:
    - intake form fields
    - pending submission context
    - selected duplicate
    - field errors
  - Derived State:
    - submit intent behavior
    - duplicate resolution options

## Error and Empty States
- Error states:
  - missing shared session token
  - field validation failures
  - duplicate conflict requiring resolution (`409 duplicate_detected`)
  - project create failures
- Empty states:
  - no duplicate candidates (duplicate panel hidden)
  - no last submitted intake record yet
  - no creation result yet

## Test Anchors
- Existing anchors:
  - backend tests in `backend/core/tests/test_intake.py`
- TODO:
  - add frontend tests for duplicate resolution flow
  - add frontend tests for dual-intent submit behavior (`customer_only` vs `customer_and_project`)
