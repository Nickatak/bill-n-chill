# Payment Sync Integration (Deferred)

## Decision

Payment sync/gateway integration is deferred from MVP. The payments feature operates in manual-entry-only mode: users record payments they've already received or sent, then allocate them to invoices or vendor bills.

## What Was Deferred

- QBO (QuickBooks Online) bidirectional sync
- Payment gateway integration (Stripe, ACH processors)
- Webhook-driven payment status updates
- CSV bulk import for payments
- `failed` payment status (only relevant for automated payment processing where ACH bounces, card declines, etc.)

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

When sync is added back:

1. Uncomment the enum values listed above
2. Re-add `FAILED = "failed", "Failed"` to `Payment.Status` in `backend/core/models/cash_management/payment.py`
3. Re-add `("failed", "Failed")` to `PAYMENT_STATUS_CHOICES` in `payment_record.py`
4. Re-add failed transitions: `PENDING -> FAILED`, `FAILED -> VOID`
5. Update the policy contract version in `backend/core/policies/payments.py`
6. Generate a new migration for the expanded choices
7. Update frontend fallback constants in `payment-recorder.tsx` and `payments-console.tsx` to include "failed"
8. Update `paymentNextActionHint()` in both components
9. Add sync-specific view endpoints and webhook handlers
10. Update reporting attention feed if failed payments should show as high severity

## Date

2026-03-05
