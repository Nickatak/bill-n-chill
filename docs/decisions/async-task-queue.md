# Async Task Queue — Django-Q2

Date: 2026-03-24

## Context

When a customer acts on a document via a public link (approve, reject, dispute), the org user should receive an email notification if they've opted in. Currently, push notifications are sent synchronously during the approval flow — this works because the Web Push API call is fast.

Email notification (Mailgun HTTP API) adds 200-500ms of latency to the customer's response. This is unnecessary friction: the customer doesn't know an email is being sent and shouldn't have to wait for it. The notification is a courtesy to the org user, not a transactional email the customer expects.

More broadly, fire-and-forget async work is a pattern we'll need repeatedly — email notifications today, but scheduled reminders, digest reports, and batch processing are foreseeable needs.

## Options considered

### 1. `threading.Thread` (fire-and-forget)

Zero dependencies, zero infra. Spawn a daemon thread after the view commits.

**Rejected.** No retry, no visibility into failures, no persistence. The moment we need any of those (and we will), we'd rebuild toward a task queue anyway. Starting with threads means paying for the migration later.

### 2. Django-Q2 with ORM broker

Task queue backed by the existing PostgreSQL database. One new pip dependency (`django-q2`), one new process (`qcluster` worker in Docker Compose). Provides retry, admin visibility, scheduled tasks, and result storage out of the box.

**Chosen.** Right-sized for the product's scale and infrastructure. Same philosophy as Docker Compose + Caddy over Kubernetes — use the simplest tool that solves the actual problem.

### 3. Celery + Redis

Industry-standard task queue. Adds Redis container, Celery worker process, and beat scheduler for periodic tasks.

**Rejected for now.** Redis is a new infrastructure dependency with its own memory management, persistence config, and failure modes. Celery's configuration surface is large. The additional capability (pub/sub broker, thousands of tasks/minute throughput) isn't needed — we're sending notification emails, not processing streaming data. If task volume ever demands it, migrating from Q2 to Celery is straightforward since the task function signatures are the same.

### 4. DB queue + management command (DIY)

Write pending notifications to a table, process with a cron'd management command. No dependencies.

**Rejected.** Reimplements what Django-Q2 provides, without retry logic, admin integration, or scheduling. More custom code to maintain for no benefit.

## Decision

Use **Django-Q2 with the ORM broker** (PostgreSQL) for all async work.

### What changes

- **Dependency:** `django-q2` added to requirements
- **Process:** `qcluster` worker added to Docker Compose (same backend image, different command)
- **Config:** `Q_CLUSTER` dict in Django settings — workers, timeout, retry interval
- **Pattern:** Views call `async_task('dotted.path.to.function', *args)` instead of executing inline

### Trade-offs accepted

- **ORM broker polls the database** — adds minor DB load vs. Redis pub/sub. Irrelevant at our task volume (handful of notifications per day).
- **Smaller ecosystem than Celery** — fewer plugins, less community knowledge. We don't need the plugin ecosystem; we need `async_task()` and retry.
- **Extra process** — one more container to monitor. Acceptable given we already run backend + frontend + PostgreSQL + Caddy.

### Upgrade path

If task volume or complexity outgrows Q2, swap the ORM broker for Redis (`'redis': {'host': '...'}` in `Q_CLUSTER`) or migrate to Celery. Task functions don't change — only the dispatch mechanism does.

## First use case

Async email notification on document approval/rejection/dispute. The public approval view commits the status change, fires the push notification (existing, fast), and queues an `async_task` for the email. Customer response returns immediately; email sends in the background with automatic retry on failure.
