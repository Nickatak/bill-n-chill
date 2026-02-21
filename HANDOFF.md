# Handoff - 2026-02-21

## What was completed
- Added explicit money precision policy + enforcement:
  - New utility: `backend/core/utils/money.py`
  - Enforced 2-decimal `ROUND_HALF_UP` quantization across estimate/invoice/payment/vendor-bill/change-order calculations.
  - Updated docs: `docs/api.md` (`Money Precision Policy`).
  - Added rounding regression tests:
    - `backend/core/tests/test_estimates.py`
    - `backend/core/tests/test_invoices.py`

- Clarified customer/project address boundaries:
  - Added `Project.site_address` in model + migration:
    - `backend/core/models/projects.py`
    - `backend/core/migrations/0031_project_site_address.py`
  - Lead conversion now seeds `Project.site_address` from `LeadContact.project_address`:
    - `backend/core/views/intake.py`
  - Project serializers expose `site_address`:
    - `backend/core/serializers/projects.py`
  - Updated docs:
    - `docs/api.md`
    - `docs/domain-model.md`

- CostCode policy hardening:
  - `CostCode` is non-deletable (instance and queryset delete blocked).
  - `CostCode.code` is immutable after create (PATCH rejects code changes).
  - Retirement path remains `is_active=false`.

- CostCode tenancy migration to org scope:
  - Added `CostCode.organization` and switched uniqueness to `(organization, code)`:
    - `backend/core/models/projects.py`
    - `backend/core/migrations/0032_alter_costcode_unique_together_costcode_organization_and_more.py`
  - Migration backfills `CostCode.organization` from active memberships; self-heals missing membership/org for legacy users.
  - Cost-code queries now resolve by active org with legacy fallback for null-org + `created_by` rows:
    - `backend/core/views/cost_codes.py`
    - `backend/core/views/helpers.py`

- Documentation cleanup in model docstrings:
  - `backend/core/models/organizations.py`
  - `backend/core/models/contacts.py`
  - `backend/core/models/projects.py`
  - Explicitly documented:
    - `Customer` as canonical contact representation.
    - `Customer.billing_address` as billing-only.
    - `Project.site_address` as job/service location.

- Frontend terminology update:
  - Re-labeled Contacts surface to Customers in user-facing copy/nav/breadcrumbs while keeping route path stable (`/contacts`):
    - `frontend/src/app/nav-routes.ts`
    - `frontend/src/app/workflow-breadcrumbs.tsx`
    - `frontend/src/app/contacts/page.tsx`
    - `frontend/src/features/contacts/components/contacts-console.tsx`

## Test status
- Ran and passing:
  - `core.tests.test_health_auth`
  - `core.tests.test_contacts_management`
  - `core.tests.test_intake`
  - `core.tests.test_projects_cost_codes`
  - `core.tests.test_estimates`
  - `core.tests.test_invoices`
  - `core.tests.test_payments`
  - `core.tests.test_vendor_bills`
  - `core.tests.test_change_orders`
- Aggregate run: `135` tests passed.

## Important implementation notes
- `CostCode` org-scoping is intentionally transitional:
  - New rows are org-scoped.
  - Legacy null-org rows remain readable via fallback (`organization is null` + `created_by=user`) until fully cleaned.
- Role bootstrap behavior:
  - Membership self-heal now inherits legacy group role when available (`viewer`, `bookkeeping`, etc.) instead of always defaulting to `owner`.
  - This preserved `RoleHardeningTests` expectations.

## Suggested next sequence
1. Apply migrations:
   - `backend/.venv/bin/python backend/manage.py migrate`
2. Continue model-by-model workflow review in order (next domain model after `projects.py`).
3. Plan final cleanup milestone:
   - Remove legacy null-org fallback paths after data migration confidence is high.

## Useful commands
- Targeted backend suite used in this session:
  - `cd backend && DATABASE_URL=sqlite:///db.sqlite3 ./.venv/bin/python manage.py test core.tests.test_health_auth core.tests.test_contacts_management core.tests.test_intake core.tests.test_projects_cost_codes core.tests.test_estimates core.tests.test_invoices core.tests.test_payments core.tests.test_vendor_bills core.tests.test_change_orders`
- Migration status:
  - `backend/.venv/bin/python backend/manage.py showmigrations core`

## Branch / remote
- Branch: `main`
- Remote: `origin` (`git@github.com:Nickatak/bill-n-chill.git`)
