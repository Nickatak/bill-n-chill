# Setup

Last reviewed: 2026-02-28

## Prerequisites

- Python 3.12+
- Node.js 20+
- npm or pnpm
- Git

## Services

- `backend/` (Django + DRF)
- `frontend/` (Next.js App Router)

## Environment Variables

Backend:

- `DJANGO_SECRET_KEY`
- `DJANGO_DEBUG`
- `DATABASE_URL`
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_ROOT_PASSWORD`
- `MYSQL_PORT`
- `CORS_ALLOWED_ORIGINS`
- `APP_REVISION` (optional; commit/release id shown in `/health/` and login/register warning panel)
- `DATA_RESET_AT` (optional override for last-reset display in `/health/`)
- `DATA_RESET_MARKER_PATH` (optional path for persisted last-reset marker file)

Frontend:

- `NEXT_PUBLIC_API_BASE_URL`

## Environment File Management

Files at repo root:

- `.env.example`: tracked template
- `.env.local`: local development values (git-ignored)
- `.env.prod`: production-like template values (git-ignored)
- `.env`: active environment file used by local tooling

Toggle active environment:

```bash
scripts/toggle-env.sh local
scripts/toggle-env.sh prod
```

Or using Makefile alias:

```bash
make env-init
```

Notes:

- If `.env` already exists, toggle script creates a timestamped backup unless `--force` is passed.
- Keep secrets out of git; use secure secret management for real production deployments.

## Initial Scaffold Commands

Already completed in this repository. If recreating from scratch:

Backend:

```bash
mkdir -p backend
cd backend
python -m venv .venv
source .venv/bin/activate
pip install django djangorestframework django-cors-headers
```

Frontend:

```bash
npx create-next-app@latest frontend
```

## Run Plan

### 1) Start Docker stack (recommended baseline)

```bash
make docker-up
```

This starts frontend + backend + MySQL in detached mode.

### 2) Replace services locally (optional)

If you want to run a service on host for focused logs/debugging, start it directly:

Backend on host (auto-stops docker backend first):

```bash
make local-run-backend
```

Frontend on host (auto-stops docker frontend first):

```bash
make local-run-frontend
```

### 3) Docker-only workflow

```bash
make docker-up
```

Expected URLs (key surfaces):

- Backend health: `http://localhost:8000/api/v1/health/`
- Frontend app: `http://localhost:3000`
- Customers: `http://localhost:3000/customers`
- Projects: `http://localhost:3000/projects`
- Estimates: `http://localhost:3000/estimates`
- Change Orders: `http://localhost:3000/change-orders`
- Invoices: `http://localhost:3000/invoices`
- Vendor Bills: `http://localhost:3000/vendor-bills`
- Payments: `http://localhost:3000/payments`
- Organization: `http://localhost:3000/ops/organization`

For the full API route map see `docs/api.md`. For the full frontend route map see `frontend/ARCHITECTURE_MAP.md`.

## One-Command Demo Seed (Bob Bathroom Remodel)

To load a full MVP walkthrough dataset (lead, project, estimate family revisions, budget, approved + voided change orders, mixed invoice/vendor-bill/payment statuses, allocations, and audit events):

```bash
backend/.venv/bin/python backend/manage.py seed_bob_demo
```

Optional overrides:

```bash
backend/.venv/bin/python backend/manage.py seed_bob_demo --email test@ex.com --password Qweqwe123 --project-name "Bathroom Remodel (Demo)"
```

The command is idempotent and prints demo login credentials + token for manual UI simulation.

## Hard Reset to Fresh State (Testing)

To fully reset local data (delete everything) and reseed the Bob demo:

```bash
backend/.venv/bin/python backend/manage.py reset_fresh_demo
# or (with dev env selection)
make db-reset
```

`reset_fresh_demo` also updates a runtime marker timestamp used by `/api/v1/health/` and login/register warning panels so testers can see when demo data was last reset.

Options:

```bash
backend/.venv/bin/python backend/manage.py reset_fresh_demo --skip-seed
backend/.venv/bin/python backend/manage.py reset_fresh_demo --email test@ex.com --password Qweqwe123 --project-name "Bathroom Remodel (Demo)"
```

## Makefile Shortcuts

Run `make help` from repo root to see all commands.

### Command Prefix Pattern

The Makefile now uses five primary command prefixes:

- `local-*`: direct local host workflows (frontend/backend run on host).
- `docker-*`: Dockerized development stack using `.env.local`.
- `db-*`: DB/data maintenance helpers for `.env.local`.
- `docker-prod-*`: Dockerized prod-like stack using `.env.prod`.
- `db-prod-*`: DB/data maintenance helpers for `.env.prod`.

Examples:

- `make docker-up`
- `make db-reset`
- `make db-reset-hard`
- `make docker-prod-up`
- `make db-prod-reset`
