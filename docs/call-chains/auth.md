# Auth Call Chains

> **Line anchors are pinned manually.** Update after refactors that move function definitions.

End-to-end function call order for each auth action. User resolution and bootstrap helpers live in [`user_helpers.py`](../../backend/core/user_helpers.py); RBAC enforcement in [`rbac.py`](../../backend/core/rbac.py).

Parent doc: [`docs/auth.md`](../auth.md)

## Registration ([Flow A](../auth.md#flow-a-standard-registration-no-invite) — no invite)

`FRONTEND` — [`HomeRegisterConsole`](../../frontend/src/features/session/components/home-register-console.tsx#L90)

- [`handleRegister()`](../../frontend/src/features/session/components/home-register-console.tsx#L201)
  - `fetch POST /auth/register/  { email, password }`

---

`BACKEND` — [`register_view`](../../backend/core/views/auth.py#L157)

*── validation ──*

- [`RegisterSerializer.is_valid()`](../../backend/core/serializers/auth.py#L27)

*── user ──*

- `User.objects.create_user()`

- [`_ensure_membership(user)`](../../backend/core/user_helpers.py#L129)
  - [`OrganizationMembership.objects.filter(user=…).first()`](../../backend/core/models/shared_operations/organization_membership.py#L7)
  - *── organization ──*
  - [`Organization.derive_name(user)`](../../backend/core/models/shared_operations/organization.py#L63)
  - [`build_org_defaults(…)`](../../backend/core/utils/organization_defaults.py#L20)
  - `Organization.objects.create(…)`
  - [`OrganizationRecord.record(…)`](../../backend/core/models/financial_auditing/organization_record.py#L66)
    - [`organization.build_snapshot()`](../../backend/core/models/shared_operations/organization.py#L44)
    - [`OrganizationRecord.objects.create(…)`](../../backend/core/models/financial_auditing/organization_record.py#L8)
  - *── membership ──*
  - [`OrganizationMembership.objects.create(…)`](../../backend/core/models/shared_operations/organization_membership.py#L7)
  - [`OrganizationMembershipRecord.record(…)`](../../backend/core/models/financial_auditing/organization_membership_record.py#L118)
    - [`membership.build_snapshot()`](../../backend/core/models/shared_operations/organization_membership.py#L69)
    - [`OrganizationMembershipRecord.objects.create(…)`](../../backend/core/models/financial_auditing/organization_membership_record.py#L22)
  - *── cost codes ──*
  - [`CostCode.seed_defaults(…)`](../../backend/core/models/shared_operations/cost_code.py#L57)
    - [`CostCode.objects.get_or_create(…)`](../../backend/core/models/shared_operations/cost_code.py#L64)

*── auth response ──*

- [`_build_auth_response_payload(user, membership)`](../../backend/core/views/auth.py#L25)
  - `Token.objects.get_or_create(user=user)`
  - [`_resolve_user_role(user)`](../../backend/core/user_helpers.py#L43)
  - [`_resolve_user_capabilities(user)`](../../backend/core/user_helpers.py#L58)
    - [`_ensure_membership(user)`](../../backend/core/user_helpers.py#L129)
    - [`RoleTemplate.objects.filter(is_system=True, slug=…)`](../../backend/core/models/shared_operations/role_template.py#L7)

---

`HTTP 201` → `FRONTEND`

- [`completeAuth(payload)`](../../frontend/src/features/session/components/home-register-console.tsx#L181)
  - [`toSessionOrganization(payload.data.organization)`](../../frontend/src/features/session/components/home-register-console.tsx#L73)
  - [`saveClientSession({ token, email, role, organization, capabilities })`](../../frontend/src/features/session/client-session.ts#L80)
  - `router.push("/")`

## Registration ([Flow B](../auth.md#flow-b-invited-new-user) — invited new user)

`FRONTEND` — [`HomeRegisterConsole`](../../frontend/src/features/session/components/home-register-console.tsx#L90)

- `useEffect`
  - `fetch GET /auth/verify-invite/{token}/`

---

`BACKEND` — [`verify_invite_view`](../../backend/core/views/auth.py#L309)

*── invite validation ──*

- [`_lookup_valid_invite(token)`](../../backend/core/views/auth.py#L48)
  - [`OrganizationInvite.lookup_valid(token)`](../../backend/core/models/shared_operations/organization_invite.py#L79)
    - `OrganizationInvite.objects.get(token=…)`
    - `invite.is_consumed` / `invite.is_expired`

*── user lookup ──*

- `User.objects.filter(email__iexact=…).exists()`

---

`HTTP 200` → `FRONTEND`

- `setInviteFlow("flow-b")`, `setEmail(data.email)`
- [`handleRegister()`](../../frontend/src/features/session/components/home-register-console.tsx#L201)
  - `fetch POST /auth/register/  { email, password, invite_token }`

---

`BACKEND` — [`register_view`](../../backend/core/views/auth.py#L157)

*── validation ──*

- [`RegisterSerializer.is_valid()`](../../backend/core/serializers/auth.py#L27)
- [`_lookup_valid_invite(invite_token)`](../../backend/core/views/auth.py#L48)
  - [`OrganizationInvite.lookup_valid(invite_token)`](../../backend/core/models/shared_operations/organization_invite.py#L79)
- email match check (`invite.email` vs registration email)

*── atomic: user + membership + invite consumption ──*

- `transaction.atomic():`
  - `User.objects.create_user()`
  - *── membership (join invited org) ──*
  - [`OrganizationMembership.objects.create(…)`](../../backend/core/models/shared_operations/organization_membership.py#L7)
  - [`OrganizationMembershipRecord.record(…)`](../../backend/core/models/financial_auditing/organization_membership_record.py#L118)
    - [`membership.build_snapshot()`](../../backend/core/models/shared_operations/organization_membership.py#L69)
    - [`OrganizationMembershipRecord.objects.create(…)`](../../backend/core/models/financial_auditing/organization_membership_record.py#L22)
  - *── invite consumption ──*
  - `invite.save(update_fields=["consumed_at"])`

*── auth response ──*

- [`_build_auth_response_payload(user, membership)`](../../backend/core/views/auth.py#L25)
  - `Token.objects.get_or_create(user=user)`
  - [`_resolve_user_role(user)`](../../backend/core/user_helpers.py#L43)
  - [`_resolve_user_capabilities(user)`](../../backend/core/user_helpers.py#L58)

---

`HTTP 201` → `FRONTEND`

- [`completeAuth(payload)`](../../frontend/src/features/session/components/home-register-console.tsx#L181)
  - [`saveClientSession(…)`](../../frontend/src/features/session/client-session.ts#L80)
  - `router.push("/")`

## Accept Invite ([Flow C](../auth.md#flow-c-existing-user-org-switch) — existing user org-switch)

`FRONTEND` — [`HomeRegisterConsole`](../../frontend/src/features/session/components/home-register-console.tsx#L90)

- `useEffect`
  - `fetch GET /auth/verify-invite/{token}/`

---

`BACKEND` — [`verify_invite_view`](../../backend/core/views/auth.py#L309)

*── invite validation ──*

- [`_lookup_valid_invite(token)`](../../backend/core/views/auth.py#L48)
  - [`OrganizationInvite.lookup_valid(token)`](../../backend/core/models/shared_operations/organization_invite.py#L79)
    - `OrganizationInvite.objects.get(token=…)`
    - `invite.is_consumed` / `invite.is_expired`

*── user lookup ──*

- `User.objects.filter(email__iexact=…).exists()`

---

`HTTP 200` → `FRONTEND`

- `setInviteFlow("flow-c")` (`data.is_existing_user === true`)
- renders org-switch warning + password-only form
- [`handleAcceptInvite()`](../../frontend/src/features/session/components/home-register-console.tsx#L239)
  - `fetch POST /auth/accept-invite/  { invite_token, password }`

---

`BACKEND` — [`accept_invite_view`](../../backend/core/views/auth.py#L350)

*── validation ──*

- manual field check (`invite_token` + `password` present)
- [`_lookup_valid_invite(invite_token)`](../../backend/core/views/auth.py#L48)
  - [`OrganizationInvite.lookup_valid(invite_token)`](../../backend/core/models/shared_operations/organization_invite.py#L79)

*── user lookup + password confirmation ──*

- `User.objects.get(email__iexact=invite.email, is_active=True)`
- `user.check_password(password)` → 401 if invalid

*── idempotent short-circuit ──*

- `OrganizationMembership.objects.select_related("organization").filter(user=user).first()`
- if already in target org → consume token, return current auth context

*── atomic: membership move + invite consumption ──*

- `transaction.atomic():`
  - *── membership (move to invited org) ──*
  - `existing_membership.save(update_fields=["organization", "role", "role_template", "status", "updated_at"])`
  - [`OrganizationMembershipRecord.record(…)`](../../backend/core/models/financial_auditing/organization_membership_record.py#L118) (`event_type=ROLE_CHANGED`, `from_role`/`to_role`, `metadata={invite_id, previous_organization_id}`)
    - [`membership.build_snapshot()`](../../backend/core/models/shared_operations/organization_membership.py#L69)
    - [`OrganizationMembershipRecord.objects.create(…)`](../../backend/core/models/financial_auditing/organization_membership_record.py#L22)
  - *── invite consumption ──*
  - `invite.save(update_fields=["consumed_at"])`

*── auth response ──*

- [`_build_auth_response_payload(user, membership)`](../../backend/core/views/auth.py#L24)
  - `Token.objects.get_or_create(user=user)`
  - [`_resolve_user_capabilities(user, membership=membership)`](../../backend/core/user_helpers.py#L58)

---

`HTTP 200` → `FRONTEND`

- [`completeAuth(payload)`](../../frontend/src/features/session/components/home-register-console.tsx#L181)
  - [`toSessionOrganization(payload.data.organization)`](../../frontend/src/features/session/components/home-register-console.tsx#L73)
  - [`saveClientSession(…)`](../../frontend/src/features/session/client-session.ts#L80)
  - `router.push("/")`

## Login

`FRONTEND` — [`HomeAuthConsole`](../../frontend/src/features/session/components/home-auth-console.tsx#L79)

- [`handleLogin()`](../../frontend/src/features/session/components/home-auth-console.tsx#L117)
  - `fetch POST /auth/login/  { email, password }`

---

`BACKEND` — [`login_view`](../../backend/core/views/auth.py#L107)

*── validation ──*

- [`LoginSerializer.is_valid()`](../../backend/core/serializers/auth.py#L7)

*── membership (self-heal if needed) ──*

- [`_ensure_membership(user)`](../../backend/core/user_helpers.py#L129)
  - [`OrganizationMembership.objects.filter(user=…).first()`](../../backend/core/models/shared_operations/organization_membership.py#L7)

*── auth response ──*

- [`_build_auth_response_payload(user, membership)`](../../backend/core/views/auth.py#L24)
  - `Token.objects.get_or_create(user=user)`
  - [`_resolve_user_capabilities(user, membership=membership)`](../../backend/core/user_helpers.py#L58)

---

`HTTP 200` → `FRONTEND`

- [`toSessionOrganization(payload.data.organization)`](../../frontend/src/features/session/components/home-auth-console.tsx#L62)
- [`saveClientSession({ token, email, role, organization, capabilities })`](../../frontend/src/features/session/client-session.ts#L80)
- `setIsAuthenticated(true)` → renders "Session ready" view

---

*── page load ──*

`FRONTEND` — [`SessionAuthorizationProvider`](../../frontend/src/features/session/session-authorization.tsx#L54)

- [`useSharedSessionAuth()`](../../frontend/src/features/session/use-shared-session.ts#L55) — reads token from localStorage via `useSyncExternalStore`
- optimistically sets `status="authorized"`
- `fetch GET /auth/me/` with [`buildAuthHeaders(token, { organization })`](../../frontend/src/features/session/auth-headers.ts#L39)

---

`BACKEND` — [`me_view`](../../backend/core/views/auth.py#L258)

*── membership ──*

- [`_ensure_membership(user)`](../../backend/core/user_helpers.py#L129)

*── auth response ──*

- [`_build_auth_response_payload(user, membership)`](../../backend/core/views/auth.py#L24)
  - `Token.objects.get_or_create(user=user)`
  - [`_resolve_user_capabilities(user, membership=membership)`](../../backend/core/user_helpers.py#L58)

---

`HTTP 200` → `FRONTEND`

- [`saveClientSession({ …current, capabilities: fresh })`](../../frontend/src/features/session/client-session.ts#L80)
- `setStatus("authorized")`
- [`AuthGate`](../../frontend/src/shared/shell/auth-gate.tsx#L27)
  - `isAuthorized` → renders children

## First RBAC-Gated Request

`FRONTEND` — any console (e.g. [`estimates-console.tsx`](../../frontend/src/features/estimates/components/estimates-console.tsx))

*── UI gating ──*

- [`canDo(capabilities, resource, action)`](../../frontend/src/features/session/rbac.ts#L12)

*── request ──*

- [`buildAuthHeaders(token, { organization })`](../../frontend/src/features/session/auth-headers.ts#L39)
  - `Authorization: Token <key>`
  - `X-Organization-Id: <id>`

---

`BACKEND`

*── authentication ──*

- DRF TokenAuthentication middleware
  - `Token.objects.get(key=…)`

*── capability enforcement ──*

- View function (e.g. `estimates_view`)
  - [`_capability_gate(request.user, resource, action)`](../../backend/core/rbac.py#L18)
    - [`_resolve_user_capabilities(user)`](../../backend/core/user_helpers.py#L58)
      - [`_ensure_membership(user)`](../../backend/core/user_helpers.py#L129)
        - [`OrganizationMembership.objects.filter(user=…).first()`](../../backend/core/models/shared_operations/organization_membership.py#L7)
      - [`RoleTemplate`](../../backend/core/models/shared_operations/role_template.py#L7) lookup (FK or system fallback)
      - merge `membership.capability_flags_json` overrides
    - `action in capabilities.get(resource, [])`

---

`HTTP 200 or 403`
