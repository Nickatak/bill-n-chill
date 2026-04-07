# Bill-n-Chill — System Requirements Spec

## System Boundary

This system is a **multi-tenant construction finance platform**. It manages the document lifecycle (quotes, invoices, change orders, vendor bills) and cash movement (payments) for small construction businesses.

Two distinct user populations interact with it:

1. **Internal users** (authenticated) — contractors, office staff. Create and manage financial documents, record payments, run reports.
2. **External users** (public, token-based) — customers of the contractor. View shared documents, approve/reject/dispute via tokenized links.

### What's inside the boundary

- Authentication and authorization (token-based, RBAC)
- Multi-tenant data isolation (organization-scoped)
- Document CRUD with status-machine lifecycles
- Financial calculations (line item totals, balances, tax, markup)
- Immutable audit trail (snapshots + status events on every financial state change)
- File storage (logos, contract PDFs)
- Async task queue (email, push notifications)

### What's outside the boundary

- Email delivery (Mailgun)
- Receipt OCR (Google Gemini Vision)
- Accounting sync (QuickBooks Online)
- Push notification delivery (Web Push / FCM)
- Payment processing (no gateway — manual recording only)
- DNS, SSL termination (Caddy)

## External Dependencies

| Dependency | Direction | Coupling | In Request Path? | Failure Impact |
|---|---|---|---|---|
| **Mailgun** | Output | Async (django-q) | No | Emails delayed/lost; status transitions still succeed |
| **Google Gemini Vision** | Input | Sync | Yes (`/vendor-bills/scan/`) | Receipt scan returns 502; no data written, user retries |
| **QuickBooks Online** | Output | Async (django-q) | No (except OAuth flow) | Sync events fail; logged for manual retry |
| **Web Push (FCM)** | Output | Async (django-q) | No | Push notifications silently dropped; stale subscriptions cleaned |
| **PostgreSQL 16** | Internal | Sync | Yes (every request) | Total system outage |
| **Filesystem (media/)** | Internal | Sync | Yes (uploads/serves) | Logo/PDF upload fails; existing files still served by Caddy |

### Dependency observations

- Mailgun, Gemini, QBO, and Web Push are all **non-critical path** — their failure never corrupts state or blocks financial operations. This is by design (emails queued outside `transaction.atomic()`).
- PostgreSQL is the **only hard dependency**. Every authenticated request hits it. No caching layer. No replicas.
- The filesystem is a soft dependency — reads are served by Caddy (static), writes go through Django.

## Entities

### Tenant

| Entity | Description | Mutability |
|---|---|---|
| **Organization** | Tenant root. All data scoped here. | Mutable (profile, settings) |
| **OrganizationMembership** | User ↔ Org binding. RBAC role + capabilities. OneToOne per user. | Mutable (role changes) |
| **User** | Django auth user. Exists outside org scope until membership created. | Mutable |

### Operational

| Entity | Description | Mutability | Avg Row Size |
|---|---|---|---|
| **Project** | Work site. Primary organizational unit below org. | Mutable | ~400B |
| **Customer** | Contractor's client. Owns projects. | Mutable | ~350B |
| **Vendor** | Supplier/subcontractor. Linked to vendor bills. | Mutable | ~250B |
| **CostCode** | Org-level chart of accounts line. Non-deletable. | Mutable (name only) | ~150B |

### Financial Documents

| Entity | Description | Lifecycle | Avg Row Size |
|---|---|---|---|
| **Quote** | Proposal with line items, markup, contingency, billing periods. Versioned. | draft → sent → approved/rejected/void | ~1.1KB header + ~200B/line |
| **ChangeOrder** | Amendment to approved quote. Adjusts contract value. | draft → sent → approved/rejected/void | ~950B header + ~150B/line |
| **Invoice** | Bill to customer. Line items, tax, balance tracking. | draft → sent → outstanding → closed/void | ~800B header + ~180B/line |
| **VendorBill** | Bill from vendor. Line items, tax, shipping, balance tracking. | open → disputed/closed/void | ~850B header + ~200B/line |
| **Payment** | Cash movement record. Directional (inbound/outbound). Links to one document. | pending → settled/void | ~600B |

### Audit Trail (Immutable)

| Entity | Description | Avg Row Size |
|---|---|---|
| **QuoteStatusEvent** | Status transition log | ~300B |
| **ChangeOrderStatusEvent** | Status transition log | ~310B |
| **InvoiceStatusEvent** | Status transition log | ~300B |
| **VendorBillStatusEvent** | Status transition log | ~280B |
| **QuoteSnapshot** | Not yet implemented (QuoteStatusEvent carries this role) | — |
| **ChangeOrderSnapshot** | Full CO + lines serialized at decision point | ~1.3–2KB |
| **VendorBillSnapshot** | Full bill + lines serialized at status transition | ~1.5–3KB |
| **PaymentRecord** | Payment lifecycle capture with snapshot JSON | ~800B–1.2KB |
| **OrganizationRecord** | Org profile snapshot on change | ~600B |
| **CustomerRecord** | Customer snapshot on change | ~400B |
| **EmailRecord** | Every email sent, with subject + body | ~500B–1KB |
| **SigningCeremonyRecord** | OTP verification flow log | ~200B |

### Relationship Depth

```
Organization (tenant root)
  └── Project
        ├── Quote → QuoteLineItem, BillingPeriod
        ├── ChangeOrder → ChangeOrderLine, ChangeOrderSection
        ├── Invoice → InvoiceLine
        ├── VendorBill → VendorBillLine
        └── Payment → (links to Invoice OR VendorBill)
```

Max depth: 4 levels (Org → Project → Document → Line Items/Snapshots).
All queries scoped by `organization_id` at the top. Child queries rely on project already being org-validated.

## Operations

### Authenticated (Internal Users)

| # | Operation | Method | Volume | Write Amplification | Notes |
|---|---|---|---|---|---|
| 1 | **List projects/customers/documents** | GET | High relative to other ops | 0 (read-only) | Paginated (25/page). Most common operation. |
| 2 | **View document detail** | GET | Medium | 0 | Single document + lines + status history. |
| 3 | **Create document** (quote/invoice/CO/bill) | POST | Low | 2 + N (header + N lines + status event) | Atomic. Typical N = 3–8 lines. |
| 4 | **Update document** | PATCH | Low | 1–3 (header + optional status event + snapshot) | Atomic. |
| 5 | **Transition document status** (send/void) | POST | Low | 2–3 (status event + snapshot + optional email task) | Email queued async. |
| 6 | **Record payment** | POST | Low | 3–4 (payment + record + target doc balance update + optional status event) | Atomic. |
| 7 | **Create customer/vendor/project** | POST | Low | 1–2 (entity + optional audit record) | |
| 8 | **Run report** (portfolio, financial summary, attention feed) | GET | Low–Medium | 0 | Aggregation queries across project's documents. |
| 9 | **Upload file** (logo, contract PDF, receipt scan) | POST | Rare | 1 (file write) or 0 (scan = no DB write) | Gemini call sync for scan. |
| 10 | **Search** (quick-jump) | GET | Medium | 0 | Cross-entity search. |
| 11 | **Organization management** (members, invites, settings) | Mixed | Rare | 1–3 | |

### Public (External Customers)

| # | Operation | Method | Volume | Write Amplification | Notes |
|---|---|---|---|---|---|
| 12 | **View shared document** | GET | Sporadic | 0 | Token-based. No auth. Single document read. |
| 13 | **Request OTP** | POST | Rare | 1–2 (ceremony record + email task) | |
| 14 | **Submit decision** (approve/reject/dispute) | POST | Rare | 2–4 (status event + snapshot + email task + push task) | Atomic. Triggers async notifications. |

### Background (Async Queue)

| # | Operation | Trigger | Volume | External Call |
|---|---|---|---|---|
| 15 | **Send email** (verification, OTP, document sent, decision notification) | Task queue | Follows write ops | Mailgun API |
| 16 | **Send push notification** | Task queue | Follows decisions | Web Push / FCM |
| 17 | **QBO sync** | Task queue | On document state changes (when enabled) | QBO API |

## Load Profile

### Current State (pre-traction, ~1–5 orgs)

| Metric | Per Day | Per Second | Notes |
|---|---|---|---|
| **Reads** | ~50–200 | <0.01 | List views, detail views, reports |
| **Writes** | ~10–50 | <0.001 | Document CRUD, payments, status transitions |
| **Public views** | ~1–10 | negligible | Customer opens shared link |
| **Emails sent** | ~1–10 | negligible | Document sent, decisions, auth |
| **File uploads** | ~0–5 | negligible | Logos, PDFs, receipt scans |
| **DB write rows** (with amplification) | ~30–200 | <0.005 | 3–4x user-perceived writes |

### Target State (100 orgs, ~500 users)

| Metric | Per Day | Per Second | Notes |
|---|---|---|---|
| **Reads** | ~5,000–20,000 | ~0.1–0.2 | |
| **Writes** | ~500–2,000 | ~0.01–0.02 | |
| **Public views** | ~100–500 | <0.01 | |
| **Emails sent** | ~50–200 | <0.005 | |
| **DB write rows** (with amplification) | ~2,000–8,000 | ~0.03–0.1 | |

### Aspirational (1,000 orgs, ~5,000 users)

| Metric | Per Day | Per Second | Notes |
|---|---|---|---|
| **Reads** | ~50,000–200,000 | ~1–2 | |
| **Writes** | ~5,000–20,000 | ~0.1–0.2 | |
| **Public views** | ~1,000–5,000 | ~0.05 | |
| **Emails sent** | ~500–2,000 | ~0.02 | |
| **DB write rows** (with amplification) | ~20,000–80,000 | ~0.3–1 | |

### Read:Write Ratio

~5:1 to 10:1. Construction finance is operationally write-heavy — users create, edit, and transition documents frequently relative to browsing. But list views and reports still dominate total request count.

### Traffic Pattern

Not uniform. Construction businesses operate ~6am–6pm local time, Mon–Fri. Expect near-zero traffic overnight and weekends. Peak is likely 8am–10am (morning planning) and 3pm–5pm (end-of-day invoicing/billing). Public document views are unpredictable — depends on when customers check email.

## Storage Estimate

### Per-Organization (typical small contractor)

| Category | Count | Size |
|---|---|---|
| Projects | ~20 | ~8KB |
| Customers | ~30 | ~10KB |
| Quotes (with lines) | ~40 | ~60KB |
| Change orders (with lines) | ~20 | ~25KB |
| Invoices (with lines) | ~100 | ~100KB |
| Vendor bills (with lines) | ~80 | ~85KB |
| Payments | ~150 | ~90KB |
| Audit trail (all events + snapshots) | ~800 | ~500KB |
| **Total per org** | | **~900KB** |

### System-Wide Projection

| Scale | Orgs | DB Size (data) | Media Files | Notes |
|---|---|---|---|---|
| Current | 5 | ~5MB | ~50MB | Logos + a few PDFs |
| Target (100 orgs) | 100 | ~90MB | ~2GB | |
| Aspirational (1,000 orgs) | 1,000 | ~900MB | ~20GB | |
| 10K orgs | 10,000 | ~9GB | ~200GB | Still fits on one machine for storage |

Storage is not a scaling concern at any realistic scale. A single PostgreSQL instance handles this trivially.

## Constraints

### Financial Correctness
- All money stored as `Decimal(12,2)`. No floats. No rounding surprises.
- Multi-row financial writes use `transaction.atomic()`. Partial writes are impossible.
- Audit trail models are append-only (immutable mixin guards `save()` and `delete()`).
- Balance fields recomputed from settled payments — not incremented (idempotent).

### Tenant Isolation
- Every query scoped by `organization_id`. No cross-tenant data leakage.
- Users bound to exactly one org via `OneToOne` membership.
- Public token routes validate token existence but don't expose org internals.

### Status Machine Integrity
- Transitions enforced in `model.clean()` — invalid transitions raise `ValidationError`.
- Status events are the audit log of every transition, including actor + timestamp + IP.
- Snapshots capture full document state at decision points for forensic reconstruction.

### External Service Isolation
- No external service call can corrupt internal state.
- Emails queued outside `transaction.atomic()` — DB rollback doesn't orphan email sends.
- Gemini scan is stateless (no DB write on scan, only returns suggestions).
- QBO sync failures logged to `AccountingSyncEvent` for manual retry.

## Current Infrastructure (Single-Server)

```
Internet
  │
  ▼
Caddy (reverse proxy, auto-SSL)
  ├── bill-n-chill.com ──► Next.js (port 3000)
  └── api.bill-n-chill.com ──► Django/Gunicorn (port 8000, 4 workers)
                                  │
                                  ├── PostgreSQL 16 (single instance)
                                  ├── Django-Q2 worker (2 workers, ORM broker)
                                  └── Filesystem (media/)
```

Everything on one VPS: 16GB RAM / 4 vCPU / 200GB NVMe.

### Single Points of Failure

| Component | SPOF? | Failure Impact | Current Mitigation |
|---|---|---|---|
| **VPS** | Yes | Total outage | None |
| **PostgreSQL** | Yes | Total outage (every request hits DB) | Daily pg_dump to B2; WAL archival planned |
| **Caddy** | Yes | Total outage (TLS + routing) | Auto-restart via systemd |
| **Django/Gunicorn** | Yes | API outage | Docker restart policy |
| **Django-Q2 worker** | Yes | Async tasks stall (email, push, sync) | Docker restart policy |
| **Next.js** | Yes | Frontend outage | Docker restart policy |
| **Filesystem** | Yes | Media loss (logos, PDFs) | None (no backup) |
| **Mailgun** | External | Emails stop | Async — doesn't block operations |
| **Gemini** | External | Receipt scan fails | Returns 502, user retries |
| **QBO** | External | Sync stalls | Logged for retry |

## Open Design Questions

These are the system-level questions this spec raises — the gap between what exists and what the load profile + constraints warrant:

1. **Database durability** — Single PostgreSQL, no replicas. What's the recovery plan if the disk dies? Is there automated backup? What's the acceptable data loss window?

2. **Database availability** — At current load, a single instance handles everything trivially. But a replica would eliminate the DB as SPOF and enable zero-downtime maintenance. Worth the operational cost?

3. **Health monitoring** — Nothing watches whether the system is up. No alerting. How do we know when something breaks before a user tells us?

4. **External service resilience** — Mailgun and Gemini are called without circuit breaking. A frozen Mailgun API could hang django-q workers (60s timeout per task, 2 workers = both blocked). Should the async task layer have circuit-breaking or timeout behavior?

5. **Backup strategy** — DB dumps? Media file backups? How often? Where stored? Tested restore?

6. **Cache layer** — Not needed for throughput at any realistic scale. But could improve UX for report/aggregation endpoints that scan many rows. Worth adding for latency, or premature?

7. **Worker resilience** — Django-Q2 uses PostgreSQL as broker. If the DB is down, the worker can't dequeue. Is this acceptable coupling, or should the queue be independent?

8. **Deployment resilience** — Single VPS. No blue-green. No rollback strategy beyond `git revert`. What happens during a bad deploy?

9. **Rate limiting** — Public token routes (document views, OTP requests, decisions) are unauthenticated. No rate limiting exists. Abuse vector?

10. **Media durability** — Logos and contract PDFs are on local filesystem with a Docker bind mount. No replication, no backup to object storage. Acceptable risk?
