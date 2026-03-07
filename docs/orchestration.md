# Orchestration Notes

Last reviewed: 2026-03-07

bill-n-chill runs on a dedicated Hostinger VPS with Caddy as the reverse proxy.

## Compose Layout

- `docker-compose.yml` — base service definitions (shared across all environments)
- `docker-compose.local.yml` — local dev override (publishes ports to host)
- `docker-compose.prod.yml` — production override (gunicorn, `npm run build`, localhost-only ports for Caddy)

Stable service names: `frontend`, `backend`, `db`

Local host ports are env-configurable:
- `FRONTEND_PORT` (default `3000`)
- `BACKEND_PORT` (default `8000`)
- `MYSQL_PORT` (default `3306`)

## Production Deploy

```bash
ssh bnc
cd ~/bill-n-chill
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate
```

## Reverse Proxy

Caddy runs on the host (not in Docker) and reverse-proxies to localhost-bound container ports. Config lives at `/etc/caddy/Caddyfile` on the VPS.

| Domain | Target |
|---|---|
| `bill-n-chill.com` | `127.0.0.1:3000` (Next.js) |
| `api.bill-n-chill.com` | `127.0.0.1:8000` (Django/Gunicorn) |

SSL is automatic via Let's Encrypt — Caddy handles provisioning and renewal.

## Environment Variables

Production `.env` lives on the VPS at `~/bill-n-chill/.env` (not committed).

- Backend: `DJANGO_SECRET_KEY`, `DJANGO_DEBUG`, `DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `DATABASE_URL`
- Frontend: `NEXT_PUBLIC_API_BASE_URL`
- MySQL: `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`
- Email: `EMAIL_BACKEND`, `MAILGUN_API_KEY`, `MAILGUN_SENDER_DOMAIN`, `DEFAULT_FROM_EMAIL`
