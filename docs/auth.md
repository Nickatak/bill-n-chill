# Authentication and RBAC

Comprehensive reference for the auth system, session management, invite flow, and capability-based access control.

**Last updated:** 2026-03-04 (v0.2.0)

---

## Table of Contents

- [Overview](#overview)
- [Auth Endpoints](#auth-endpoints)
- [Registration Flows](#registration-flows)
- [Invite Lifecycle](#invite-lifecycle)
- [Session Management (Frontend)](#session-management-frontend)
- [RBAC: Capability Resolution](#rbac-capability-resolution)
- [RBAC: Enforcement](#rbac-enforcement)
- [Permission Matrix](#permission-matrix)
- [Self-Healing Bootstrap](#self-healing-bootstrap)
- [Security Notes](#security-notes)

---

## Overview

Bill n' Chill uses **DRF token authentication** with a **capability-based RBAC** layer.

- **Token type:** `rest_framework.authtoken.Token` — opaque, server-generated, no expiry.
- **Header format:** `Authorization: Token <key>`
- **Org model:** Each user has exactly one `OrganizationMembership` (OneToOneField). Multi-org is not supported — accepting an invite to a new org **moves** the user's membership ([Flow C](#flow-c-invited-existing-user-org-switch)).
- **Session storage:** Frontend persists `{ token, email, role, organization, capabilities }` in localStorage under `bnc-session-v1`.
- **Capability resolution:** Capabilities flow from `RoleTemplate.capability_flags_json`, with optional additive overrides from `OrganizationMembership.capability_flags_json`. See [RBAC: Capability Resolution](#rbac-capability-resolution).

### Key Source Files

| Layer | File | Purpose |
|---|---|---|
| Backend | [`views/auth.py`](../backend/core/views/auth.py) | Login, register, me, verify-invite, accept-invite |
| Backend | [`views/helpers.py`](../backend/core/views/helpers.py) | Financial helpers, org scoping, re-exports RBAC gates |
| Backend | [`user_helpers.py`](../backend/core/user_helpers.py) | `_resolve_user_role`, `_resolve_user_capabilities`, `_ensure_membership` |
| Backend | [`rbac.py`](../backend/core/rbac.py) | `_capability_gate` (enforcement) |
| Backend | [`models/shared_operations/organization_invite.py`](../backend/core/models/shared_operations/organization_invite.py) | OrganizationInvite model |
| Frontend | [`features/session/client-session.ts`](../frontend/src/features/session/client-session.ts) | Session persistence (localStorage read/write/clear) |
| Frontend | [`features/session/session-authorization.tsx`](../frontend/src/features/session/session-authorization.tsx) | `SessionAuthorizationProvider` — token verification, capability refresh |
| Frontend | [`features/session/use-shared-session.ts`](../frontend/src/features/session/use-shared-session.ts) | `useSharedSessionAuth` — reactive session hook |
| Frontend | [`features/session/auth-headers.ts`](../frontend/src/features/session/auth-headers.ts) | `buildAuthHeaders` — attaches token + `X-Organization-Id` |
| Frontend | [`features/session/rbac.ts`](../frontend/src/features/session/rbac.ts) | `canDo(capabilities, resource, action)` |
| Frontend | [`shared/shell/auth-gate.tsx`](../frontend/src/shared/shell/auth-gate.tsx) | `AuthGate` — blocks protected routes until session verified |

### Call Chains

See [`docs/call-chains/auth.md`](call-chains/auth.md) for end-to-end function call traces (registration, login, RBAC-gated requests).

---

## Auth Endpoints

All endpoints are under `/api/v1/auth/`.

### `POST /auth/login/`

**Auth:** AllowAny

Authenticates email+password, returns token and full auth context.

```
Request:  { "email": "...", "password": "..." }
Response: { "data": { "token": "...", "user": { "id", "email", "role" }, "organization": { "id", "display_name" }, "capabilities": { ... } } }
```

Calls [`_ensure_membership()`](#self-healing-bootstrap) to self-heal users missing an org.

### `POST /auth/register/`

**Auth:** AllowAny

Creates a new user account. Supports two flows based on `invite_token` presence — see [Registration Flows](#registration-flows).

```
Request:  { "email": "...", "password": "...", "invite_token": "..." (optional) }
Response: { "data": { "token": "...", "user": { ... }, "organization": { ... }, "capabilities": { ... } } }
Status:   201
```

### `GET /auth/me/`

**Auth:** IsAuthenticated

Returns current user profile, org context, and capabilities. Used by the frontend [auth gate](#auth-gate) on page load to verify the token is still valid and to refresh capabilities.

```
Response: { "data": { "id", "email", "role", "organization": { "id", "display_name" }, "capabilities": { ... } } }
```

Note: Response shape differs from login/register — no `token` wrapper, flat user fields. This is for backwards compatibility.

### `GET /auth/verify-invite/<token>/`

**Auth:** AllowAny

Validates an invite token without consuming it. Returns context the frontend needs to render the correct registration flow.

```
Response: { "data": { "organization_name": "...", "email": "...", "role": "...", "is_existing_user": true|false } }
Errors:   404 (not found), 410 (expired or consumed)
```

The `is_existing_user` flag tells the frontend whether to show [Flow B](#flow-b-invited-new-user) (register) or [Flow C](#flow-c-invited-existing-user-org-switch) (org-switch confirmation).

### `POST /auth/accept-invite/`

**Auth:** AllowAny

[Flow C](#flow-c-invited-existing-user-org-switch) endpoint — existing user confirms password to switch orgs. See [Registration Flows](#registration-flows).

```
Request:  { "invite_token": "...", "password": "..." }
Response: { "data": { "token": "...", "user": { ... }, "organization": { ... }, "capabilities": { ... } } }
Errors:   400 (missing fields), 401 (wrong password), 404 (no user/invite), 410 (expired/consumed)
```

### `GET /auth/health/`

**Auth:** AllowAny

Liveness probe. Returns `{ "data": { "status": "ok" } }`.

---

## Registration Flows

Three flows converge on the `/register` page. The frontend determines which flow to use based on the presence and verification of an [invite token](#invite-lifecycle).

### Flow A: Standard Registration (no invite)

1. User visits `/register` with no `?token=` param.
2. Frontend shows standard registration form (email + password).
3. `POST /auth/register/` — no `invite_token` in body.
4. Backend creates user, calls [`_ensure_membership()`](#self-healing-bootstrap) which creates a new org + owner membership.
5. Frontend saves session, redirects to app.

### Flow B: Invited New User

1. User receives invite link: `/register?token=<token>`.
2. Frontend calls [`GET /auth/verify-invite/<token>/`](#get-authverify-invitetoken) on mount.
3. `is_existing_user: false` → show register form with invite context banner ("You've been invited to join **{org}** as **{role}**"). Email is pre-filled and read-only.
4. `POST /auth/register/` with `invite_token` in body.
5. Backend validates: token valid, email matches (case-insensitive).
6. Within `transaction.atomic()`: creates user, creates membership in invited org with invited role/role_template, records audit event, consumes invite (`consumed_at = now()`).
7. Frontend saves session, redirects to app.

### Flow C: Invited Existing User (Org Switch)

1. User receives invite link, already has an account.
2. Frontend calls [`GET /auth/verify-invite/<token>/`](#get-authverify-invitetoken).
3. `is_existing_user: true` → show confirmation screen with warning ("Accepting moves you from your current org to **{org}**. You will lose access to your current org's data."). Password-only field.
4. [`POST /auth/accept-invite/`](#post-authaccept-invite) with `invite_token` + `password`.
5. Backend validates: token valid, user found by invite email, password correct.
6. **Idempotent case:** If user is already in the target org, consume token and return current context.
7. **Move case:** Within `transaction.atomic()`: updates existing `OrganizationMembership` row (organization, role, role_template, status), records audit event with `previous_organization_id`, consumes invite.
8. Frontend saves session, redirects to app.

**Critical:** `OrganizationMembership` uses `OneToOneField(user)`, so [Flow C](#flow-c-invited-existing-user-org-switch) **updates** the existing row rather than creating a second one.

---

## Invite Lifecycle

### Model: [`OrganizationInvite`](../backend/core/models/shared_operations/organization_invite.py)

| Field | Type | Notes |
|---|---|---|
| `organization` | FK → Organization | CASCADE |
| `email` | EmailField | Who the invite is for |
| `role` | CharField | Role to assign on acceptance (default: viewer) |
| `role_template` | FK → RoleTemplate | Optional, SET_NULL |
| `token` | CharField(64) | `secrets.token_urlsafe(32)`, unique, indexed |
| `invited_by` | FK → User | PROTECT |
| `expires_at` | DateTimeField | 24 hours from creation |
| `consumed_at` | DateTimeField | Set when used (nullable) |
| `created_at` | DateTimeField | auto_now_add |

Properties: `is_expired`, `is_consumed`, `is_valid`.

### CRUD Endpoints

| Method | Path | Gate | Purpose |
|---|---|---|---|
| GET | `/api/v1/organization/invites/` | [`users.invite`](#permission-matrix) | List pending (unexpired + unconsumed) invites for caller's org |
| POST | `/api/v1/organization/invites/` | [`users.invite`](#permission-matrix) | Create invite. 409 if active invite exists for same email+org |
| DELETE | `/api/v1/organization/invites/<id>/` | [`users.invite`](#permission-matrix) | Revoke (hard delete). Must belong to caller's org |

### Token Lifecycle

```
Created (POST /organization/invites/)
  │
  ├─ Verified (GET /auth/verify-invite/<token>/) — read-only, no state change
  │
  ├─ Consumed (register Flow B or accept-invite Flow C) — consumed_at set
  │
  └─ Expired (24h elapsed) — is_expired returns true, no DB write
```

### Frontend UX

The invite section in the [org console](../frontend/src/features/organization/components/organization-console.tsx) is gated by [`canDo(capabilities, "users", "invite")`](#frontend-candocapabilities-resource-action). It provides:
- Create form (email + role dropdown)
- Copy-link banner after creation (`{origin}/register?token={token}`)
- Pending invite list with copy and revoke buttons

The invite fetch is best-effort (`.catch(() => null)`) so users without `users.invite` don't see errors.

---

## Session Management (Frontend)

### Storage

Session is persisted in `localStorage` under `bnc-session-v1` via [`client-session.ts`](../frontend/src/features/session/client-session.ts):

```typescript
type ClientSession = {
  token: string;
  email: string;
  role?: SessionRole;              // "owner" | "pm" | "bookkeeping" | "worker" | "viewer"
  organization?: SessionOrganization;  // { id: number, displayName: string }
  capabilities?: Capabilities;     // Record<string, string[]>
};
```

### Reactivity

[`useSharedSessionAuth()`](../frontend/src/features/session/use-shared-session.ts) uses `useSyncExternalStore` to subscribe to:
- **Same-tab changes:** `bnc-session-change` custom DOM event (fired by `saveClientSession` / `clearClientSession`)
- **Cross-tab changes:** `storage` event (fired by browser when another tab modifies localStorage)

### Auth Gate

[`AuthGate`](../frontend/src/shared/shell/auth-gate.tsx) wraps the entire app tree in `layout.tsx`. On mount:

1. [`SessionAuthorizationProvider`](../frontend/src/features/session/session-authorization.tsx) reads token from localStorage via `useSharedSessionAuth()`.
2. If token exists, calls [`GET /auth/me/`](#get-authme) to verify.
3. On success: refreshes capabilities in localStorage from `/me/` response, sets `status = "authorized"`.
4. On 401/403: clears session, sets `status = "unauthorized"`.
5. On transient error (network failure, 5xx): preserves authorized state to avoid login-screen flicker.
6. `AuthGate` checks `isAuthorized` / `isChecking` — blocks rendering of protected routes until resolved, redirects to `/` if unauthorized.

Public routes (login, register, public document previews) bypass the gate entirely.

### Request Headers

[`buildAuthHeaders(token, options)`](../frontend/src/features/session/auth-headers.ts) constructs headers for every authenticated API call:
- `Authorization: Token <token>`
- `X-Organization-Id: <id>` (when org context available)
- Optional `Content-Type` override

---

## RBAC: Capability Resolution

### Resolution Chain

[`_resolve_user_capabilities(user)`](../backend/core/user_helpers.py) in [`user_helpers.py`](../backend/core/user_helpers.py):

```
1. Find user's active OrganizationMembership
2. If membership has role_template (FK):
   → Use role_template.capability_flags_json as base
3. Else (legacy/no template):
   → Find system RoleTemplate matching membership.role slug
   → Use its capability_flags_json as base
4. If membership has capability_flags_json overrides:
   → Merge additively (add actions, never remove)
5. Return merged capabilities dict
```

### Capability Shape

```json
{
  "estimates": ["view", "create", "edit", "approve", "send"],
  "invoices": ["view", "create", "edit"],
  "users": ["view", "invite"],
  ...
}
```

Keys are resource names, values are arrays of allowed actions. Stored as a JSONField — no migration needed to add new resources or actions.

### Override Policy

- Templates are the primary permission mechanism (system presets or org-scoped custom templates).
- Per-membership `capability_flags_json` is **additive-only** — can grant extra actions, never revoke.
- To restrict below template permissions, assign a different template. No deny/subtract syntax.
- Ad-hoc overrides are discouraged. For recurring patterns, create a named custom template.

---

## RBAC: Enforcement

### Backend: [`_capability_gate(user, resource, action)`](../backend/core/rbac.py)

Every write endpoint calls `_capability_gate` before performing mutations:

```python
error, capabilities = _capability_gate(request.user, "estimates", "send")
if error:
    return Response(error, status=403)
```

Returns `(None, capabilities)` on success, `(error_payload, capabilities)` on failure. The error payload includes `fields.capability = ["Required: {resource}.{action}."]` for debuggability.

Read endpoints are generally ungated — all roles have `view` on all resources.

### Frontend: [`canDo(capabilities, resource, action)`](../frontend/src/features/session/rbac.ts)

UI gating uses the capabilities dict stored in the [session](#storage):

```typescript
const canSend = canDo(capabilities, "estimates", "send");
const canApprove = canDo(capabilities, "estimates", "approve");
```

**Two gating strategies are used:**

1. **Disable buttons** — for create/edit mutations. Submit buttons get `disabled={!canMutate}`.
2. **Filter options** — for status transitions. Unauthorized status options are removed entirely from the UI rather than shown disabled. Example: a worker sees "draft" and "sent" but not "approved" in the status pill selector.

The `hasAnyRole(role, allowedRoles)` helper still exists for legacy compatibility but `canDo` is the preferred approach.

---

## Permission Matrix

Five system roles with preset capability matrices, seeded in migration [`0002_rbac_phase1.py`](../backend/core/migrations/0002_rbac_phase1.py):

| Resource | Owner | PM | Worker | Bookkeeping | Viewer |
|---|---|---|---|---|---|
| estimates | view, create, edit, approve, send | view, create, edit, approve, send | view, create, edit, send | view | view |
| change_orders | view, create, edit, approve, send | view, create, edit, approve, send | view, create, edit, send | view | view |
| invoices | view, create, edit, approve, send | view, create, edit, approve, send | view, create, edit, send | view, create, edit | view |
| vendor_bills | view, create, edit, approve, pay | view, create, edit, approve, pay | view, create, edit | view, create, edit, approve, pay | view |
| projects | view, create, edit | view, create, edit | view, create, edit | view | view |
| customers | view, create, edit, disable | view, create, edit, disable | view, create, edit | view | view |
| cost_codes | view, create, edit, disable | view, create, edit, disable | view, create, edit | view, create, edit | view |
| vendors | view, create, edit, disable | view, create, edit, disable | view, create, edit | view, create, edit | view |
| budgets | view | view | view | view | view |
| org_identity | view, edit | view | view | view | view |
| org_presets | view, edit | view, edit | view | view | view |
| users | view, invite, edit_role, disable | view, invite, edit_role, disable | — | — | — |
| financial_audit | view | view | view | view | view |

### Role Summaries

- **Owner:** Full access. Only role with `org_identity.edit`.
- **PM:** Everything except `org_identity.edit`. Full user management.
- **Worker:** Day-to-day document work (create/edit/send). No approve, no pay, no disable, no org settings edit, no user management.
- **Bookkeeping:** Financial record-keeper. Full vendor_bills lifecycle (approve/pay). Can create/edit invoices but not send. Manages cost codes and vendors. Read-only on estimates, COs, projects, customers, org settings.
- **Viewer:** Read-only across all resources. No user management.

### Capability Surface

```
estimates:        view, create, edit, approve, send
change_orders:    view, create, edit, approve, send
invoices:         view, create, edit, approve, send
vendor_bills:     view, create, edit, approve, pay
projects:         view, create, edit
customers:        view, create, edit, disable
cost_codes:       view, create, edit, disable
vendors:          view, create, edit, disable
payments:         view, create, edit, allocate
budgets:          view, edit
org_identity:     view, edit
org_presets:      view, edit
users:            view, invite, edit_role, disable
financial_audit:  view
accounting_sync:  view, create, retry
```

No `delete` action exists anywhere in the system. Everything is status-driven.

---

## Self-Healing Bootstrap

[`_ensure_membership(user)`](../backend/core/user_helpers.py#L107) in [`user_helpers.py`](../backend/core/user_helpers.py) is called during [login](#post-authlogin) and [`/me/`](#get-authme) to handle users who lack an active org membership.

When triggered:
1. Creates a new `Organization` with defaults derived from the user's email via [`Organization.derive_name()`](../backend/core/models/shared_operations/organization.py#L63) and [`build_org_defaults()`](../backend/core/utils/organization_defaults.py#L20).
2. Creates an `OrganizationMembership` (role defaults to owner).
3. Seeds default cost codes for the org.
4. Records immutable `OrganizationRecord` and `OrganizationMembershipRecord` with `capture_source=AUTH_BOOTSTRAP`.

This primarily exists as a safety net for:
- Users created before the org system existed (legacy).
- Edge cases where membership data is missing.

Normal registration ([Flow A](#flow-a-standard-registration-no-invite)) also goes through this path. [Flow B](#flow-b-invited-new-user) creates the membership explicitly (joining the invited org) and skips the bootstrap.

---

## Security Notes

- **No token expiry:** DRF tokens do not expire. The token lives until the user logs out (client-side clear) or the token row is deleted server-side. This is a known tradeoff for simplicity at current scale.
- **Invite security:** See [`docs/decisions/invite-flow-security.md`](decisions/invite-flow-security.md) for threat model and mitigations. Key points:
  - Tokens are `secrets.token_urlsafe(32)` (43 chars, ~192 bits of entropy).
  - 24-hour expiry limits exposure window.
  - Email-bound: only the invited email can consume the token.
  - [Flow C](#flow-c-invited-existing-user-org-switch) requires password confirmation to prevent silent org-switching.
- **Email enumeration:** Registration currently reveals whether an email is taken (standard Django behavior). Deferred.
- **Org scoping:** All data queries filter by `organization_id=membership.organization_id` (direct org scoping via `_ensure_membership()`), ensuring users can only access data belonging to their org. This is the primary data isolation boundary.
- **Optimistic auth:** The frontend [auth gate](#auth-gate) optimistically shows the authorized UI while [`/me/`](#get-authme) verification is in flight. Only hard 401/403 triggers logout. Transient errors (network, 5xx) preserve the session to avoid login-screen flicker.
