# Work Queue — Backend Housekeeping (2026-04-01)

Deferred items from the backend audit that need further evaluation before acting.

## Structural

- **Add VendorBillStatusEvent model** — Quote, Invoice, and CO all have `*StatusEvent` audit trails. VendorBill only has snapshots, so you can't query status transition history without parsing full snapshot JSON. Would add a new model + seed data + serializer field on the read serializer.

## Serializer Parity

- **VendorBillSnapshotSerializer missing `action_type` classification** — Quote/Invoice/CO status event serializers classify events as create/transition/resend/notate. VendorBill snapshot serializer only does transition/notate/unchanged. Needs create/resend logic added.
- **VendorBillWriteSerializer missing `status` field** — Invoice, Quote, and CO write serializers all include a `status` ChoiceField. VendorBill doesn't. May be intentional (status transitions go through dedicated endpoints) but should be confirmed.

## Public Decision Response Meta

- **Inconsistent meta in public decision responses** — Quotes return no `meta` key. Invoices return `{"meta": {"public_decision_applied": ...}}`. COs return `{"meta": {"applied_financial_delta": ...}}`. Need to decide on a standard shape.

## Code Quality

- **Upgrade deprecated `unique_together` to `UniqueConstraint`** — Quote, ChangeOrder, and Invoice still use the deprecated `unique_together` in Meta. VendorBill already uses the modern `UniqueConstraint`. Low-risk migration.
- **Stale `.pyc` files from deleted models** — `contacts.cpython-312.pyc`, `estimates.cpython-312.pyc`, `store.cpython-312.pyc`, `receipt.cpython-312.pyc` in various `__pycache__/` dirs. Harmless but messy. Run `find . -type d -name __pycache__ -exec rm -r {} +` to clean.
