# MySQL vs PostgreSQL — What Matters for BnC

This isn't a generic comparison. It's scoped to the decisions we're actually making: durability (log shipping / backup), replication (if we get there), and what a migration would cost.

## The Write-Ahead Log: The Core Difference That Matters Here

Both databases use a write-ahead log — every change is written to a sequential log before it's applied to the actual data files. This is how crash recovery works: replay the log to reconstruct anything that didn't make it to disk.

But the two implementations differ in ways that directly affect our binlog-shipping plan.

### MySQL: Binary Log (binlog)

- **Two separate log systems.** InnoDB (the storage engine) has its own redo log for crash recovery. The binlog is a separate, higher-level log maintained by the MySQL server layer. They must be coordinated via 2-phase commit internally.
- **Binlog format options:** Statement-based (logs the SQL), row-based (logs the actual row changes), or mixed. Row-based is the safe default — statement-based can produce different results on replay if the execution context differs.
- **Retention is opt-in.** Binlogs are pruned by default (`binlog_expire_logs_seconds`, default 30 days in MySQL 8.4). You have to configure retention and manage shipping yourself.
- **Shipping tooling:** `mysqlbinlog` can read from a remote server (`--read-from-remote-server`), but continuous archival is typically scripted or done via third-party tools. No built-in "archive to this location" hook.
- **Point-in-time recovery:** Restore a full dump + replay binlogs with `mysqlbinlog | mysql`. Works, but you're stitching together two separate tools manually.

### PostgreSQL: Write-Ahead Log (WAL)

- **Single unified log.** WAL is the only write-ahead log. There's no separate engine-level vs server-level log split. What's in the WAL is what happened. Period.
- **Always physical (row-level).** No format choice — WAL records are always the physical changes. No ambiguity on replay.
- **Archival is a first-class feature.** `archive_command` in postgresql.conf — you give it a shell command, and Postgres calls it every time a WAL segment is complete. "Copy this file to B2" is literally a one-liner config.
- **Continuous archival tooling:** `pg_receivewal` streams WAL in real-time (not waiting for segment completion). pgBackRest and Barman are mature, purpose-built tools for WAL archival + backup management.
- **Point-in-time recovery:** Built-in. `restore_command` in recovery config — Postgres fetches archived WAL segments and replays them automatically. You specify a target timestamp and it stops there.

### What this means for our binlog-shipping plan

With **MySQL**, we'd be:
- Scripting binlog shipping ourselves (cron + `mysqlbinlog --read-from-remote-server` or `cp` + `b2 upload`)
- Managing the coordination between the full dump and the binlog position (noting the exact binlog file + position at dump time)
- Stitching recovery together manually: restore dump → identify binlog position → replay with `mysqlbinlog`

With **PostgreSQL**, we'd be:
- Setting `archive_command = 'b2 upload-file ...'` (or a small wrapper script)
- Using `pg_basebackup` for full backups (knows its own WAL position automatically)
- Recovery = point Postgres at the archive location + set a target timestamp. Postgres does the rest.

The gap isn't "possible vs impossible." Both work. The gap is **how much you have to build vs how much is built-in.**

## Replication

You already know how Postgres replication works — you built it. Primary + 2 replicas, quorum sync, tested failover.

MySQL replication is conceptually similar but mechanically different:

| Aspect | PostgreSQL | MySQL |
|---|---|---|
| **Replication unit** | WAL stream (same log used for crash recovery) | Binlog stream (separate from InnoDB redo log) |
| **Sync modes** | Synchronous, async, quorum — per-replica configurable | Semi-synchronous (plugin), async. No built-in quorum. |
| **Promotion** | `pg_promote()` or `pg_ctl promote` | `STOP SLAVE; RESET SLAVE ALL;` + reconfigure other replicas |
| **Tooling** | pg_basebackup, pg_receivewal, repmgr, Patroni | MySQL Shell, MySQL InnoDB Cluster, Group Replication |
| **Read replicas** | Streaming replicas handle reads natively | Replicas handle reads, but beware of replication lag with statement-based |

The point: if/when you need a live replica, you already know Postgres replication. MySQL replication is learnable but it's new ground with different operational characteristics.

## Other Differences Worth Knowing

### Constraints and Data Integrity

PostgreSQL is stricter and more expressive at the constraint level:

- **Partial unique indexes:** `CREATE UNIQUE INDEX ... WHERE status != 'void'` — you already need this (the vendor bill conditional unique constraint). MySQL fakes this with generated columns.
- **Exclusion constraints:** "No two rows can overlap on this range" — not available in MySQL.
- **Check constraints:** Both support them now (MySQL added real enforcement in 8.0.16), but Postgres has had them for decades.
- **Transactional DDL:** Postgres can roll back `ALTER TABLE` inside a transaction. MySQL cannot — schema changes are auto-committed.

### JSON

Both support JSON columns. Postgres has two types (`json` and `jsonb` — binary, indexable). MySQL has one (`JSON`, binary-stored, indexable). Comparable for your usage (snapshot JSON fields).

### Django Support

Django treats both as first-class backends. The ORM abstracts most differences. Migration framework works with both. Switching the `DATABASES` backend setting is the easy part.

## What a Migration Would Cost

### Schema

- Django's migration framework can generate a fresh `0001_initial.py` targeting Postgres. You've already re-compacted migrations once (the Estimate→Quote rename). Same process.
- BnC-specific concerns:
  - `DecimalField(12,2)` → works identically in both (`DECIMAL` in MySQL, `NUMERIC` in Postgres)
  - `JSONField` → works in both (Django uses `jsonb` on Postgres automatically)
  - `ImageField`/`FileField` → filesystem-backed, DB just stores the path. No change.
  - The conditional unique constraint on VendorBill (`Lower(bill_number)` + condition) would actually become cleaner — Postgres supports this natively instead of the generated column workaround.

### Data

- At current data volume (~5MB), a full export/import is trivial. Not a concern.
- Seed command is idempotent. Run fresh.

### Infrastructure

- Docker Compose: swap the `mysql:8.4` image for `postgres:16`. Config changes in env vars.
- Backup script: rewrite from `mysqldump` to `pg_dump` / `pg_basebackup`. Simpler with Postgres tooling.
- Django settings: change `DATABASES.ENGINE` from `django.db.backends.mysql` to `django.db.backends.postgresql`.
- Python dependency: swap `mysqlclient` for `psycopg2` (or `psycopg[binary]`).
- Django-Q2: ORM broker — no change, it uses whatever DB Django uses.

### Risk

- Low data volume = low migration risk
- No stored procedures, no MySQL-specific SQL in the codebase (Django ORM throughout)
- The conditional unique constraint on VendorBill uses Django's `UniqueConstraint(condition=...)` which maps to a partial index on Postgres — actually more natural than the MySQL implementation

## Summary

The question isn't "which database is better." It's: **given that we're about to invest in durability infrastructure (log shipping, eventually maybe replication), which platform has better tooling for what we're building?**

Postgres has:
- Unified WAL (simpler mental model, one log to reason about)
- Built-in archive hooks (archive_command — exactly what we need for B2 shipping)
- Built-in point-in-time recovery (restore_command + target timestamp)
- Replication you already understand from hands-on experience
- Stricter constraint model (aligns with BnC's data integrity philosophy)

MySQL has:
- It's what's running today (switching has a cost, even if small)
- Familiar to the existing backup script

The migration cost is low (small dataset, Django ORM, no MySQL-specific SQL). The durability tooling gap is significant. The replication familiarity gap is real.
