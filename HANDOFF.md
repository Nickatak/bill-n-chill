# HANDOFF - 2026-02-26

## Session State

- Workspace: `/home/nick/bill_n_chill`
- Branch: `main`
- Upstream: `origin/main`
- Active direction: Billing UX hardening (Invoices + Vendor Bills)

## What Is Stable Right Now

### Invoices

- Invoices route no longer uses the old `Invoice Workspace (WIP)` wrapper.
- Project selector remains in place (dashboard/list style), and composer is now full-width.
- Invoice create uses shared `DocumentComposer` with an estimate-style visual structure:
  - from/to + logo/title header
  - invoice details block
  - full-width line table
  - add-line action + totals footer
  - create action anchored in the sheet footer
- Viewer now owns invoice lifecycle actions:
  - `Invoice Status & Send` panel in viewer section
  - estimate-style status-pill selector
  - `Duplicate as New Invoice` (no family/revision behavior)
- Sales tax input is retained in totals (explicitly kept configurable).

### Vendor Bills

- Added viewer-side lifecycle/recreate panel:
  - `Bill Status & Recreate`
  - next-status pill selector
  - `Save Status`
  - `Recreate as New Planned`
- Removed duplicate/competing status controls from the edit form so lifecycle actions are centralized in viewer.
- Added corresponding CSS for new viewer status panel with dark-theme treatment.

## Files Updated In This Checkpoint Window

- `frontend/src/features/invoices/components/invoices-console.tsx`
- `frontend/src/features/invoices/components/invoices-console.module.css`
- `frontend/src/features/vendor-bills/components/vendor-bills-console.tsx`
- `frontend/src/features/vendor-bills/components/vendor-bills-console.module.css`

## Validation

- Frontend typecheck: `cd frontend && npx tsc --noEmit`.

## Recommended Next Focus (Billing)

1. Continue in Vendor Bills first (agreed path): spacing/alignment parity pass and interaction polish.
2. Decide whether Vendor Bills should adopt shared `DocumentComposer` now or after lifecycle UX settles.
3. Add/confirm guardrails for duplicate naming/id constraints where applicable in billing flows.
4. Run manual UX pass for both billing surfaces (desktop/mobile, light/dark) after each small CSS batch.
