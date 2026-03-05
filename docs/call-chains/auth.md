# Auth Call Chains

> **Line anchors are pinned manually.** Update after refactors that move function definitions.

End-to-end function call order for each auth action. User resolution and bootstrap helpers live in [`user_helpers.py`](../../backend/core/user_helpers.py); RBAC enforcement in [`rbac.py`](../../backend/core/rbac.py).

Parent doc: [`docs/auth.md`](../auth.md)

## Registration ([Flow A](../auth.md#flow-a-standard-registration-no-invite) — no invite)

Flow A returns a uniform "check your email" response regardless of whether the email exists (anti-enumeration). No auth token is returned — the user must verify their email first.

`FRONTEND` — [`HomeRegisterConsole`](../../frontend/src/features/session/components/home-register-console.tsx#L97)

- [`handleRegister()`](../../frontend/src/features/session/components/home-register-console.tsx#L235)
  - `fetch POST /auth/register/  { email, password }`

---

`BACKEND` — [`register_view`](../../backend/core/views/auth.py#L170)

*── validation ──*

- [`RegisterSerializer.is_valid()`](../../backend/core/serializers/auth.py#L29)

*── duplicate check (anti-enumeration) ──*

- `User.objects.filter(email__iexact=email).exists()`
- if exists → return `200 { data: { message } }` (same response as success)

*── atomic: user + membership + verification token ──*

- `transaction.atomic():`
  - `User.objects.create_user()`
  - [`_ensure_membership(user)`](../../backend/core/user_helpers.py#L134)
    - [`OrganizationMembership.objects.filter(user=…).first()`](../../backend/core/models/shared_operations/organization_membership.py#L9)
    - *── organization ──*
    - [`Organization.derive_name(user)`](../../backend/core/models/shared_operations/organization.py#L74)
    - [`build_org_defaults(…)`](../../backend/core/utils/organization_defaults.py#L20)
    - `Organization.objects.create(…)`
    - [`OrganizationRecord.record(…)`](../../backend/core/models/financial_auditing/organization_record.py#L66)
      - [`organization.build_snapshot()`](../../backend/core/models/shared_operations/organization.py#L50)
      - [`OrganizationRecord.objects.create(…)`](../../backend/core/models/financial_auditing/organization_record.py#L11)
    - *── membership ──*
    - [`OrganizationMembership.objects.create(…)`](../../backend/core/models/shared_operations/organization_membership.py#L9)
    - [`OrganizationMembershipRecord.record(…)`](../../backend/core/models/financial_auditing/organization_membership_record.py#L116)
      - [`membership.build_snapshot()`](../../backend/core/models/shared_operations/organization_membership.py#L71)
      - [`OrganizationMembershipRecord.objects.create(…)`](../../backend/core/models/financial_auditing/organization_membership_record.py#L25)
    - *── cost codes ──*
    - [`CostCode.seed_defaults(…)`](../../backend/core/models/shared_operations/cost_code.py#L57)
      - [`CostCode.objects.get_or_create(…)`](../../backend/core/models/shared_operations/cost_code.py#L64)
  - *── verification token ──*
  - [`EmailVerificationToken(user=user, email=email).save()`](../../backend/core/models/shared_operations/email_verification.py#L45)
    - auto-generates `secrets.token_urlsafe(32)` + 24h expiry

*── race condition guard ──*

- `except IntegrityError` → return same `200 { data: { message } }` (concurrent duplicate)

*── email (outside atomic) ──*

- [`send_verification_email(user, token_obj)`](../../backend/core/utils/email.py#L9)
  - builds URL: `{FRONTEND_URL}/verify-email?token={token}`
  - `django.core.mail.send_mail(…)` (console backend in dev)
  - [`EmailRecord.record(…)`](../../backend/core/models/shared_operations/email_verification.py#L135) — immutable audit log

---

`HTTP 200` → `FRONTEND`

- response: `{ data: { message: "Check your email to verify your account." } }`
- [`setCheckEmailSent(true)`](../../frontend/src/features/session/components/home-register-console.tsx#L258)
- renders "check your email" card with resend button
- resend button calls [`handleResendVerification()`](../../frontend/src/features/session/components/home-register-console.tsx#L280) → see [Resend Verification](#resend-verification) below

## Verify Email

User clicks the verification link in their email. This is their first login — consumes the token and returns a full auth payload.

`FRONTEND` — [`VerifyEmailConsole`](../../frontend/src/features/session/components/verify-email-console.tsx#L46)

- `useEffect` on mount
  - `fetch POST /auth/verify-email/  { token }` (token from URL query param)

---

`BACKEND` — [`verify_email_view`](../../backend/core/views/auth.py#L566)

*── validation ──*

- manual field check (`token` present) → 400 if not present

*── token lookup ──*

- [`EmailVerificationToken.lookup_valid(token_str)`](../../backend/core/models/shared_operations/email_verification.py#L69)
  - `EmailVerificationToken.objects.select_related("user").get(token=…)`
  - `token_obj.is_consumed` / `token_obj.is_expired`
  - returns `(token_obj, None)` or `(None, error_code)`
- error_code → [`_VERIFY_ERROR_MAP`](../../backend/core/views/auth.py#L557) → 404/410 response

*── consume token ──*

- `token_obj.consumed_at = timezone.now()`
- `token_obj.save(update_fields=["consumed_at"])`

*── membership (self-heal if needed) ──*

- [`_ensure_membership(user)`](../../backend/core/user_helpers.py#L134)

*── auth response ──*

- [`_build_auth_response_payload(user, membership)`](../../backend/core/views/auth.py#L27)
  - `Token.objects.get_or_create(user=user)`
  - [`_resolve_user_capabilities(user, membership=membership)`](../../backend/core/user_helpers.py#L58)

---

`HTTP 200` → `FRONTEND`

- [`saveClientSession({ token, email, role, organization, capabilities })`](../../frontend/src/features/session/client-session.ts#L80)
- `router.push("/")` — redirects to dashboard

*── error cases ──*

- `HTTP 404` → "Invalid verification link."
- `HTTP 410` → "This verification link has expired/already used." + shows resend form (email input + button)

## Resend Verification

Anti-enumeration: always returns 200 regardless of whether the email exists. Rate-limited to one token per 60 seconds.

`FRONTEND` — called from three places:
1. [`HomeRegisterConsole.handleResendVerification()`](../../frontend/src/features/session/components/home-register-console.tsx#L280) — on "check your email" screen after registration
2. [`HomeAuthConsole.handleResendVerification()`](../../frontend/src/features/session/components/home-auth-console.tsx#L179) — on login page after `email_not_verified` error
3. [`VerifyEmailConsole.handleResend()`](../../frontend/src/features/session/components/verify-email-console.tsx#L111) — on expired/consumed link page

- `fetch POST /auth/resend-verification/  { email }`

---

`BACKEND` — [`resend_verification_view`](../../backend/core/views/auth.py#L615)

*── validation ──*

- manual field check (`email` present)

*── anti-enumeration early exits ──*

- `User.objects.get(email__iexact=email)` → `DoesNotExist` → return 200 (no-op)
- [`EmailVerificationToken.is_user_verified(user)`](../../backend/core/models/shared_operations/email_verification.py#L86) → `True` → return 200 (no-op)

*── rate limit ──*

- `EmailVerificationToken.objects.filter(user=user).order_by("-created_at").first()`
- if `(now - latest.created_at) < 60s` → return `429`

*── create + send ──*

- [`EmailVerificationToken(user=user, email=user.email).save()`](../../backend/core/models/shared_operations/email_verification.py#L45)
- [`send_verification_email(user, token_obj)`](../../backend/core/utils/email.py#L9)
  - `django.core.mail.send_mail(…)`
  - [`EmailRecord.record(…)`](../../backend/core/models/shared_operations/email_verification.py#L135)

---

`HTTP 200` → `FRONTEND`

- response: `{ data: { message: "If that email is registered, a verification link has been sent." } }`
- `HTTP 429` → "Please wait before requesting another email."

## Registration ([Flow B](../auth.md#flow-b-invited-new-user) — invited new user)

Flow B is unchanged by email verification — the invite token proves email ownership.

`FRONTEND` — [`HomeRegisterConsole`](../../frontend/src/features/session/components/home-register-console.tsx#L97)

- `useEffect`
  - `fetch GET /auth/verify-invite/{token}/`

---

`BACKEND` — [`verify_invite_view`](../../backend/core/views/auth.py#L384)

*── invite validation ──*

- [`_lookup_valid_invite(token)`](../../backend/core/views/auth.py#L51)
  - [`OrganizationInvite.lookup_valid(token)`](../../backend/core/models/shared_operations/organization_invite.py#L85)
    - `OrganizationInvite.objects.get(token=…)`
    - `invite.is_consumed` / `invite.is_expired`

*── user lookup ──*

- `User.objects.filter(email__iexact=…).exists()`

---

`HTTP 200` → `FRONTEND`

- `setInviteFlow("flow-b")`, `setEmail(data.email)`
- [`handleRegister()`](../../frontend/src/features/session/components/home-register-console.tsx#L235)
  - `fetch POST /auth/register/  { email, password, invite_token }`

---

`BACKEND` — [`register_view`](../../backend/core/views/auth.py#L170)

*── validation ──*

- [`RegisterSerializer.is_valid()`](../../backend/core/serializers/auth.py#L29)
- [`_lookup_valid_invite(invite_token)`](../../backend/core/views/auth.py#L51)
  - [`OrganizationInvite.lookup_valid(invite_token)`](../../backend/core/models/shared_operations/organization_invite.py#L85)
- email match check (`invite.email` vs registration email)

*── atomic: user + membership + invite consumption ──*

- `transaction.atomic():`
  - `User.objects.create_user()`
  - *── membership (join invited org) ──*
  - [`OrganizationMembership.objects.create(…)`](../../backend/core/models/shared_operations/organization_membership.py#L9)
  - [`OrganizationMembershipRecord.record(…)`](../../backend/core/models/financial_auditing/organization_membership_record.py#L116)
    - [`membership.build_snapshot()`](../../backend/core/models/shared_operations/organization_membership.py#L71)
    - [`OrganizationMembershipRecord.objects.create(…)`](../../backend/core/models/financial_auditing/organization_membership_record.py#L25)
  - *── invite consumption ──*
  - `invite.save(update_fields=["consumed_at"])`

*── auth response ──*

- [`_build_auth_response_payload(user, membership)`](../../backend/core/views/auth.py#L27)
  - `Token.objects.get_or_create(user=user)`
  - [`_resolve_user_capabilities(user, membership=membership)`](../../backend/core/user_helpers.py#L58)

---

`HTTP 201` → `FRONTEND`

- [`completeAuth(payload)`](../../frontend/src/features/session/components/home-register-console.tsx#L215)
  - [`saveClientSession(…)`](../../frontend/src/features/session/client-session.ts#L80)
  - `router.push("/")`

## Accept Invite ([Flow C](../auth.md#flow-c-existing-user-org-switch) — existing user org-switch)

`FRONTEND` — [`HomeRegisterConsole`](../../frontend/src/features/session/components/home-register-console.tsx#L97)

- `useEffect`
  - `fetch GET /auth/verify-invite/{token}/`

---

`BACKEND` — [`verify_invite_view`](../../backend/core/views/auth.py#L384)

*── invite validation ──*

- [`_lookup_valid_invite(token)`](../../backend/core/views/auth.py#L51)
  - [`OrganizationInvite.lookup_valid(token)`](../../backend/core/models/shared_operations/organization_invite.py#L85)
    - `OrganizationInvite.objects.get(token=…)`
    - `invite.is_consumed` / `invite.is_expired`

*── user lookup ──*

- `User.objects.filter(email__iexact=…).exists()`

---

`HTTP 200` → `FRONTEND`

- `setInviteFlow("flow-c")` (`data.is_existing_user === true`)
- renders org-switch warning + password-only form
- [`handleAcceptInvite()`](../../frontend/src/features/session/components/home-register-console.tsx#L308)
  - `fetch POST /auth/accept-invite/  { invite_token, password }`

---

`BACKEND` — [`accept_invite_view`](../../backend/core/views/auth.py#L423)

*── validation ──*

- manual field check (`invite_token` + `password` present)
- [`_lookup_valid_invite(invite_token)`](../../backend/core/views/auth.py#L51)
  - [`OrganizationInvite.lookup_valid(invite_token)`](../../backend/core/models/shared_operations/organization_invite.py#L85)

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
  - [`OrganizationMembershipRecord.record(…)`](../../backend/core/models/financial_auditing/organization_membership_record.py#L116) (`event_type=ROLE_CHANGED`, `from_role`/`to_role`, `metadata={invite_id, previous_organization_id}`)
    - [`membership.build_snapshot()`](../../backend/core/models/shared_operations/organization_membership.py#L71)
    - [`OrganizationMembershipRecord.objects.create(…)`](../../backend/core/models/financial_auditing/organization_membership_record.py#L25)
  - *── invite consumption ──*
  - `invite.save(update_fields=["consumed_at"])`

*── auth response ──*

- [`_build_auth_response_payload(user, membership)`](../../backend/core/views/auth.py#L27)
  - `Token.objects.get_or_create(user=user)`
  - [`_resolve_user_capabilities(user, membership=membership)`](../../backend/core/user_helpers.py#L58)

---

`HTTP 200` → `FRONTEND`

- [`completeAuth(payload)`](../../frontend/src/features/session/components/home-register-console.tsx#L215)
  - [`toSessionOrganization(payload.data.organization)`](../../frontend/src/features/session/components/home-register-console.tsx#L80)
  - [`saveClientSession(…)`](../../frontend/src/features/session/client-session.ts#L80)
  - `router.push("/")`

## Login

`FRONTEND` — [`HomeAuthConsole`](../../frontend/src/features/session/components/home-auth-console.tsx#L80)

- [`handleLogin()`](../../frontend/src/features/session/components/home-auth-console.tsx#L120)
  - `fetch POST /auth/login/  { email, password }`

---

`BACKEND` — [`login_view`](../../backend/core/views/auth.py#L112)

*── validation ──*

- [`LoginSerializer.is_valid()`](../../backend/core/serializers/auth.py#L9)

*── email verification gate ──*

- [`EmailVerificationToken.is_user_verified(user)`](../../backend/core/models/shared_operations/email_verification.py#L86)
  - `EmailVerificationToken.objects.filter(user=user).exists()`
  - if tokens exist: `tokens.filter(consumed_at__isnull=False).exists()`
  - legacy/seed users (no tokens) → `True` (pass through)
  - unverified → `403 { error: { code: "email_not_verified" } }`

*── membership (self-heal if needed) ──*

- [`_ensure_membership(user)`](../../backend/core/user_helpers.py#L134)
  - [`OrganizationMembership.objects.filter(user=…).first()`](../../backend/core/models/shared_operations/organization_membership.py#L9)

*── auth response ──*

- [`_build_auth_response_payload(user, membership)`](../../backend/core/views/auth.py#L27)
  - `Token.objects.get_or_create(user=user)`
  - [`_resolve_user_capabilities(user, membership=membership)`](../../backend/core/user_helpers.py#L58)

---

`HTTP 200` → `FRONTEND`

- [`toSessionOrganization(payload.data.organization)`](../../frontend/src/features/session/components/home-auth-console.tsx#L63)
- [`saveClientSession({ token, email, role, organization, capabilities })`](../../frontend/src/features/session/client-session.ts#L80)
- `setIsAuthenticated(true)` → renders "Session ready" view

*── 403 email_not_verified ──*

- [`setEmailNotVerified(true)`](../../frontend/src/features/session/components/home-auth-console.tsx#L142)
- renders "Resend verification email" button alongside sign-in
- button calls [`handleResendVerification()`](../../frontend/src/features/session/components/home-auth-console.tsx#L179) → see [Resend Verification](#resend-verification)

---

*── page load ──*

`FRONTEND` — [`SessionAuthorizationProvider`](../../frontend/src/features/session/session-authorization.tsx#L54)

- [`useSharedSessionAuth()`](../../frontend/src/features/session/use-shared-session.ts#L55) — reads token from localStorage via `useSyncExternalStore`
- optimistically sets `status="authorized"`
- `fetch GET /auth/me/` with [`buildAuthHeaders(token, { organization })`](../../frontend/src/features/session/auth-headers.ts#L39)

---

`BACKEND` — [`me_view`](../../backend/core/views/auth.py#L282)

*── membership ──*

- [`_ensure_membership(user)`](../../backend/core/user_helpers.py#L134)

*── auth response ──*

- [`_build_auth_response_payload(user, membership)`](../../backend/core/views/auth.py#L27)
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
      - [`_ensure_membership(user)`](../../backend/core/user_helpers.py#L134)
        - [`OrganizationMembership.objects.filter(user=…).first()`](../../backend/core/models/shared_operations/organization_membership.py#L9)
      - [`RoleTemplate`](../../backend/core/models/shared_operations/role_template.py#L9) lookup (FK or system fallback)
      - merge `membership.capability_flags_json` overrides
    - `action in capabilities.get(resource, [])`

---

`HTTP 200 or 403`
