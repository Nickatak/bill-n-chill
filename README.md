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

- `backend/core/models/shared_operations`: project/org/role/cost-code/vendor/accounting-sync/customer shared operational models
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

## Docker Compose Layout

- `docker-compose.yml` — base service definitions (shared across all environments)
- `docker-compose.local.yml` — local dev override (publishes ports to host)
- `docker-compose.prod.yml` — production override (gunicorn, `npm run build`, localhost-only ports for Caddy)
- Runtime config is environment-variable driven (no required service `env_file`)
- Local host ports are configurable with `FRONTEND_PORT`, `BACKEND_PORT`, and `MYSQL_PORT`

Service names: `frontend`, `backend`, `db`

## Production Deployment

**Live at:** [https://bill-n-chill.com](https://bill-n-chill.com)

- **Host:** Hostinger VPS (16GB / 4 vCPU / 200GB NVMe), Ubuntu
- **Reverse proxy:** Caddy (auto-SSL via Let's Encrypt)
- **Stack:** Same Docker Compose as local, with production override

### Domain Routing

| Domain | Service |
|---|---|
| `bill-n-chill.com` | Next.js frontend (port 3000) |
| `api.bill-n-chill.com` | Django/Gunicorn backend (port 8000) |
| `mg.bill-n-chill.com` | Mailgun sender domain |

### Deployment Files

- `docker-compose.yml` — base service definitions (shared with local dev)
- `docker-compose.prod.yml` — production overrides (gunicorn, `npm run build`, localhost-only ports)
- `/etc/caddy/Caddyfile` — reverse proxy config (on VPS, not in repo)
- `.env` on VPS — production secrets (not committed)

### Deploy Process

```bash
ssh bnc
cd ~/bill-n-chill
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate
```

### SSH Access

Configured via `~/.ssh/config` (WSL):

```
Host bnc
    HostName REDACTED_IP
    User deploy
    IdentityFile ~/.ssh/bill_n_chill_vps
```

## Documentation

- `docs/setup.md`: local setup instructions.
- `docs/architecture.md`: detailed system boundaries and conventions.
- `docs/api.md`: endpoint reference and API standards.
- `docs/contributing.md`: workflow, branching, testing, and code style.
- `docs/domain-model.md`: core entities, lifecycles, and API direction for construction billing workflows.
- `docs/feature-list.md`: compact implementation ledger for shipped feature slices.
- `docs/meta/mvp-v1.md`: initial MVP scope, acceptance criteria, and phased delivery.
- `docs/phase-2-operational-hardening-and-product-development.md`: next-phase plan for operational hardening and product development.
- `docs/quick-add-ux-v2.md`: Quick Add Customer v2 UX goals and acceptance checks.

## Notes

This file is intentionally lightweight and practical; detailed behavior/contracts live in `docs/`.
