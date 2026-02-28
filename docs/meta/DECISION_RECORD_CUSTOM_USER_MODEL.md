# Decision Record: Custom Django User Model

Date: 2026-02-21
Status: Accepted (defer)

## Decision
- Do not migrate to a custom Django user model right now.
- Continue using default `auth.User` with application-level email-first login behavior.

## Context
- Current auth flow accepts email/password via API.
- Backend currently creates users with:
  - `username = email`
  - `email = email`
- Org and RBAC work is now active and higher priority than identity-model refactor.

## Rationale
1. Late custom-user migration in Django is high-risk and high-effort.
2. Current product bottlenecks are org scoping, RBAC correctness, and workflow hardening.
3. Unused default user fields are low operational cost compared to migration complexity.

## Consequences
- Short-term:
  - Faster progress on domain features and permission model.
  - Lower migration risk while data model is still evolving.
- Tradeoff:
  - Some auth/user semantics remain app-layer conventions instead of model-level constraints.

## Revisit Triggers
Re-open this decision if any of the following becomes required:
1. Canonical email-only identity at model/database level.
2. SSO/IdP integration requiring richer identity mapping fields.
3. User lifecycle/compliance requirements not cleanly supported by profile/membership layers.
4. Multi-org membership semantics needing deeper auth model customization.

## Interim Guidance
- Treat email as login identity in serializers/views.
- Keep org identity and role/permissions in org membership layer.
- Prefer additive profile/membership extensions over user-model replacement.
