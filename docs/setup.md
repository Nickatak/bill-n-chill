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

Expected URLs:

- Backend API: `http://localhost:8000/api/v1/health/`
- Frontend app: `http://localhost:3000`
- Intake quick-add page: `http://localhost:3000/intake/quick-add`
- Projects page: `http://localhost:3000/projects`
- Cost codes page: `http://localhost:3000/cost-codes`
- Estimates page: `http://localhost:3000/estimates`

## Makefile Shortcuts

Run `make help` from repo root to see all commands.

Common commands:

- `make install`
- `make env-local`
- `make dev`
- `make migrate`
- `make test`
