# HANDOFF - 2026-02-26

## Session State

- Workspace: `/home/nick/bill_n_chill`
- Branch: `main`
- Upstream: `origin/main`
- Latest pushed commit: `6c14e8a`
- Active direction: public customer approval flows for Estimate / Change Order / Invoice

## What Is Stable Right Now

### Public Approval Endpoints

- Estimate:
  - `GET /api/v1/public/estimates/<token>/` (existing)
  - `POST /api/v1/public/estimates/<token>/decision/` (new)
  - Decision policy: only while `status == sent`, supports `approve` and `reject`.
  - Approval path triggers the existing estimate->budget conversion logic.

- Change Order:
  - `GET /api/v1/public/change-orders/<token>/` (new)
  - `POST /api/v1/public/change-orders/<token>/decision/` (new)
  - Decision policy: only while `status == pending_approval`, supports `approve` and `reject`.
  - Approval applies CO financial delta into project + active budget totals.

- Invoice:
  - `GET /api/v1/public/invoices/<token>/` (existing)
  - `POST /api/v1/public/invoices/<token>/decision/` (new)
  - Decision policy: only while `status in {sent, partially_paid, overdue}`.
  - `approve` marks invoice as `paid`; `dispute` records note/audit event without status change.

### Public Share Identity

- Change orders now have `public_token` + derived `public_ref` (slug + token form).
- Public CO page route added: `/change-order/[publicRef]`.

### Public UI Coverage

- Estimate public preview now includes decision form (name/email/note + approve/reject).
- Change order public preview page added with full CO review and approve/reject actions.
- Invoice public preview now includes decision form (name/email/note + approve/dispute).
- Internal CO viewer now includes `Open Public CO` link when `public_ref` exists.

### Auditability

- Public decisions are written as explicit lifecycle/audit notes and include optional decider metadata.
- Conflict handling uses `409` when item is not awaiting customer decision.
- Validation handling uses `400` for invalid decision payloads.

## Validation Run

- Backend tests:
  - `backend/.venv/bin/python backend/manage.py test core.tests.test_estimates core.tests.test_change_orders core.tests.test_invoices --keepdb --noinput`
  - Result: `123` tests passed.
- Frontend lint (targeted public approval files): passed.

## Files Touched For This Slice

- Backend:
  - `backend/core/views/estimating/estimates.py`
  - `backend/core/views/change_orders/change_orders.py`
  - `backend/core/views/accounts_receivable/invoices.py`
  - `backend/core/urls.py`
  - `backend/core/views/__init__.py`
  - `backend/core/models/change_orders/change_order.py`
  - `backend/core/serializers/change_orders.py`
  - `backend/core/migrations/0010_changeorder_public_token.py`
  - `backend/core/tests/test_estimates.py`
  - `backend/core/tests/test_change_orders.py`
  - `backend/core/tests/test_invoices.py`
- Frontend:
  - `frontend/src/features/estimates/components/estimate-approval-preview.tsx`
  - `frontend/src/features/change-orders/components/change-order-public-preview.tsx`
  - `frontend/src/features/change-orders/components/change-order-public-preview.module.css`
  - `frontend/src/app/change-order/[publicRef]/page.tsx`
  - `frontend/src/features/change-orders/components/change-orders-console.tsx`
  - `frontend/src/features/change-orders/types.ts`
  - `frontend/src/features/invoices/components/invoice-public-preview.tsx`
  - `frontend/src/features/invoices/components/invoice-public-preview.module.css`

## Known Gaps / Next Steps

1. Add optional token hardening (expiry/revocation/rate limiting) for public links.
2. Decide whether invoice public `approve => paid` is final policy or should create an intermediate "customer-approved" status.
3. Add analytics/notification hooks around public decisions (webhook/email/slack).
4. Run full manual QA pass on all public pages (desktop/mobile, light/dark, invalid token, already-decided states).
