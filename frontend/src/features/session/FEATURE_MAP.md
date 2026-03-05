# Feature Map: Session

## Purpose
Provide login/registration UX, persisted browser session state (token + role + organization), and shared auth signal for all feature consoles.

## Route Surface
1. `/` (unauthenticated shell uses login component)
2. `/register`

## Mutation Map
1. `BrowserSession`
   - create/update local session auth context (`POST /auth/login/`, `POST /auth/register/`)
   - clear local session token (signout or expiry path)
2. `UserSessionValidation`
   - verify token validity (`GET /auth/me/`)
3. `InviteFlow`
   - verify invite token (`GET /auth/verify-invite/{token}/`)
   - accept invite as existing user (`POST /auth/accept-invite/`)

## Composition and Entry Flow
1. Entry sources:
   - direct route entry: `frontend/src/app/home-route-content.tsx` renders `HomeAuthConsole` in unauthenticated shell
   - direct route entry: `frontend/src/app/register/page.tsx` renders `HomeRegisterConsole`
   - feature export entry: `frontend/src/features/session/index.ts` exports session components and utilities
2. Parent/Owner:
   route-level auth pages own session console mounting.
3. Controller/Hook:
   `useSharedSessionAuth` coordinates cross-tab/session-change updates; local session-storage utilities own localStorage reads/writes.
4. Children:
   `HomeAuthConsole`, `HomeRegisterConsole`, shared session utility modules.
5. Default behavior:
   login/register submit creates local session auth context, then `auth/me` verification drives authenticated shell rendering.
6. Overrides:
   invalid or expired tokens clear local session and force unauthenticated rendering path.
7. Relationship flow:
   route mount -> console submit/check -> session utility mutation -> shared-store signal -> app shell re-render.

## API Surface Used
1. `POST /auth/login/`:
   authenticates credentials and returns session payload for local persistence.
2. `POST /auth/register/`:
   creates user account and returns session payload for immediate authenticated state.
3. `GET /auth/me/`:
   validates stored token and hydrates authenticated user context.
4. `GET /health/`:
   consumed by route wrappers and surfaced through session-aware home rendering.
5. Authenticated feature requests:
   all token-authenticated frontend calls send `X-Organization-Id`
   header when organization context exists in the local shared session.
6. `GET /auth/verify-invite/{token}/`:
   validates invite token and returns org name, email, role, and `is_existing_user` flag.
7. `POST /auth/accept-invite/`:
   Flow C — existing user accepts invite with password confirmation; returns session payload.

## Backend Contracts Used
- Contract endpoint(s): none
- Consumed fields: none
- Behavior source: standard API responses from `POST /auth/login/`, `POST /auth/register/`, and `GET /auth/me/`
- Fallback policy: n/a (no contract adapter in this feature)

## State Model (Remote, Local, Derived)
- State buckets:
  - Remote Data:
    - login/register response payloads
    - `auth/me` verification payload
  - Local UI State:
    - credential form fields
    - checking/submitting flags
    - auth/session status messages
  - Derived State:
    - authenticated shell vs unauthenticated shell routing/rendering

## Error and Empty States
- Error states:
  - invalid login credentials
  - registration validation failures
  - expired/invalid token on `auth/me`
  - auth endpoint reachability failures
- Empty states:
  - no stored session token yet (initial unauthenticated state)

## Test Anchors
- Existing anchors:
  - backend tests in `backend/core/tests/test_health_auth.py`
  - backend invite tests in `backend/core/tests/test_invites.py`
  - frontend tests in `frontend/src/features/session/__tests__/auth-headers.test.ts`
- TODO:
  - add frontend tests for local session persistence and clear-on-expiry behavior
  - add frontend tests for auth-state transitions across route mounts
