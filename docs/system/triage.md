# System Requirements Triage

Sorting the 10 open design questions from the spec into what's justified now vs what's a scaling play we can't justify yet.

The filter: **does this protect against data loss or silent failure at current scale, or does it only matter under load we don't have?**

## Worth doing now

These are correctness, durability, and observability concerns — they matter with 1 user or 10,000.

### 1. Data durability — WAL archival to B2

**What exists:** Daily `pg_dump` to Backblaze B2 via `scripts/backup-db.sh` (cron, 3 AM). 30-day local retention. Restore script tested and working.

**Gap:** 24-hour RPO. A disk failure at 2:59 AM loses a full day of financial state changes — approvals, payment records, status transitions. For a financial tool, the immutable audit trail only works if it's actually durable.

**Decision: Switch from MySQL to PostgreSQL, then add WAL archival to B2.**

PostgreSQL's WAL is a unified write-ahead log with built-in archive hooks (`archive_command`). This gives us continuous log shipping to B2 with minutes of RPO instead of hours — without running a second database instance. See [mysql-vs-postgres.md](mysql-vs-postgres.md) for the full comparison.

- [x] Switch MySQL → PostgreSQL (done)
- [x] Configure `archive_command` to ship completed WAL segments to B2 (done — `db/archive-wal.sh`, enabled in prod compose overlay)
- [x] Set B2 credentials in prod .env and verify WAL upload (done — 4 segments archived)
- [x] Update `backup-db.sh` to use `pg_basebackup` (WAL-position-aware)
- [x] Update `restore-db.sh` to use PITR (base backup + WAL replay)
- [x] Add media directory (logos, contract PDFs) to B2 backup (included in nightly `backup-db.sh`)
- [ ] Test full recovery: base backup + WAL replay to a target timestamp

### 2. Health monitoring + alerting

**What exists:** Sentry captures unhandled exceptions in Django views and django-q2 task failures (explicit `_report_to_sentry` decorator). Health endpoint at `/api/v1/health/` checks DB connectivity.

**Gap:** Sentry only fires when code runs and fails. If the VPS is down, Postgres is unreachable, Caddy stops routing, or the django-q2 worker dies entirely — Sentry sees nothing. Need an external observer.

**Plan:**
- [ ] External uptime monitor (UptimeRobot / Betteruptime / similar) pinging `/api/v1/health/` every 60s — catches VPS, Caddy, Django, and Postgres failures
- [ ] Worker liveness check — heartbeat task on a schedule + staleness check, so a dead worker doesn't go unnoticed

### 3. Circuit breaking on external services

**Why now:** Django-Q2 has 2 workers with a 60s timeout. A frozen Mailgun API (not down — frozen, the worst kind) blocks both workers for 60s each. During that window, all async tasks stall: emails, push notifications, QBO sync. This is the same "frozen is worse than dead" pattern from the circuit breaker work.

- Mailgun calls need a timeout + circuit breaker (or at minimum, aggressive request-level timeouts)
- Gemini is sync in the request path — a frozen Gemini hangs the user's request. Needs a short timeout + clear error.
- QBO calls (when enabled) — same treatment

### 4. Rate limiting on public routes

**Why now:** Public document routes, OTP request, and decision endpoints are completely unauthenticated with no rate limiting. OTP endpoint triggers an email on every request — that's a direct path to Mailgun bill inflation or abuse. This isn't a scale concern, it's a security baseline.

- OTP endpoint: already has 60s rate limit per token (good)
- Document view endpoints: no rate limiting
- Decision endpoints: no rate limiting
- Auth endpoints (login, register, forgot-password): no rate limiting (brute force vector)

## Defer — scaling plays without load to justify them

### 5. Database replica

**Why defer:** Replication solves two things — read scaling and failover. We don't need read scaling (sub-1 RPS). Failover is nice, but the operational cost of running and maintaining a Postgres replica (replication lag monitoring, promotion runbook, connection failover logic) isn't justified when WAL archival + restore gets us running again in under an hour. The WAL shipping strategy above is the cheaper version of the same durability protection.

**Revisit when:** We have paying customers who can't tolerate any downtime, or read load actually matters.

### 6. Load balancing / multiple app servers

**Why defer:** 4 Gunicorn workers on a single VPS handles orders of magnitude more than our current or target load. Adding a second app server + load balancer adds infrastructure complexity for zero benefit right now.

**Revisit when:** We're CPU-bound on the VPS, or we need zero-downtime deploys badly enough to justify the infra.

### 7. Cache layer (Redis)

**Why defer:** No endpoint is slow enough to notice. Report queries scan across a project's documents — at typical project sizes (5–20 documents), these are trivial for Postgres. Caching would add a dependency and invalidation complexity for no measurable gain.

**Revisit when:** Report endpoints are measurably slow, or we have a read pattern that hits the same data repeatedly at volume.

### 8. Independent message queue (replacing Django-Q2/ORM broker)

**Why defer:** Django-Q2 using Postgres as its broker means the queue is coupled to the DB. If the DB dies, async tasks can't dequeue. But if the DB dies, the entire app is down anyway — there's nothing to queue *for*. Decoupling the queue from the DB only matters when you have independent services that could keep working without the DB.

**Revisit when:** We have background jobs that don't need the DB, or the queue volume creates noticeable DB load.

## Gray area

### 9. Deployment resilience (blue-green, rollback)

Not a scaling play, but not a day-one emergency either. Current deploy is `git pull && docker compose up --force-recreate`. A bad deploy means brief downtime while you revert. With low traffic and a single operator (you), this is manageable.

**Worth thinking about when:** Deploy frequency increases, or more than one person is deploying.

### 10. Media durability (S3 / object storage)

The backup strategy covers this partially — if media files are backed up off-VPS, you can restore them. Full object storage (S3) adds durability guarantees, CDN potential, and removes filesystem as a concern. But it also means changing upload/serve paths, updating Docker volumes, and introducing an AWS dependency.

**Worth doing when:** Media volume grows beyond "a few hundred files" or you want CDN delivery for public document assets.
