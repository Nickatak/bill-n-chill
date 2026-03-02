# Deferred: Multi-Currency Support

Decision date: 2026-03-01

## Decision

Currency fields have been intentionally removed from vendor bills (and are not present on invoices, estimates, or change orders). The app assumes USD for all monetary values.

## Rationale

- Target market is US-based construction contractors only.
- Multi-currency introduces significant complexity: exchange rates, conversion timing, reconciliation, reporting in base vs. foreign currency, and cross-currency payment allocation.
- None of these concerns are relevant to the current ICP.

## Scope of deferral

- No `currency` column on any financial model.
- No currency selector in any document creator form.
- All amounts are implicitly USD.

## Revisit triggers

- International expansion or customers operating across currency boundaries.
- Vendor/subcontractor billing in non-USD currencies.
