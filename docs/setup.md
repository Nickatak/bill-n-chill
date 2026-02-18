# Setup

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

### 1) Start MySQL only (recommended for local host workflows)

```bash
make dev-db-up
```

This starts only the Dockerized MySQL container while you continue to run backend/frontend directly on your host.

### 2) Run backend + frontend locally

Backend:

```bash
cd backend
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver
```

Frontend:

```bash
cd frontend
npm run dev
```

### 3) Optional full Docker stack

```bash
make dev-up
```

Expected URLs:

- Backend API: `http://localhost:8000/api/v1/health/`
- Frontend app: `http://localhost:3000`
- Intake quick-add page: `http://localhost:3000/intake/quick-add`
- Projects page: `http://localhost:3000/projects`
- Cost codes page: `http://localhost:3000/cost-codes`
- Estimates page: `http://localhost:3000/estimates`

## One-Command Demo Seed (Bob Bathroom Remodel)

To load a full MVP walkthrough dataset (lead, project, estimate, budget, change order, invoice, vendor bill, payments, allocations, audit events):

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
```

Options:

```bash
backend/.venv/bin/python backend/manage.py reset_fresh_demo --skip-seed
backend/.venv/bin/python backend/manage.py reset_fresh_demo --email test@ex.com --password Qweqwe123 --project-name "Bathroom Remodel (Demo)"
```

## Makefile Shortcuts

Run `make help` from repo root to see all commands.

### Command Prefix Pattern

The Makefile now uses three command prefixes:

- `local-*`: direct local host workflows (frontend/backend run on host).
- `dev-*`: Dockerized development stack using `.env.local`.
- `prod-*`: Dockerized prod-like stack using `.env.prod`.

Examples:

- `make local-up`
- `make dev-up`
- `make docker-up` (alias of `make dev-up`)
- `make prod-up`
- `make dev-db-up` (MySQL only)
- `make db-up` (alias of `make dev-db-up`)
