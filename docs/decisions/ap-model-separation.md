# Decision: AP Model Separation — Bills, Receipts, and Payments

**Date:** 2026-03-16
**Status:** Decided

## Context

We were struggling with the bills/AP section of the application because we had conflated three distinct concepts into one entity:

1. **Budget** — "I plan to spend $X on framing." Forward-looking allocation. We correctly killed this as a standalone entity earlier, but it crept back in as the `PLANNED` status on bills.
2. **Bill** — "Sub A sent me this invoice." An inbound document — a claim against you.
3. **Outgoing payment/expense** — "I paid Sub A $52k." Actual cash leaving your account.

The `PLANNED` bill status was really a budget line item in disguise. The bill lifecycle mixed document tracking with cash management. Cost attribution was jammed into bill line items when it belongs on the payment side.

## Key Insight: The Recursive Loop

ICs and GCs don't have fundamentally different financial relationships — a GC just has one more level of the same relationship. From any user's perspective:

- **AR (outward):** I do work → I send invoices → customer pays me.
- **AP (inward):** Someone does work/provides materials for my project → they send me a bill → I pay them.

The sub on the other end is a different user running the same loop. This means bills don't need to model the sub's cost structure (their cost codes, their line item breakdown). Bills are **inbound documents**, not reconstructions of someone else's quote.

## Decision

### Three Distinct Concepts

**Bills** are inbound documents, project-scoped, with a document lifecycle:
- They are the AP mirror of invoices (AR). One you author and send out, one you receive and process.
- Lifecycle is about the document: **Received → Approved → Disputed / Voided / Closed**. These are document statuses, not payment statuses. **Closed** is the manual reconciliation mechanism — it settles a bill that is only partially paid (e.g., dispute resolved, negotiated discount, write-off). The bill's original amount stays as-is (it's what the vendor sent), but Closed signals "we're done with this, the gap is intentional."
- "Paid" is not a bill status — it's derived state from payment allocations covering the balance. (This differs from invoices, which keep an explicit PAID status transition — because you control the invoice amount, there's no reconciliation gap to worry about. On AP, you don't control the bill amount, so derived status + Closed is needed for flexibility.)
- No `PLANNED` status. That was a budget concept that doesn't belong here.
- Bill line items are **not** quote/invoice-style (no qty × rate). They are simple transcriptions of what the vendor wrote on their invoice: **description + amount**. The GC is recording what they received, not reconstructing someone else's cost structure.
- Cost code on line items is **optional**. The incoming invoice might be from Jobber, Buildr, Procore, or pen and paper — there may be no cost code on the source document at all. The GC *can* tag a line to one of their own cost codes for internal tracking, but it's their choice, not a structural requirement.

**Receipts** are a quick-entry shortcut where the document and payment are the same moment:
- "I spent $237 at Home Depot for this project."
- Recording a receipt creates both the bill (expense record) and the payment allocated against it simultaneously. Same allocation mechanics as a regular bill, just collapsed in time.
- Receipts are backward-looking — the money already left.

**Payments** are cash movement events, living on the accounting page:
- All payments (inbound from customers against invoices, outbound to vendors against bills) in one place.
- This is where cost attribution and project profitability tracking live.
- Outbound payments against bills are a separate, explicit user action taken on the accounting page.

### Universal Allocation Pattern: Payment → Document

There is one payment allocation pattern in the entire system: **payments are allocated to documents** (invoices or bills). Everything flows from this:

| | AR | AP |
|---|---|---|
| **Document** | Invoice | Bill |
| **Payment allocated to** | Invoice | Bill |
| **Paid status** | Derived from allocations vs. invoice total | Derived from allocations vs. bill total |
| **Project context** | Via invoice | Via bill |
| **Cost code context** | Via allocation (carries its own cost code) | Via allocation (carries its own cost code) |
| **Quick-entry shortcut** | Quick Payment (payment only, against existing invoice) | Receipt (creates bill + payment together) |

The quick-entry shortcuts are **not symmetrical**. On AR, you control the invoice — it already exists, so Quick Payment just records the cash event. On AP, you don't control the inbound document — the receipt shortcut *must* create both the bill and the payment because you're recording after the fact.

Payments don't need their own project tags — the document they're allocated against provides project context. **Cost codes live on the allocation itself**, not on the payment or inherited from the document. The GC classifies the spend at payment time, which is the most accurate moment to make that decision. A single payment against a multi-trade bill can be split into multiple allocations, each with its own cost code (e.g., $30k to framing, $22k to finish work). Bill line item cost codes may pre-populate as a suggestion, but the allocation is authoritative.

This means:
- **Bill → Payment:** Two distinct moments. Bill arrives first (document lifecycle), user pays later on the accounting page. Payment is allocated to the bill.
- **Receipt → Payment:** One moment. Receipt creates both the bill (expense record) and the payment allocated against it simultaneously. Same mechanics, just collapsed in time.
- **Unpaid / Partially Paid / Paid** is not a lifecycle status — it's the presence (and coverage) of payment allocations against the bill.

### Profitability Metrics Source

Cost code profitability (and project profitability generally) is derived from **payment allocations**, not bill line items. The allocation carries its own cost code — this is the authoritative cost-code-level spend data. Bill line items represent what a vendor *claims* you owe; payment allocations represent what you *actually spent* and how you classified it.

Bill line item cost code tags are an input convenience (the GC classifying what they received). They may serve as default suggestions when creating allocations, but are not authoritative for profitability metrics.

## Quick-Entry Location: Projects Page

Both quick-entry shortcuts live on the **projects page** as a tabbed form (not on the bills page or accounting page):

- **Quick Payment** tab — inbound, customer paid you (already exists). Creates payment allocated to an existing invoice.
- **Quick Receipt** tab — outbound, you spent money. Creates a bill (in approved status) + outbound payment allocated to it, in one action.

Both are project-scoped — you're already in project context, so the form skips "which project?" The project provides the fiscal vehicle.

The **bills console** (`/projects/[projectId]/bills`) is for the formal vendor bill workflow only — receiving, approving, disputing. No quick-entry form there.

The **accounting page** will eventually have its own entry forms for when you're not starting from a project context — but that's a separate effort.

## Implications

- Bill `PLANNED` status is removed.
- Bill line items are simplified: description + amount (transcription of vendor's invoice), with optional cost code tag. No qty × rate.
- "Paid" status on bills becomes derived from payment allocations.
- Receipt creation also creates an outbound payment record.
- Accounting page is the single home for all payment recording and cash movement visibility.
- Record Payment flow moves from the bill status panel to the accounting page. Mark Paid is replaced by the **Closed** bill status.
- Quick Receipt form moves from the bills console to the projects page (tabbed alongside Quick Payment).

## What This Does NOT Change

- Quotes, invoices, and change orders are unaffected. Invoices keep their explicit PAID status transition (you control both sides of the data).
- Inbound payment recording against invoices follows the same universal pattern — moves to accounting page as already planned.
- ~~Vendor model is unaffected~~ — Superseded by [Receipt & Vendor Model Separation](receipt-vendor-separation.md). Receipts are decoupled from bills, vendors become B2B only.
