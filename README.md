# bill-n-chill

`bill-n-chill` is a full-stack construction finance workflow app using:

- Backend: Django + Django REST Framework (DRF)
- Frontend: Next.js

## Current Stack

- Backend: Django + Django REST Framework
- Frontend: Next.js
- Database: MySQL (local via Docker Compose)

## Architecture (High-Level)

- `backend` handles business logic, authentication, persistence, and API endpoints.
- `frontend` handles UI rendering, routing, and API consumption.
- Frontend communicates with backend over JSON HTTP APIs.

```text
Next.js App  <----HTTP/JSON---->  Django/DRF API  <---->  Database
```

## Backend Domain Layout

- `backend/core/models/shared_operations`: project/org/role/cost-code/vendor/accounting-sync/contact shared operational models
- `backend/core/models/estimating`: estimate authoring + estimate lines
- `backend/core/models/change_orders`: change-order workflow models
- `backend/core/models/accounts_receivable`: invoice + invoice lines
- `backend/core/models/accounts_payable`: vendor bill + allocations
- `backend/core/models/cash_management`: cross-domain cash movement models (`Payment`, `PaymentAllocation`)
- `backend/core/models/financial_auditing`: immutable snapshots/events and canonical scope identity

## Backend View Layout

- `backend/core/views/shared_operations`: auth-adjacent/project-wide operational endpoints (`accounting`, `intake`, `projects`, `cost_codes`, `vendors`)
- `backend/core/views/estimating`: estimate + budget endpoints
- `backend/core/views/change_orders`: change-order endpoints
- `backend/core/views/accounts_receivable`: invoice endpoints
- `backend/core/views/accounts_payable`: vendor-bill endpoints
- `backend/core/views/cash_management`: payment/allocation endpoints
- `backend/core/views/helpers.py`: shared orchestration helpers (RBAC, guardrails, capture helpers)
- `backend/core/views/__init__.py`: canonical export surface used by `backend/core/urls.py`

## Architecture Decisions

- Enforcement hierarchy: DB constraints first, model-level guards second, views/serializers last.
- Mutable + immutable policy:
  - allow user-managed operational workflow entry/edit where needed
  - append immutable audit captures for financially relevant writes
  - system-managed state machines must append immutable capture rows for lifecycle transitions
- Cross-domain placement policy:
  - if a model is shared across AR/AP flows and does not fit one lane cleanly, keep it in a dedicated shared domain package (for example `cash_management`) instead of forcing it into one side.
- View write-path policy:
  - when an endpoint performs multiple financially relevant writes (operational row + immutable record/event), perform them inside one `transaction.atomic()` block to avoid partial persistence.
- Details and examples live in:
  - `docs/contributing.md`
  - `docs/domain-model.md`

## Local Setup

- Use `docs/setup.md` for full backend/frontend setup and run steps.
- Use `docs/api.md` and `docs/domain-model.md` as the current contract references.

## Orchestration Contract

This repo is orchestration-ready as a base Docker Compose app repo.

- Base stack is defined in `docker-compose.yml`.
- Local host port publishing is defined separately in `docker-compose.local.yml`.
- Runtime config is environment-variable driven (no required service `env_file`).
- Local host ports are configurable with `FRONTEND_PORT`, `BACKEND_PORT`, and `MYSQL_PORT`.
- External orchestration (for example `ntakemori-deploy`) should apply an override file to:
  - attach services to the shared ingress network (for example `edge`)
  - set environment-specific values via `--env-file`

Stable service names for overrides:

- `frontend`
- `backend`
- `db`

## Documentation Roadmap

- `docs/setup.md`: local setup instructions.
- `docs/architecture.md`: detailed system boundaries and conventions.
- `docs/api.md`: endpoint reference and API standards.
- `docs/contributing.md`: workflow, branching, testing, and code style.
- `docs/product-map.md`: Beam/Buildertrend/Procore capability comparison and replacement implications.
- `docs/mvp-v1.md`: initial MVP scope, acceptance criteria, and phased delivery.
- `docs/domain-model.md`: core entities, lifecycles, and API direction for construction billing workflows.
- `docs/gc-pm-use-case.md`: step-by-step GC/PM scenario with required features, device posture, and edge conditions.
- `docs/feature-list.md`: complete ordered feature backlog with dependencies and acceptance checks.
- `docs/phase-2-operational-hardening-and-product-development.md`: next-phase plan for operational hardening and UX/use-case product development.
- `docs/dashboard-home-auth-gate.md`: auth-gated dashboard-home UX sketch and interaction rules.
- `docs/quick-add-ux-v2.md`: Quick Add Contact v2 UX goals, interaction rules, and acceptance checks.

## Notes

This file is intentionally lightweight and practical; detailed behavior/contracts live in `docs/`.

Current implementation state and active review queue are tracked in:
- `HANDOFF.md`
- `work/for_me.md`
