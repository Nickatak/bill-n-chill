# Feature Map Template

Use this map for every feature directory under `frontend/src/features/*`.

## Purpose
Short statement of what user behavior this feature owns.

## Route Surface
List every route that renders this feature.

1. `/route`
2. `/route-2`

## Mutation Map
List mutations by object first, then operation path.

1. `ObjectName`
   - create/update/delete action (`METHOD /endpoint`)
2. `ObjectName`
   - side-effect mutation path (`METHOD /endpoint`)

## Composition and Entry Flow
Describe where execution enters and how runtime flow is composed.

1. Entry sources:
   - direct route entry:
   - conditional route entry:
   - feature export entry:
2. Parent/Owner:
3. Controller/Hook:
   explicitly name the parent controller API object (for example `FeatureControllerApi`) and where it is composed.
4. Children:
5. Default behavior:
6. Overrides:
7. Relationship flow:

## API Surface Used
List API endpoints called by this feature.

1. `GET /...`:
   short usage note (what this endpoint is used for in this feature).
2. `POST /...`:
   short usage note (what this mutation does in runtime flow).
3. `PATCH /...`:
   short usage note (what update path this supports).

## Backend Contracts Used
Define whether this feature is contract-backed or endpoint-response-driven.

- Contract endpoint(s):
- Consumed fields:
- Behavior source:
- Fallback policy:

## State Model (Remote, Local, Derived)
Split feature runtime state by source of truth.

- State buckets:
  - Remote Data:
    - item:
  - Local UI State:
    - item:
  - Derived State:
    - item:

## Error and Empty States
Separate failure paths from normal empty-data conditions.

- Error states:
  - auth/role gate
  - validation errors
  - mutation/network failures
- Empty states:
  - no rows yet
  - filtered list has no matches
  - no selected/current record

## Test Anchors
List tests that should exist for this feature.

- Existing anchors:
  - backend test path(s):
  - frontend test path(s):
- TODO:
  - add contract adapter tests (if contract-backed)
  - add controller/state tests
  - add component rendering/interaction tests
