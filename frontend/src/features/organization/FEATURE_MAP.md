# Feature Map: Organization

## Purpose
Manage organization profile metadata, invoice branding/default templates, and RBAC membership role/status updates from one Ops / Meta surface.

## Route Surface
1. `/ops/organization`

## Mutation Map
1. `Organization`
   - update profile fields (`PATCH /organization/`)
   - update invoice branding/default templates (`PATCH /organization/`)
2. `OrganizationMembership`
   - update role/status (`PATCH /organization/memberships/{id}/`)

## Composition and Entry Flow
1. Entry sources:
   - direct route entry: `frontend/src/app/ops/organization/page.tsx` renders `OrganizationConsole`
2. Parent/Owner:
   - `OrganizationConsole` owns profile/member loading and patch workflows.
3. Controller/Hook:
   - component-level state/effects handle auth-aware endpoint fetch, edit drafts, and save operations.
4. Children:
   - route-local profile form and membership rows.
5. Default behavior:
   - load profile + memberships for active organization and hydrate edit drafts.
6. Overrides:
   - `owner|pm` can edit org profile; owner-only can edit membership role/status.
7. Relationship flow:
   - route mount -> org fetch -> draft edit -> patch -> list/profile refresh.

## API Surface Used
1. `GET /organization/`
2. `PATCH /organization/`
3. `GET /organization/memberships/`
4. `PATCH /organization/memberships/{id}/`

## Backend Contracts Used
- Contract endpoint(s): none
- Consumed fields: none
- Behavior source: standard API responses from org profile and membership endpoints
- Fallback policy: n/a

## State Model (Remote, Local, Derived)
- State buckets:
  - Remote Data:
    - organization profile
    - organization memberships
    - role policy
  - Local UI State:
    - profile edit drafts
    - membership edit drafts
    - save/loading status
  - Derived State:
    - permission-driven control enabling/disabling
    - active-member count display

## Error and Empty States
- Error states:
  - missing shared session token
  - endpoint load failures
  - role-gate `403` errors for forbidden edits
  - validation errors for self-downgrade/self-disable/slug conflicts
- Empty states:
  - membership list empty (unlikely but explicitly handled)

## Test Anchors
- Existing anchors:
  - backend tests in `backend/core/tests/test_organization_management.py`
- TODO:
  - add frontend tests for profile save and membership role/status update flows
