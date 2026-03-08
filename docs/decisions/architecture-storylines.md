# Architecture Storylines (Interview + Bug Report Context)

Last updated: 2026-02-28

## 1) Money-Loop Integrity by Design
- Core idea: keep scope, billing, and payment states connected end-to-end so every dollar is traceable.
- Implementation stance: strict lifecycle transitions + immutable capture records for financially relevant events.
- Why it matters: easier reconciliation, safer edits, lower risk of silent financial drift.

## 2) Mutable Workflow + Immutable Evidence
- Operators can update workflow objects where needed.
- Every high-impact write emits append-only records/snapshots (`*Record`, `*Snapshot`, status events).
- Practical outcome: auditability without freezing normal operations.

## 3) Public Approval Without Customer Accounts
- Tokenized public routes for estimates/change orders/invoices.
- Decisions are state-gated and recorded with decision metadata.
- Tradeoff intentionally accepted: fast customer response now; stronger signer assurance (e-sign + PSK/TTL/revocation) deferred post-MVP.

## 4) Contract-First Frontend Behavior
- Frontend consumes policy/contract endpoints for status transitions.
- UI behavior stays aligned to backend lifecycle rules without duplicating policy logic in many places.
- Useful for debugging: compare live contract payload vs UI action rendering.

## 5) Project-Centric Financial Explainability
- Project financial summary rolls up contract, approved deltas, invoicing, payments, AP, and outstanding balances.
- Traceability buckets expose source transaction paths for each metric.
- Good bug-report framing: metric mismatch -> identify bucket -> inspect records and status history.

## 6) Operational Deployment Posture
- App repo stays orchestration-ready with stable service names and override-friendly compose contract.
- Deployment path is pull + rebuild via host orchestration repo.
- Debugging payoff: app changes and ops overrides are separable.

## Bug Report Angles To Reuse
- State-transition mismatch: expected allowed transition vs denied transition and current status.
- Financial propagation mismatch: change order approval/void not reflected in contract value aggregates.
- Traceability mismatch: summary metric does not match source record subtotal.
- Public decision conflict: token valid but object no longer in decision-eligible status.

