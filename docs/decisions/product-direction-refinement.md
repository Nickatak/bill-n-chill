# Product Direction Refinement: Field-First UI + Push-Only Sync

Date: 2026-03-11

## Context

Through real-world testing with an actual contractor, we identified a fundamental mismatch between the current UI's assumptions and the target ICP's reality:

1. **The UI follows the data model, not the user.** The backend's financial rigor (immutable audit records, line-item allocation, snapshot history) is correct and valuable — but it was surfaced directly in the UI, creating a forensic-accounting experience aimed at nobody in our ICP.

2. **We overestimated the ICP's technical comfort.** A 1–10 person GC shop is not staffed with people who think in terms of line-item allocation or payment reconciliation. They think "Mrs. Johnson paid me $5k" and "I owe the lumber yard."

3. **The original QBO sync assumption was wrong.** We assumed BnC was a stepping stone to a "real" accounting system. In reality, these users don't live in QBO — their bookkeeper does, quarterly or at tax time. BnC *is* their system of record.

## Decisions

### 1. BnC is the system of record; QBO is a downstream mirror

- QBO sync will be **push-only** (BnC → QBO). No bidirectional sync.
- BnC owns all financial data. QBO receives a clean copy for the bookkeeper.
- No conflict resolution needed — if the bookkeeper edits something in QBO, that's their concern.
- The only "pull" from QBO may be a one-time Chart of Accounts import to seed cost code mappings.

**Why not bidirectional:** Our ICP doesn't create data in QBO. They don't open QBO. Building conflict resolution and merge logic for a flow that doesn't exist is wasted complexity.

### 2. Bank feed sync (Plaid) is a future channel, separate from QBO

- Plaid (or MX/Finicity) integration for "connect your bank" transaction feeds is a valid future sync source.
- Architecturally distinct from QBO sync — different data shape, different matching logic.
- Not in scope for MVP or v1. Captured here so the sync layer design accounts for multiple inbound sources.

### 3. Payments becomes a first-class feature, not a sync placeholder

The payments feature was originally built as a stand-in until QBO/gateway integration arrived. With push-only sync, payments *is* the real thing.

**Immediate changes (in progress):**
- Strip line-item allocation from payments. Payments allocate at the project level, not per invoice line item.
- Simplify the payment recording flow for speed and mobile usability.

**Design direction:**
- Payment entry should be completable in under 30 seconds from a phone.
- Core flow: "Got paid $X from [customer] via [method]. Done."
- Running balance visibility ("what does this customer owe me?") is already on the project page — this is the right place for it.

### 4. The entire app must work on mobile

The original MVP doc split workflows into "mobile" (quick lookups, status checks) and "desktop" (creation, editing). This split was wrong.

**The reality:** A GC finishes tiling a bathroom, the homeowner is standing there, and they need to create and send an invoice *now*. Not when they get home. Not tomorrow. Now.

**Revised posture:** Every flow must work on mobile. The UI can *adapt* — desktop gets dense tables and inline editing, mobile gets stacked cards and simplified entry — but no flow should be desktop-only.

**Key mobile creation patterns to explore:**
- Stacked line-item cards instead of table rows on small screens.
- Quick-add from cost code library (tap cost code, enter quantity, done).
- Document templates / favorites (see below).

### 5. Document templates (idea — unscoped)

A pre-stored document (estimate, invoice, etc.) that can be loaded into the creator at will. A GC who tiles bathrooms every week shouldn't build an invoice from scratch each time — they should tap "Bathroom Tile," adjust the numbers, and send.

This is the potential unlock for mobile-first document creation. Rather than building complex line items on a small screen, the user selects a template and adjusts.

**Status:** Idea phase only. Not scoped, not designed. Captured here because it directly supports the mobile-first creation story and may influence how we approach the creator UI refactor.

## What doesn't change

- **The backend financial model is correct.** Immutable audit records, snapshot history, proper money handling — all of this stays. It's what makes the QBO push reliable and the audit trail trustworthy.
- **Desktop power-user flows remain dense.** Responsive doesn't mean dumbed-down. Office staff still get full table views with inline editing on wide screens.
- **The estimate → CO → invoice → payment pipeline is the core product.** This refinement is about how it's presented, not what it does.

## Product positioning (refined)

BnC is the **field-facing financial layer** for small GCs. The contractor never opens QuickBooks. They live in BnC — estimates, invoices, payments, all from their phone or truck dashboard. The books appear in QBO automatically for their accountant.

**Accounting-grade infrastructure with a UI simple enough for someone who's never opened QuickBooks.**

## Impact on existing deferred work

- `DEFERRED_PAYMENT_SYNC.md` should be updated to reflect push-only QBO direction and add Plaid as a future channel.
- The MVP doc's mobile/desktop workflow split (§ "Mobile and Desktop Strategy") is superseded by this decision.
- Payments UX work (currently in the work queue as "Payments split") should incorporate the simplified allocation model.
