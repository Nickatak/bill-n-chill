# Payment Allocation Rules

**Decided:** 2026-03-21
**Status:** Active
**Supersedes:** Earlier direction (2026-03-12) that made allocation optional

## Context

Payments were originally designed with optional allocation — a payment could
be recorded against a project without linking to any invoice or vendor bill.
This created two problems:

1. **Discoverability:** The accounting UI scopes by document. A freestanding
   payment with no document attachment is invisible in the ledger.
2. **Audit trail:** A payment without a document has no paper trail connecting
   "why did this money move?" to a scope of work.

## Decisions

### 1. Every payment must allocate to exactly one document

- **Inbound payments** must allocate to one invoice.
- **Outbound payments** must allocate to one vendor bill.
- If a contractor receives a deposit before any invoice exists, they create a
  deposit invoice first. This produces a real business artifact and keeps the
  data model clean.

### 2. No split payments

A single payment cannot be distributed across multiple documents. The
relationship is strictly **1 payment → 1 document**.

Multiple payments *can* point at the same document (e.g., two partial payments
against one invoice). The relationship is **many payments → 1 document**.

### 3. Partial allocation is valid

A $2,000 payment against a $5,000 invoice is fine. The invoice moves to
`partially_paid` status. The payment is fully applied — its entire amount
goes to that one document.

## Enforcement

- **Backend:** Payment creation rejects if no allocation target is provided.
  The `allocations` array must contain exactly one entry.
- **Frontend:** Payment recorder is disabled/hidden when no valid allocation
  targets exist for the selected project. Shows guidance like "Create an
  invoice first to record payments."

## Grandfathering

Any existing payments created before this rule took effect remain valid.
No retroactive migration needed.

## Rationale

- Forces good bookkeeping hygiene, which produces more value from the tool.
- Keeps the audit trail intact for every dollar that moves.
- Simplifies the accounting UI — every payment is reachable through its
  associated document.
- The "create an invoice first" friction is small and produces a real artifact
  the contractor likely needs anyway.
