# HANDOFF

## Checkpoint
- Latest commit: `3d9fcbb` — **Consolidate vendor workflows and add canonical retail vendor support**
- Branch: `main`
- Working tree note: this handoff file is intentionally left uncommitted for your next session.

## What Shipped

### Vendors / Vendor Bills Workflow
- Moved Vendors out of core workflow nav and into Non-Workflow menu:
  - Removed `/vendors` from workflow bar.
  - Added `/vendors` to Non-Workflow menu (with active highlighting).
- Consolidated Vendors + Vendor Bills onto `/vendor-bills` page:
  - `VendorsConsole` now appears above `VendorBillsConsole`.
- Converted `/vendors` route into a placeholder with link to `/vendor-bills`.

### Canonical Retail Vendor Support
- Added vendor classification fields:
  - `vendor_type`: `trade | retail` (default `trade`)
  - `is_canonical`: boolean (default `false`)
- Added migration:
  - `backend/core/migrations/0021_vendor_vendor_type_vendor_is_canonical.py`
- Updated vendor API create/update to support `vendor_type`.
- `is_canonical` is read-only in serializer output.
- Updated frontend vendor types + UIs to display/vendor-select with:
  - `[trade|retail]`
  - `[canonical]` badge text

### Seed Data
- Updated `seed_bob_demo` to include canonical retail vendors:
  - Home Depot
  - Lowe's
  - Menards
  - Amazon Business
  - Sherwin-Williams
  - Floor & Decor
  - Ferguson
  - Ace Hardware
- Existing demo vendor (`Tile Vendor Co`) explicitly set as `trade`, non-canonical.

### Vendor Bills Hydration Fix
- Resolved client hydration mismatch in `VendorBillsConsole` by removing render-time date initialization.
- Date defaults are now set after mount via `useEffect`.

### Budget Header Reminder
- Added reminder line to budgets page header:
  - "This is the internal “are we still making money on this job?” screen."

## Validation Performed
- Frontend eslint checks passed for modified app/vendor/vendor-bills files.
- Python syntax compile checks passed for changed backend vendor files + migration.
- Full Django test run is still environment-blocked without `pymysql` in this environment.

## Domain Direction Agreed (Important)
- Budgets page is cost-side execution control (not AR manipulation).
- Client payment detail should stay in invoices/payments flows; budget page can show read-only KPI context later.
- Expense flow should eventually support allocation splits across multiple budget lines.
- Canonical retail vendors are now groundwork for merchant-style expenses.

## Suggested Next Session (after artistic exploration)
1. Define expense entry UX split:
   - `vendor_bill` (AP/invoice style)
   - `receipt/card_charge` (merchant style)
2. Introduce allocation model:
   - one expense -> many budget-line allocations
   - enforce allocation sum = expense total
3. Drive budget `committed`/`actual` from expense + status lifecycle, not manual line edits.
4. Refine vendor search UX:
   - canonical-first quick picks for common retail merchants.

## Latest Follow-up (Current Session)
- User requested: in **bill creation form**, add status buttons for `planned` and `received`, with **`received` default**.
- User also requested earlier: edit-status flow already save-gated (must save between transitions).

### What is already done in this follow-up
- Started wiring create payload support for explicit status by updating:
  - `frontend/src/features/vendor-bills/types.ts`
  - `VendorBillPayload` now includes optional `status`.

### What still needs to be finished
1. In `frontend/src/features/vendor-bills/components/vendor-bills-console.tsx`:
   - Add create-only state, e.g. `newStatus`, defaulting to `"received"`.
   - Add a create-mode status button group (same style as estimate/bill status buttons) with only:
     - `planned`
     - `received`
   - Ensure selected create status is sent in `handleCreateVendorBill -> createVendorBill(...)` payload.
   - Reset create status back to `"received"` in `handleStartNewVendorBill`.
2. Keep edit-mode status behavior unchanged:
   - step-locked transitions with save-required between steps.

### Notes / Constraints
- This repo currently has many unrelated local modifications; do not revert unrelated files.
- New migrations exist and may need to be applied locally (`make local-migrate`) before runtime verification.

## Deferred Idea: Project Timeline (V1 Spec Stub)
- Status: intentionally deferred (documented only; no implementation now).
- Goal: chronological visual map of project events on the project page.

### V1 In Scope
- Read-only timeline view.
- Reverse-chronological event stream grouped by day.
- Event rows include:
  - `occurred_at`
  - `event_type`
  - `object_type` + `object_id`
  - short `summary`
  - actor/source metadata when available
- Deep links from timeline rows to source records (estimate, budget, invoice, vendor bill, payment, etc.).
- Filter chips + optional date-range:
  - financial
  - status
  - docs
  - system

### V1 Data Sources (initial)
- Existing financial audit events.
- Estimate status events.
- Accounting sync events.
- Key create/update lifecycle milestones already emitted by current modules.

### V1 Non-Goals
- No timeline-based edits or status transitions.
- No cross-object write actions from timeline rows.
- No advanced analytics/insights layer (timeline is narrative context only).

### Implementation Guardrails
- Stable sort for same-timestamp events.
- Paginated/infinite loading for large histories.
- Keep event contract normalized so new modules can append events without UI rewrites.
