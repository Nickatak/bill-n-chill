# Friends Testing Playbook (v1)

Updated: February 28, 2026

## Objective

Validate that the core workflow is understandable and stable for first-time users, then capture high-signal usability and bug feedback.

## Scope For This Round

In scope:

- [ ] account setup and sign in
- [ ] intake -> customer -> project flow
- [ ] quote lifecycle + public quote decision
- [ ] invoice lifecycle + public invoice decision
- [ ] change-order public review/decision path

Out of scope:

- [ ] advanced accounting exports
- [ ] edge-case data migration scenarios
- [ ] deep role/permissions QA across many users

## 0) Founder Self-Run (Do This First)

Run this yourself before inviting anyone:

- [x] Register a fresh account.
- [x] Use Quick Add to create a customer and project.
- [x] Open `/customers`, `/projects`, `/quotes`, `/invoices`, `/financials-auditing`.
- [x] Create an quote, send it, open public link, approve/reject once.
- [x] Create a CO, send it, open public link, approve/reject once.
- [ ] Create an invoice, send it, open public link, approve/dispute once.
- [ ] Confirm no unexpected logout/flicker during normal navigation.
- [ ] Confirm project financials and audit timeline reflect the above actions.

Pass condition:

- [ ] One full loop completes without manual DB fixes or app restart.

## 1) Friend Tester Script (15-20 Minutes)

Give each tester this exact flow:

- [ ] Create account (`/register`) and sign in (`/`).
- [ ] Add a new lead via Quick Add.
- [ ] Open the new customer record and create/open a project.
- [ ] Create an quote with at least 2 line items.
- [ ] Mark quote as sent and open public quote link.
- [ ] On the public page, submit either approve or reject with an optional note.
- [ ] Back in app, create an invoice, set sent status, open public invoice link.
- [ ] On public invoice page, approve or dispute.
- [ ] In project/financials, confirm they can understand what changed and why.

## 2) What You Want Testers To Notice

- [ ] Can they tell what to do next without coaching?
- [ ] Do status transitions feel clear and trustworthy?
- [ ] Is public decisioning understandable to a non-technical client?
- [ ] Is anything visually “jumpy” (flicker/reload/logout behavior)?

## 3) Feedback Prompt (Use Verbatim)

Ask each tester:

- [ ] What was the first moment you felt unsure what to do?
- [ ] What felt broken or unreliable?
- [ ] What did you expect to exist that was missing?
- [ ] What felt surprisingly clear/easy?
- [ ] If this were your real business, what would block adoption today?

## 4) Bug Report Template (For You + Testers)

```text
Title:
Environment: prod/local/staging
Route:
Timestamp (local time + timezone):
Expected:
Actual:
Repro steps:
Screenshot/video:
Console/network errors (if any):
```

## 5) Severity Triage Rules

- Blocker: cannot complete core workflow.
- High friction: workflow completes, but users hesitate or need coaching.
- Polish: cosmetic/confidence improvements with no workflow break.

Patch order: blocker -> high friction -> polish.

## 6) Exit Criteria For This Round

- [ ] At least 3 friend sessions completed.
- [ ] No blocker class bugs remain open.
- [ ] At least 2 repeated friction points identified and prioritized.
- [ ] You can run the full flow twice in a row without restart/workaround.

## 7) Notes For This Specific Build

- Recent stability issue was traced to stale deployment/container state and old naming collisions.
- Deployment now runs frontend in build/start mode (not `next dev`) in orchestration.
- If a tester reports flicker/logout, capture exact timestamp + route + network status code.
