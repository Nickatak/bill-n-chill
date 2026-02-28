# Pass 1 Review Findings (TQ-015, TQ-012, TQ-014)

## Resolution Status (as of 2026-02-21)

1. Public snapshot token exposure risk
- Status: `resolved`
- Outcome:
  - Public project snapshot surface was removed from active code paths.
  - Public estimate sharing remains available via estimate-only token route.

2. CSV `dry_run` parsing for string booleans
- Status: `open`
- Current state:
  - `dry_run = bool(request.data.get("dry_run", True))` is still used in:
    - `backend/core/views/cost_codes.py`
    - `backend/core/views/vendors.py`
  - String `"false"` still evaluates truthy at runtime.

3. Multi-group legacy-role precedence escalation
- Status: `partially mitigated`
- Current state:
  - Active `OrganizationMembership.role` is now preferred over legacy group-role resolution.
  - Legacy-group precedence logic still exists as a fallback path for users without active membership.

4. Read-only role inconsistency on dictionary surfaces
- Status: `open`
- Current state:
  - Role gates are present on import endpoints.
  - `POST/PATCH` dictionary mutation for cost codes/vendors remains ungated by role in list/detail endpoints.
  - `viewer` can still mutate these surfaces unless blocked by other constraints.

## Findings (ordered by severity)

1. High - Public estimate token now unlocks full project financial snapshot without lifecycle/expiry guard
- `backend/core/views/estimates.py:66`
- `backend/core/views/estimates.py:89`
- `backend/core/views/estimates.py:103`
- `public_project_snapshot_view` accepts any estimate `public_token` and returns project-level contract/invoice/payment aggregates.
- There is no check for estimate state (e.g., approved only), no one-time use, no expiry, and no revocation path.
- Impact: any leaked/old estimate token can expose broader financial data than estimate preview scope.

2. Medium - CSV `dry_run` parsing is incorrect for string booleans
- `backend/core/views/cost_codes.py:51`
- `backend/core/views/vendors.py:189`
- `dry_run = bool(request.data.get("dry_run", True))` treats non-empty strings (including `"false"`) as `True`.
- Impact: API callers sending `"false"` may silently stay in preview mode instead of apply mode.

3. Medium - RBAC resolution can privilege-escalate users with multiple role groups
- `backend/core/views/helpers.py:131`
- `backend/core/views/helpers.py:151`
- Role precedence returns first match with `owner` highest; a user accidentally assigned multiple groups is elevated to strongest role.
- Impact: misconfigured group membership can grant broader write access than intended.

4. Medium - Read-only role model is inconsistent across write surfaces (cost codes/vendors remain writable)
- `backend/core/views/cost_codes.py:13`
- `backend/core/views/cost_codes.py:26`
- `backend/core/views/vendors.py:32`
- `backend/core/views/vendors.py:91`
- TQ-015 introduced broad money-write guards, but cost code/vendor create/update endpoints have no role gate.
- Impact: `viewer` users can still mutate foundational financial dictionaries, undermining the intended read-only posture.

## Open questions

1. None remaining for Pass 1.

## Decisions made

1. Public project snapshots are explicitly denied for now and removed from codebase.
2. Interim org policy: one user belongs to exactly one organization.
3. Public estimate sharing must remain org-slug independent (stable tokenized public links).
4. Org slug is treated as a non-authoritative URL alias/branding concern, not core identity for shared resource access.
5. Role model direction: not strict single-role-only semantics; use one primary preset role plus additive capability flags.
6. `viewer` is hard read-only across all mutating endpoints, including cost code/vendor dictionary maintenance.

## Validation/test gaps observed

1. No explicit test coverage found for CSV `dry_run` string parsing edge cases (`"false"`/`"0"`).
2. No explicit guard test found for public snapshot token lifecycle constraints (approved-only, expiry, revoke).
3. No explicit fail-closed test found for multi-group role assignment ambiguity.
