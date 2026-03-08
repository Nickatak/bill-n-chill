# Decision Record: Public Approval Workflows (Estimate, Change Order, Invoice)

Date: 2026-02-26
Status: Accepted

## Decision

- Implement public, token-based customer decision endpoints for:
  - estimates (`approve` / `reject`)
  - change orders (`approve` / `reject`)
  - invoices (`approve` / `dispute`)
- Restrict public decisions to explicit "awaiting customer action" states.
- Record all public decisions as auditable status/audit events with optional decider metadata.
- Add a dedicated public change-order page and wire internal links to public share targets.

## Context

- The product already had public read-only estimate/invoice share links.
- We needed actionable public approval to reduce back-and-forth and preserve audit trace.
- Approval semantics differ by object type:
  - estimates establish the project contract baseline,
  - change orders affect financial deltas against the contract value,
  - invoices represent payment/dispute signals.

## Rationale

1. Keep policy explicit per object type rather than forcing one generic endpoint.
2. Guard decisions by lifecycle state to prevent stale-link actions.
3. Reuse existing internal transition logic and audit pipelines instead of parallel public-only logic.
4. Store decider name/email/note as immutable event note context (not as mutable top-level fields).
5. Preserve compatibility with existing public-ref URL pattern (`slug--token`).

## Implemented Behavior

### Estimates

- Endpoint: `POST /api/v1/public/estimates/<token>/decision/`
- Allowed from: `sent`
- Decisions:
  - `approve` -> `approved` + estimate status event
  - `reject` -> `rejected` + estimate status event

### Change Orders

- Added `ChangeOrder.public_token` and serializer `public_ref`.
- Endpoints:
  - `GET /api/v1/public/change-orders/<token>/`
  - `POST /api/v1/public/change-orders/<token>/decision/`
- Allowed from: `pending_approval`
- Decisions:
  - `approve` -> `approved` + applied financial delta to `Project.contract_value_current`
  - `reject` -> `rejected`
- Both write immutable decision snapshot.

### Invoices

- Endpoint: `POST /api/v1/public/invoices/<token>/decision/`
- Allowed from: `sent`, `partially_paid`, `overdue`
- Decisions:
  - `approve` -> transition to `paid` + status event
  - `dispute` -> note-only event (`from_status == to_status`)

## Tradeoffs

- Chosen:
  - Fast operational closure via direct public decisions.
  - High traceability by writing explicit lifecycle and audit events.
- Deferred:
  - token expiry/revocation and anti-abuse controls
  - public user identity model (we currently annotate note fields only)
  - intermediate invoice status (for "approved, unpaid")

## Non-Goals (Current Revision)

- No public edit surface for document content.
- No anonymous public uploads/attachments/comments timeline.
- No new global approval engine abstraction across all artifact types.

## Validation

- Backend tests added for estimate/change-order/invoice public decision flows.
- Targeted frontend lint passed for new/updated public approval components.

## Follow-up Recommendations

1. Add configurable token TTL + revoke endpoint.
2. Add optional "invoice customer approved" intermediate status if finance ops needs it.
3. Add notifications on public decisions (owner email + in-app activity stream).
4. Add integration tests that cover full path: public decision -> accounting/audit timeline rendering.
