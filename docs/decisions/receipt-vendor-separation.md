# Decision: Receipt & Vendor Model Separation

**Date:** 2026-03-16
**Status:** Decided

## Context

Following the AP model separation (bills as documents, receipts as quick-entry shortcuts, payments on accounting page), we identified that the Vendor model was doing double duty:

1. **B2B relationships** (subs/trades) — "Mike's Framing LLC." These are business relationships: they have contact info, send invoices, are tied to specific trades and projects. Symmetrical to how Customers work on the AR side.

2. **Retail labels** (canonical vendors) — "Home Depot." These aren't relationships at all. Nobody manages a relationship with Home Depot. They're just labels for where cash went on a receipt.

The model carried `is_canonical` (boolean) and `vendor_type` ("trade" | "retail") to bridge this gap, but both types shared the same form, list, and UX. This made the vendor list noisy and the form serve two unrelated purposes.

The deeper problem: receipts were implemented as bills (VendorBill with `kind=RECEIPT`), which forced them through the vendor FK. But a receipt from Home Depot was never really a bill — nobody "receives" or "approves" a Home Depot receipt. The bill was scaffolding so the payment had something to allocate against.

## Decision

### Receipts Are Not Bills

Receipts become their own model, decoupled from VendorBill entirely:

- A **Receipt** is a project-scoped expense record that owns its payment directly. No document lifecycle (no received/approved/disputed). The money already left — you're just recording what happened.
- Shape: amount, date, store name (string), notes, project FK, payment FK. Possibly a cost code.
- The payment is created alongside the receipt atomically (same as today), but allocated to the receipt directly — no bill intermediary.

### Store Name Is a String, Not a FK

The "vendor" on a receipt is just a text field:

- No foreign key to the Vendor model. No shared dataset across orgs. No canonical vendor seeding.
- Autocomplete from the user's own prior receipt store names is a possible future convenience, but not a modeling concern.
- This eliminates the crowdsourced-data problem (typo deduplication, cross-tenant data leaking, entity resolution complexity).

### Vendors Are B2B Only

With receipts decoupled, the Vendor model simplifies:

- **`is_canonical` field removed.** No more system-seeded retail vendors.
- **`vendor_type` field removed.** All vendors are subs/trades — the distinction is gone.
- Vendors are now cleanly symmetrical to Customers: business entities you have a relationship with, who send you documents, who have contact info.
- The `_vendor_scope_filter` null-org fallback for canonical vendors goes away. Vendors are always org-scoped.

### Updated AR/AP Symmetry

| | AR (Outward) | AP (Inward) |
|---|---|---|
| **Relationship entity** | Customer | Vendor |
| **Document** | Invoice | Bill |
| **Quick-entry shortcut** | Quick Payment (against existing invoice) | Receipt (standalone expense record) |
| **Quick-entry "vendor"** | Customer (FK, already on invoice) | Store name (string on receipt) |

Receipts are **not** the AP mirror of Quick Payment. Quick Payment records cash against an existing invoice. Receipts record an expense that already happened — there's no prior document to allocate against.

## Implications

- **New Receipt model** — project-scoped, owns its payment directly, no VendorBill FK.
- **VendorBill loses `kind` field** — no more "receipt" kind. Bills are always bills.
- **Vendor model loses `is_canonical` and `vendor_type`** — all vendors are B2B subs/trades.
- **Vendor list/form simplify** — no more mixing Home Depot next to Mike's Framing.
- **Quick Receipt form simplifies** — text input for store name instead of vendor combobox.
- **`_vendor_scope_filter` simplifies** — no null-org canonical vendor fallback.
- **AP model separation doc updated** — line 102 ("Vendor model is unaffected") is now superseded by this decision.

## What This Does NOT Change

- Bills still reference vendors (B2B subs/trades who send invoices). The vendor FK on VendorBill stays.
- The universal allocation pattern holds — payments are still allocated to documents. Receipts just aren't documents anymore; they carry their payment directly.
- Quick Payment (AR side) is unaffected.
- Accounting page direction is unaffected.
