# Decision: Unified Vendor Model — Merging Store Back Into Vendor

**Date:** 2026-03-24
**Status:** Decided
**Supersedes:** `receipt-vendor-separation.md` (Store/Vendor split)

## Context

The `receipt-vendor-separation` decision (2026-03-16) split the payee model into two:

- **Vendor** — B2B relationships (subs, trades, suppliers). Full contact info, duplicate detection, CSV import, active/inactive lifecycle. Symmetrical to Customer on AR.
- **Store** — Retail labels (Home Depot, Lowe's). Just a name. Auto-created on expense submission. Org-scoped lookup table.

The rationale was clean: nobody manages a "relationship" with Home Depot. Vendors are business relationships; stores are labels.

In practice, though, we discovered that the distinction created more friction than it resolved:

1. **The bill form required a vendor/store decision.** Users saw a unified "From" combobox that merged both lists with kind badges ("Vendor" / "Store"). This is a decision that doesn't need to exist — you're recording who you paid, and you shouldn't have to classify the payee type to do it.

2. **Vendor was overkill for 90% of use cases.** Most contractors don't care about a vendor's email, phone, or tax ID at creation time. They care about the name on the bill. The multi-field vendor form was a barrier to quick data entry.

3. **Store was too thin to manage.** Stores had no CRUD UI — they were auto-created and invisible. When we went to build a management page for stores (rename typos, delete duplicates), we realized it was just... a simpler version of the vendor page. Two management UIs for entities that differ by three optional fields.

4. **The data model carried unnecessary complexity.** VendorBill had both `vendor` and `store` FKs with mutual exclusivity validation. The serializer had to return both `vendor_name` and `store_name`. The expense endpoint created stores; the bill endpoint referenced vendors. The receipt scan had to classify document type to decide which field to populate.

The deeper realization: the original separation was modeling a distinction that matters to accountants (B2B vendor vs. retail purchase) but not to the users of this app. Construction contractors think in terms of "who did I pay" — whether that's a framing sub or Home Depot is context they already know. The app doesn't need to enforce the taxonomy.

## Decision

### One Payee Entity: Vendor

Store is absorbed into Vendor. There is one payee model:

- **Name is the only required field.** Email, phone, tax ID (last 4), notes, active status — all optional. Users fill them in when the relationship warrants it. Most won't.
- **`Vendor.get_or_create_by_name()`** handles the quick-expense flow. Type a name, the backend finds or creates the vendor (case-insensitive). Same auto-create behavior Store had.
- **No vendor/store classification.** The bill form has one vendor picker. No kind badges, no mutual exclusivity, no document-type-based routing.

### What Changed on VendorBill

- **`store` FK removed.** All bills point to `vendor` (nullable, for draft/scan-in-progress states).
- **`clean()` simplified.** Removed the two-path validation that coupled bill_number presence to vendor presence. Bill number is now always optional — quick expenses and retail purchases don't have one.
- **`build_snapshot()`** captures `vendor_name` instead of `store_id`/`store_name`. Snapshots taken before this change retain the old fields in their JSON (immutable, not migrated).

### Migration Path

Migration 0013 handles the data migration:
1. For each Store, find or create a matching Vendor in the same org (case-insensitive name match).
2. Update VendorBill rows: where `store_id` was set and `vendor_id` was null, point `vendor_id` at the migrated vendor.
3. Remove the `store` FK from VendorBill.
4. Drop the Store model.

### UX Changes

- **Bills console:** Single vendor combobox. No more "Select vendor or store" error. No more kind badges.
- **Vendors page:** Single-panel CRUD layout. The short-lived Stores tab (built and removed same session) is gone.
- **Expense endpoint:** Accepts `vendor_name` (and `store_name` as legacy compat). Auto-creates Vendor.
- **Receipt scan:** `normalize_scan_result()` merges `store_name` into `vendor_name`. Gemini still extracts both (it's good at distinguishing), but the frontend always gets a unified `vendor_name`.
- **Project pipeline link:** Renamed "Bills" to "Expenses" — better reflects the unified scope.

## The Circle

The model we landed on looks superficially similar to early iterations of Vendor — a single entity with optional fields. But the constraints are fundamentally different:

| | Early Vendor (pre-separation) | Post-merge Vendor |
|---|---|---|
| **Required fields** | Name, plus implicit expectation of contact info | Name only |
| **bill_number coupling** | Required when vendor set | Always optional |
| **Auto-creation** | No — manual form only | Yes — `get_or_create_by_name()` |
| **Duplicate handling** | 409 hard block | 409 soft detection (view-level) + case-insensitive get_or_create |
| **VendorBill relationship** | Vendor required for "real" bills, null for expenses | Vendor optional on all bills, set on most |
| **Classification** | `is_canonical`, `vendor_type` fields | None — one type |

The early model tried to be both things at once and satisfied neither. The separation clarified what each concept actually needed. The re-merge kept those learnings — a vendor is just a name unless you need it to be more.

## What This Supersedes

- **`receipt-vendor-separation.md`** — Store model, `is_canonical`/`vendor_type` removal, "Vendors are B2B only" stance. The Vendor simplification holds; the Store separation is reversed.
- **`ap-model-separation.md`** — Still accurate for bill lifecycle and payment allocation. The "receipts as quick-entry" concept survives but uses Vendor instead of Store.
