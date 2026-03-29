# QuickBooks Online Sync — Implementation Plan

**Status:** Active development
**Direction:** Push-only (BnC → QBO). BnC is system of record. QBO is downstream mirror.
**Gate:** Dev-only (`NEXT_PUBLIC_DEBUG=true` on frontend, `QBO_ENABLED=true` on backend) until post-incorporation and user feedback.

---

## Prerequisites (Done)

- [x] Intuit developer account registered
- [x] OAuth2 app created (sandbox)
- [x] Client ID + secret in `.env.local`
- [x] Sandbox company available

---

## Phase 1 — OAuth Plumbing (Backend)

Goal: A user can connect their BnC org to their QBO company and we store valid tokens.

### Models

- **`QBOConnection`** — per-org OAuth state
  - `organization` (FK, unique)
  - `realm_id` (QBO company ID)
  - `access_token` (encrypted)
  - `refresh_token` (encrypted)
  - `access_token_expires_at` (datetime)
  - `refresh_token_expires_at` (datetime)
  - `connected_at`, `disconnected_at`
  - `connected_by` (FK to User)

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/qbo/connect/` | Redirect to Intuit OAuth consent screen |
| `GET` | `/api/v1/qbo/callback/` | Exchange auth code for tokens, store connection |
| `POST` | `/api/v1/qbo/disconnect/` | Clear tokens, mark disconnected |
| `GET` | `/api/v1/qbo/status/` | Return connection status for current org |

### Token Management

- Access tokens expire in **1 hour** — refresh automatically before API calls
- Refresh tokens expire in **100 days** — must be rotated on each use (Intuit returns new refresh token with each refresh)
- If refresh fails (expired, revoked), mark connection as disconnected and surface to user

### Environment

```
QBO_CLIENT_ID=...
QBO_CLIENT_SECRET=...
QBO_REDIRECT_URI=http://localhost:8000/api/v1/qbo/callback/  (dev)
QBO_ENABLED=true  (dev-only gate)
```

### Gating

- Backend: endpoints return 404 if `QBO_ENABLED` env var is not `true`
- Frontend: QBO UI only renders when `isDebugMode` is true

---

## Phase 2 — Entity Sync Infrastructure (Backend)

Goal: Push BnC entities to QBO as create-or-update operations with failure tracking.

### Models

- **`QBOEntityMap`** — per-entity sync state
  - `organization` (FK)
  - `entity_type` (customer, vendor, invoice, vendor_bill, payment_inbound, payment_outbound)
  - `local_id` (integer — BnC record ID)
  - `qbo_id` (string — QBO entity ID)
  - `last_synced_at` (datetime, nullable)
  - `sync_status` (pending, synced, failed)
  - `error_message` (text, nullable)
  - `created_at`, `updated_at`
  - Unique constraint: (organization, entity_type, local_id)

### Entity Mapping

| BnC Entity | QBO Entity | Notes |
|------------|-----------|-------|
| Customer | Customer | Name, email, phone |
| Vendor | Vendor | Name, email |
| Invoice | Invoice | Lines, totals, dates, customer ref |
| Vendor Bill | Bill | Lines, totals, dates, vendor ref |
| Payment (inbound) | Payment | Amount, date, customer ref, invoice ref |
| Payment (outbound) | Bill Payment | Amount, date, vendor ref, bill ref |
| Cost Code | Item/Service | **Hardest mapping** — deferred to Phase 4 |

### Push Adapters

One adapter per entity type. Each adapter:
1. Accepts a BnC model instance
2. Looks up `QBOEntityMap` for existing QBO ID
3. Transforms to QBO API payload
4. Calls QBO API (create or update)
5. Updates `QBOEntityMap` with result
6. Handles errors (rate limit, auth expired, validation)

### Sync Orchestration

- **django-q2 tasks** for background push — decouple from user request cycle
- Sync triggered on status transitions (invoice sent, payment recorded, etc.)
- Manual "Sync Now" button for full org push
- Idempotent: safe to retry, keyed by BnC local_id
- Rate limit awareness: Intuit throttles ~500 req/min per realm

### QBO Python Client

- Use `python-quickbooks` library or raw `requests` against QBO REST API
- Evaluate library maturity before committing — may be simpler to use raw HTTP with our own thin wrapper

---

## Phase 3 — Frontend

Goal: Connect/disconnect QBO from org settings, trigger manual sync, see sync status.

### Organization Page (Document Settings tab)

- "Connect to QuickBooks" button (initiates OAuth redirect)
- Connection status display (connected realm, connected date, token health)
- "Disconnect" button with confirmation
- "Sync Now" button — triggers full org push
- **All gated behind `isDebugMode`**

### Sync Status (Deferred)

- Per-entity sync indicators on invoice/bill/customer rows
- Sync error surfacing
- These can wait until the core push works

---

## Phase 4 — Cost Code ↔ QBO Item Mapping

Goal: Map BnC cost codes to QBO Items/Services so invoice and bill line items push correctly.

This is the hardest part because:
- QBO Items have a different structure (Income Account, Expense Account, type)
- BnC cost codes are flat; QBO items can be hierarchical
- New cost codes need a default QBO mapping or manual assignment

### Approach (TBD)

- One-time pull of QBO Chart of Accounts / Item list on connect
- Mapping UI: table showing BnC cost codes ↔ QBO items, with search/select
- Default behavior for unmapped codes: create QBO Service item automatically, or skip with warning

---

## Implementation Order

```
Phase 1.1  QBOConnection model + migration
Phase 1.2  OAuth endpoints (connect, callback, disconnect, status)
Phase 1.3  Token refresh utility
Phase 1.4  Frontend: connect/disconnect on org settings page
           (milestone: can connect to sandbox QBO)

Phase 2.1  QBOEntityMap model + migration
Phase 2.2  QBO API client wrapper
Phase 2.3  Customer push adapter
Phase 2.4  Vendor push adapter
Phase 2.5  Invoice push adapter (depends on customer mapping)
Phase 2.6  Vendor Bill push adapter (depends on vendor mapping)
Phase 2.7  Payment push adapters (depends on invoice/bill mappings)
Phase 2.8  django-q2 task integration
Phase 2.9  Manual "Sync Now" endpoint + frontend button
           (milestone: can push all entities to sandbox QBO)

Phase 3    Sync status UI (deferred until core push works)

Phase 4    Cost code mapping UI + auto-create logic
```

---

## Open Questions

1. **`python-quickbooks` vs raw HTTP** — need to evaluate library state
2. **Token encryption** — `django-fernet-fields` or manual Fernet wrapper?
3. **Sync trigger granularity** — every status change, or only "sent" / "settled" transitions?
4. **Error notification** — how does the user know a sync failed? Banner? Email?
5. **Initial sync** — when a user connects mid-lifecycle, do we push all existing entities or only new ones going forward?
