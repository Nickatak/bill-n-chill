# Prospect vs Active Project Boundary

**Date:** 2026-03-21
**Status:** Decided

## Context

Projects start as **prospect** — speculative work that hasn't been committed to.
Once financial activity begins, the project is **active**. The question is: where
exactly is the line, and who/what enforces it?

## Decision

### What "prospect" means

A prospect project is pre-commitment. It may contain:

- Draft estimates (not yet sent to the customer)
- Draft invoices (not yet sent)

It should **not** contain:

- Sent documents of any kind (sending = customer engagement = commitment)
- Vendor bills (incurring costs = commitment)
- Receipts (spending money = commitment)
- Payments (requires payable documents, which a prospect can't have)

### Auto-promotion rule

Any of these four actions **automatically promote a prospect project to active**:

1. **Sending an estimate** — entering the customer engagement loop
2. **Sending an invoice** — billing for work
3. **Creating a vendor bill** — incurring costs from a vendor
4. **Creating a receipt** — spending money on the project

The promotion is silent (no confirmation dialog, no toast). The project status
simply updates. Change orders are not listed because they require an approved
estimate, which requires sending (action 1), so the project is already active.

### Payment visibility

The "Record Payment" button on the projects page is **disabled for prospect
projects**. Since payments require allocation to a document (the 1:1 rule from
`payment-allocation-rules.md`), and prospect projects cannot have sent/payable
documents, the button would be non-functional anyway. Disabling it makes the
constraint visible to the user.

### Relationship to terminal projects

Terminal projects (cancelled, completed) block document **creation** entirely.
Prospect projects don't block creation — they just auto-promote on financial
commitment. The two guards are independent:

| Status     | Create documents? | Send documents? | Record payments? |
|------------|-------------------|-----------------|------------------|
| Prospect   | Yes (drafts)      | Yes (promotes)  | No               |
| Active     | Yes               | Yes             | Yes              |
| On Hold    | Yes               | Yes             | Yes              |
| Completed  | No                | No              | No               |
| Cancelled  | No                | No              | No               |

## Implementation

- **Backend:** `_promote_prospect_to_active(project)` in `views/helpers.py` —
  called from estimate send, invoice send, vendor bill create, receipt create.
- **Frontend:** `isSelectedProjectProspect` flag disables "Record Payment" button.
- **Replaces:** `_activate_project_from_estimate_approval()` which only fired on
  estimate approval and also handled on_hold → active (removed — on_hold projects
  are already considered active for financial purposes).
