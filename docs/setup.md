# Setup

Last reviewed: 2026-03-07

## Prerequisites

- Python 3.12+
- Node.js 20+
- npm or pnpm
- Git
- Docker + Docker Compose (for DB and full stack)
- make

## System Dependencies (Ubuntu/Debian)

The following apt packages must be installed on the host before running `make local-install`:

```bash
sudo apt-get install -y make python3.12-venv
```

Node.js 20+ is not in the default Ubuntu apt repos. Install via NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Docker and Docker Compose are also required for the DB container. Install via the official Docker docs for your distro.

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
- Accounting: `http://localhost:3000/accounting`
- Invoices: `http://localhost:3000/invoices`
- Bills: `http://localhost:3000/bills`
- Change Orders: `http://localhost:3000/change-orders`
- Organization: `http://localhost:3000/ops/organization`

For the full API route map see `docs/api.md`. For the full frontend route map see `frontend/ARCHITECTURE_MAP.md`.

## Demo Seed (Adoption Stages)

Seeds four accounts representing different adoption stages of the platform:

| Account | Stage | Data |
|---|---|---|
| `new@test.com` | Fresh signup | Empty workspace (org + cost codes only) |
| `early@test.com` | ~2 months | 4 customers, 2 projects, 2 quotes |
| `mid@test.com` | ~8 months | 12 customers, 6 projects, full status coverage |
| `late@test.com` | ~2 years | 35 customers, 18 projects, full financial lifecycle |

```bash
backend/.venv/bin/python backend/manage.py seed_adoption_stages
# or
make db-seed
```

All accounts use password `a`. The command is idempotent and prints login credentials + tokens.

## Hard Reset to Fresh State (Testing)

To fully reset local data (delete everything) and reseed demo accounts:

```bash
backend/.venv/bin/python backend/manage.py reset_fresh_demo
# or (with dev env selection)
make db-reset
```

`reset_fresh_demo` also updates a runtime marker timestamp used by `/api/v1/health/` and login/register warning panels so testers can see when demo data was last reset.

Options:

```bash
backend/.venv/bin/python backend/manage.py reset_fresh_demo --skip-seed
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
