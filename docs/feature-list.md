# bill-n-chill Feature Ledger

Last reviewed: 2026-03-04

## Purpose

Track implementation-complete feature slices without duplicating full API/domain specs.

## Current Status

- Current Feature: `Complete`
- Completed Features: `34/34`
- State: all MVP v1 slices and RBAC phases listed below are shipped.

## How To Use This File

- Use this as a compact completion ledger.
- Use these docs for detailed behavior/acceptance:
  - API contracts: `docs/api.md`
  - Domain/lifecycle rules: `docs/domain-model.md`
  - Frontend feature ownership: `frontend/src/features/*/FEATURE_MAP.md`

## Completed Slices

### Phase 0: Foundation

1. `FND-01` Monorepo scaffolding
2. `FND-02` Auth and user session baseline
3. `FND-03` Company/tenant context

### Phase 1: Intake and Project Setup

4. `INT-01` Quick Add Customer (mobile-first)
5. `INT-02` Duplicate detection and resolution
6. `INT-03` Convert lead to customer + project shell
7. `PRJ-01` Project profile and contract baseline

### Phase 2: Estimating

8. `EST-01` Cost code management
9. `EST-02` Estimate authoring and versioning
10. `EST-03` Estimate approval lifecycle

### Phase 3: Change Management and Billing

11. `CO-01` Change order creation and lifecycle
12. `CO-02` Change order financial propagation
13. `CO-03` Change order decision snapshots
14. `INV-01` Invoice composition and send
15. `INV-02` Unapproved scope billing protection

### Phase 4: AP and Payments

16. `VEN-01` Vendor directory
17. `AP-01` Vendor bill intake and lifecycle
18. `PAY-01` Payment recording (inbound/outbound)
19. `PAY-02` Payment allocation engine

### Phase 5: Financial Visibility and Accounting

20. `FIN-01` Project financial summary
21. `FIN-02` Drill-down traceability
22. `RPT-01` Reporting pack (portfolio + change-impact)
23. `RPT-02` Attention feed
24. `ACC-01` Accounting export bridge
25. `ACC-02` QuickBooks sync foundation

### Phase 6: UX, Quality, and Operational Readiness

26. `OPS-ORG-01` Organization management and RBAC console
27. `NAV-01` Search + quick jump
28. `UX-01` Mobile-first core action UX
29. `UX-02` Desktop deep-work UX
30. `UX-03` Theme system (light + dark)
31. `QA-02` Project timeline / activity center

### Phase 7: RBAC and Capability Enforcement

32. `RBAC-01` Org model cleanup, RoleTemplate with capability flags, system role presets
33. `RBAC-02` Backend capability-based enforcement across all views
34. `RBAC-03` Frontend capability wiring (`canDo` replaces `hasAnyRole`)

## Workflow IA Note

Frontend workflow is intentionally split into two stages:

1. `Projects` stage: project shell + scope control (`Estimates`, `Change Orders`).
2. `Billing` stage: post-approval financial execution (`Invoices`, `Vendor Bills`, payment/accounting flows).

This keeps scope decisions adjacent to projects, then moves operators into billing after scope is approved.

## Notes

- This file intentionally omits endpoint-by-endpoint details to prevent documentation drift.
- Keep detailed contracts in `docs/api.md` and feature-local maps.
