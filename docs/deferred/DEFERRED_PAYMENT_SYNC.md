# Payment Sync Integration (Deferred)

## Decision

Payment sync integration is deferred from MVP. The payments feature operates as the primary system of record — users record payments directly in BnC, and the data is pushed downstream to accounting systems.

See `docs/decisions/product-direction-refinement.md` for the strategic context behind these decisions.

## Sync Channels (Planned)

### 1. QBO Push Sync (Priority — post-MVP)

**Direction:** Push-only (BnC → QBO). BnC is the system of record; QBO is a downstream mirror for the bookkeeper.

**Entity mapping:**
- Customer → QBO Customer
- Vendor → QBO Vendor
- Invoice → QBO Invoice
- Vendor Bill → QBO Bill
- Payment (inbound) → QBO Payment
- Payment (outbound) → QBO Bill Payment
- Cost Codes → QBO Items/Services (mapping TBD — this is the hardest part)

**Auth:** OAuth 2.0 via Intuit. Refresh tokens stored per org. Access tokens expire in 1 hour, refresh tokens in 100 days (must be rotated).

**Sync trigger:** TBD — likely real-time push on status transitions (invoice sent, payment recorded) with a manual "sync now" fallback.

**Design considerations:**
- Idempotent create-or-update on QBO side, keyed by BnC internal IDs
- Per-entity sync status tracking (handles partial failures gracefully)
- No conflict resolution — edits in QBO are the bookkeeper's concern
- Rate limits: Intuit throttles ~500 req/min per realm; batch operations needed for initial sync
- One-time Chart of Accounts pull may be useful to seed cost code mappings

### 2. Bank Feed via Plaid (Future — post-QBO)

**Direction:** Inbound transaction feed. User connects bank via Plaid Link (BnC never sees credentials), BnC pulls transactions and suggests matching against open invoices/bills.

**Architecturally distinct from QBO sync** — different data shape, different matching/reconciliation logic. Exists as a convenience layer to reduce double-entry for users who don't use QBO.

**Not designed or scoped.** Captured here so the sync layer architecture accounts for multiple inbound sources from the start.

### 3. Payment Gateway (Deferred indefinitely)

- Stripe, ACH processors, webhook-driven payment status
- Only relevant if BnC adds customer-facing payment collection (pay-by-link on invoices)
- Not in current product direction — BnC records payments, doesn't process them
- `failed` payment status only becomes relevant here (ACH bounces, card declines)

## What Was Deferred

- QBO push sync
- Bank feed integration (Plaid/MX/Finicity)
- Payment gateway integration (Stripe, ACH processors)
- Webhook-driven payment status updates
- CSV bulk import for payments
- `failed` payment status (only relevant for gateway processing)

## Artifacts Commented Out (with TODO markers)

These enum values are commented out in the codebase for re-implementation when sync is built:

### PaymentRecord.EventType (`backend/core/models/financial_auditing/payment_record.py`)
- `IMPORTED` — for CSV/bulk import events
- `SYNCED` — for gateway/QBO sync events

### PaymentRecord.CaptureSource
- `ACH_WEBHOOK` — for ACH processor webhook events
- `PROCESSOR_SYNC` — for payment processor sync events
- `CSV_IMPORT` — for bulk CSV import events

### PaymentAllocationRecord.CaptureSource (`backend/core/models/financial_auditing/payment_allocation_record.py`)
- Same three values as PaymentRecord.CaptureSource

## Re-implementation Checklist

When QBO push sync is added:

1. Uncomment the `SYNCED` enum values listed above
2. Implement OAuth 2.0 token storage model (per-org)
3. Build entity push adapters (Customer, Invoice, Payment, Vendor, Bill)
4. Add per-entity sync status tracking
5. Build cost code ↔ QBO item mapping UI
6. Add sync-specific view endpoints
7. Update the policy contract version in `backend/core/policies/payments.py`
8. Generate a new migration for expanded choices

When payment gateway is added (if ever):

1. Uncomment remaining enum values (ACH_WEBHOOK, PROCESSOR_SYNC)
2. Re-add `FAILED = "failed", "Failed"` to `Payment.Status`
3. Re-add `("failed", "Failed")` to `PAYMENT_STATUS_CHOICES` in `payment_record.py`
4. Re-add failed transitions: `PENDING -> FAILED`, `FAILED -> VOID`
5. Add webhook handlers
6. Update frontend to include "failed" status
7. Update reporting attention feed if failed payments should show as high severity

## Date

Originally deferred: 2026-03-05
Updated with push-only direction + Plaid channel: 2026-03-11
