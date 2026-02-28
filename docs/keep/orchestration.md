# Orchestration Notes

Last reviewed: 2026-02-28

This repository is designed to be consumed as a base compose app by a host-level orchestration repo (for example `ntakemori-deployment`).

## Base Compose Contract

- Base file: `docker-compose.yml`
- Local-only ports overlay: `docker-compose.local.yml`
- Stable service names: `frontend`, `backend`, `db`
- Local host ports are env-configurable via `docker-compose.local.yml`:
  - `FRONTEND_PORT` (default `3000`)
  - `BACKEND_PORT` (default `8000`)
  - `MYSQL_PORT` (default `3306`)

## Expected Override Pattern

The orchestration repo should layer an override file and env file:

```bash
docker compose -f <app-repo>/docker-compose.yml -f <ops-repo>/apps/<app>/overrides/<env>.yml --env-file <ops-repo>/apps/<app>/env/<env>.env up -d
```

Typical override responsibilities:

- Attach edge-facing services to an external ingress network.
- Inject environment-specific values (domains, CORS origins, debug flags, API URL roots).

## Environment Variables You Will Usually Set In Orchestration

- Backend: `DJANGO_SECRET_KEY`, `DJANGO_DEBUG`, `DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `DATABASE_URL`
- Frontend: `NEXT_PUBLIC_API_BASE_URL`
- MySQL (if using bundled DB service): `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`
