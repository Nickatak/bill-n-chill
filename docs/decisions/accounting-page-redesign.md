# Decision: Accounting Page Redesign

**Date:** 2026-03-17
**Status:** Decided

## Context

The accounting page (`/accounting`) currently renders a single `PaymentsConsole` component — an inbound-focused, form-first payment recording view. This was the original "Payments" page, renamed to "Accounting" when we recognized that the page needed to serve a broader purpose.

Following the AP model separation (bills as documents, receipts as expense records, payments as cash movement), the accounting page needs to become the central hub that ties all these concepts together. The Payment model already supports duplex cash movement (inbound/outbound via `direction` field), and PaymentAllocation already links payments to invoices and vendor bills. The missing piece is:

1. The UI doesn't reflect the full scope — it's still inbound-focused.
2. Receipts can't be allocation targets yet (only invoices and vendor bills).
3. Bills and receipts aren't browsable from the accounting page — users have to navigate to individual projects to find them.

## Decision

### Tabbed Accounting Page

The accounting page becomes a three-tab layout:

- **Payments** — The main ledger. Shows all payments (inbound and outbound) org-wide. Filterable by project, direction, status. Each row shows direction, amount, counterparty, project, date, status. Clicking a payment opens detail with existing allocations and ability to add more.

- **Bills** — Browse vendor bills by project. These serve as "selector documents" — pick a bill to create an outbound payment against it or allocate an existing payment to it. Not a full bill management UI (that lives on the project page).

- **Receipts** — Same pattern as bills. Browse receipts by project, select one to create or allocate an outbound payment against it.

### Receipts as Allocation Targets

`PaymentAllocation.target_type` gains a third choice: `RECEIPT`, alongside `INVOICE` and `VENDOR_BILL`. A nullable `receipt` FK is added to `PaymentAllocation`. Direction matching: receipts are outbound targets (same as vendor bills).

This means a single outbound payment can be split across vendor bills and receipts — the allocation machinery is uniform.

### Quick Pay

"Quick Pay" is a UI shortcut, not a model. It lives on the projects page as a streamlined flow that creates a real Payment record. No separate model or endpoint — it's sugar over the existing `POST /projects/{id}/payments/` endpoint.

The old `PaymentsConsole` (form-first inbound recording) was effectively the prototype for Quick Pay. Its role is now absorbed into the tabbed accounting page (Payments tab) and the project-level Quick Pay shortcut.

## Consequences

- The Payment model and PaymentAllocation model are unchanged except for adding `RECEIPT` as a target type.
- The accounting page becomes the bookkeeper's primary workspace — all cash movement visible in one place.
- Bills and receipts tabs provide document context without duplicating the full management UIs that live on project pages.
- Receipt → payment linking uses the same allocation flow as invoice/bill → payment, keeping the audit trail consistent.
