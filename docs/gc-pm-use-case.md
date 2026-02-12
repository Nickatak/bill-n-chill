# GC/PM Perspective Scenario (v1)

## Purpose

Define an end-to-end general contractor/project manager scenario and map each step to required features, data objects, and edge handling.

## Persona

- Role: General Contractor / Project Manager
- Environment: field + office
- Device pattern:
  - Mobile for capture, status, and fast decisions.
  - Desktop for financial authoring, validation, and reporting.

## Scenario Summary

A GC gets a qualified homeowner lead, starts a remodel project, builds and approves scope, manages changes in the field, bills the client, pays vendors, and closes with clean financial visibility.

## End-to-End Steps

## 1. Capture Contact in the Field

Example moment:
- PM is at a job walk and needs to quickly capture prospect details.

Required features:
- Mobile Quick Add Contact form.
- Required minimum fields:
  - Contact name
  - Phone
  - Project address
- Optional fields:
  - Email
  - Notes
  - Lead source
- Duplicate detection using phone/email.

Primary entities:
- `LeadContact`

Edge conditions:
- Duplicate found:
  - Prompt merge or continue with explicit override.
- Offline/weak signal:
  - Save local draft and sync when connected (future enhancement if offline is not in v1).

## 2. Convert Contact to Customer + Project Shell

Example moment:
- PM returns to office and qualifies the lead to active preconstruction.

Required features:
- One-step convert action from lead contact.
- Auto-create:
  - `Customer`
  - `Project` in `prospect` or `active` status based on selection.
- Preserve lead source trail.

Primary entities:
- `LeadContact`, `Customer`, `Project`

Edge conditions:
- Existing customer match:
  - Attach new project to existing customer rather than duplicating.

## 3. Build Estimate and Send for Approval

Example moment:
- PM scopes labor/material lines and pricing for owner review.

Required features:
- Desktop-first estimate editor:
  - Line items
  - Cost codes
  - Markup and tax
- Versioning support on estimate revisions.
- Send/approve/reject estimate flow.

Primary entities:
- `Estimate`, `EstimateLineItem`, `CostCode`

Edge conditions:
- Owner asks for revision:
  - Clone to new estimate version without losing prior approved/rejected history.

## 4. Convert Approved Estimate to Budget Baseline

Example moment:
- Estimate is approved and must become execution baseline.

Required features:
- Convert estimate to active budget action.
- Immutable baseline snapshot.
- Editable working budget lines for execution updates.

Primary entities:
- `Budget`, `BudgetLine`

Edge conditions:
- Attempt to convert unapproved estimate:
  - Block action with explicit validation reason.

## 5. Execute Work and Capture Scope Changes

Example moment:
- Field conditions require additional work not in original scope.

Required features:
- Mobile-friendly change order draft creation.
- Approval workflow:
  - Draft -> pending approval -> approved/rejected.
- Automatic financial impact application after approval.

Primary entities:
- `ChangeOrder`, `Project`, `Budget`

Edge conditions:
- Work started before change approval:
  - Allow draft with warning; track approval lag for audit.
- Rejected change:
  - Keep full history, do not alter budget/contract totals.

## 6. Issue Owner Invoice

Example moment:
- PM/bookkeeper creates progress invoice for completed phase.

Required features:
- Desktop invoice composer.
- Pull eligible billable amounts from current scope.
- Invoice status lifecycle:
  - Draft, sent, partially paid, paid, overdue, void.

Primary entities:
- `Invoice`, `InvoiceLine`

Edge conditions:
- Invoice includes unapproved change:
  - Block by default or require explicit override with audit note.

## 7. Record Incoming Payment

Example moment:
- Client pays partial amount by ACH/check/card.

Required features:
- Record inbound payment with method and reference.
- Allocate payment across one or multiple invoices.
- Automatic balance updates.

Primary entities:
- `Payment`, `PaymentAllocation`, `Invoice`

Edge conditions:
- Overpayment:
  - Record unapplied credit or force user to allocate remainder explicitly.

## 8. Record Vendor Bills and Outbound Payments

Example moment:
- Subcontractors submit bills; office schedules payouts.

Required features:
- Vendor bill intake tied to project and cost codes.
- Approval/scheduled/paid lifecycle for vendor bills.
- Outbound payment recording and bill allocation.

Primary entities:
- `Vendor`, `VendorBill`, `Payment`, `PaymentAllocation`

Edge conditions:
- Duplicate bill number from same vendor:
  - Warn and require explicit confirmation.

## 9. Monitor Financial Health and Reconcile

Example moment:
- PM reviews project margin and outstanding receivables/payables weekly.

Required features:
- Project financial summary view:
  - Contract original/current
  - Approved CO totals
  - Invoiced, paid, AR outstanding
  - AP totals, AP paid, AP outstanding
- Drill-down links to source records.

Primary entities:
- `Project` summary + all referenced financial objects

Edge conditions:
- Summary mismatch:
  - Surface reconciliation alert and identify stale/failed sync records.

## 10. Sync/Export to Accounting

Example moment:
- Bookkeeper finalizes entries for accounting close.

Required features:
- QuickBooks Online sync or reliable export fallback.
- Sync status tracking per object.
- Retry path for failures.

Primary entities:
- `AccountingSyncEvent`

Edge conditions:
- Partial sync failure:
  - Keep failed object queue visible with actionable error messages.

## Feature Edges (What v1 Is and Is Not)

In v1:
- Lightweight intake and handoff.
- End-to-end money workflow after contact qualification.
- Strong audit trail across estimates, changes, billing, and payments.

Not v1:
- Full CRM pipeline automation.
- Advanced scheduler dependency graphs.
- Heavy enterprise governance workflows.

## MVP Coverage Checklist

Use this checklist before claiming a workflow is complete:

1. Can PM complete the step on the intended device in under expected time?
2. Is there an explicit state transition with validation?
3. Is there an audit trail entry for money-impacting actions?
4. Does the project financial summary update correctly?
5. Are main edge conditions handled with clear user feedback?
