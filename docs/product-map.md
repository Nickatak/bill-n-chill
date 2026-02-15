# Product Map: Beam vs Buildertrend vs Procore

## Purpose

Map the three reference products to understand overlap, identify their center of gravity, and define what a unified replacement must cover.

## Scope

- Focus: project execution + construction financial workflows.
- Audience: founder/product + engineering.
- Status: draft v1 for discovery.

## Capability Matrix

Legend:
- `Strong`: first-class and core to positioning
- `Medium`: present, but not central
- `Light`: basic or indirect coverage

| Capability | Beam | Buildertrend | Procore | Notes |
| --- | --- | --- | --- | --- |
| Estimating/proposals | Strong | Medium | Strong (preconstruction suite) | Beam highlights estimate-to-invoice flow; Buildertrend includes preconstruction tools. |
| Scheduling and task coordination | Medium | Strong | Strong | Buildertrend and Procore are heavier on schedule/control workflows. |
| Client portal and collaboration | Medium | Strong | Medium | Buildertrend strongly emphasizes homeowner/client collaboration. |
| Change orders and approvals | Strong | Strong | Strong | All three support change workflows; Procore adds deeper change-event controls. |
| Job costing and budget visibility | Strong | Strong | Strong | All three position cost/budget control as core outcomes. |
| Subcontract/commitment controls | Strong | Medium | Strong | Procore commitment model is a major financial control anchor. |
| AP bill intake and payment operations | Strong | Medium | Medium | Beam is strongly payment/AP workflow-led. |
| Owner billing/invoicing | Strong | Strong | Strong | Different workflow flavors by segment and project type. |
| ERP/accounting integrations | Strong (QuickBooks-focused) | Medium | Strong (broad ERP ecosystem) | Procore has broad ERP connector posture; Beam is deep on QuickBooks Online. |
| Enterprise governance/workflows | Light/Medium | Medium | Strong | Procore is strongest in controls and complex org workflows. |

## Positioning Snapshot

- Beam: finance and payment operations for contractors, with practical PM features.
- Buildertrend: all-in-one residential builder workflow with strong schedule + customer communication.
- Procore: enterprise-grade construction platform with deep project financial controls and integration surface.

## How They Commonly Fit Together

Observed market pattern:

1. Project system of record:
   - Buildertrend (residential) or Procore (commercial/enterprise).
2. Accounting/ERP system of record:
   - QuickBooks, Sage, Viewpoint, NetSuite, etc.
3. Optional financial acceleration layer:
   - Beam-like AP/payment/compliance workflow layered on top of accounting + project data.

Inference for bill-n-chill:
- bill-n-chill should behave like a modular platform with one shared data model, not a single giant feature release.

## Shared Workflow to Recreate

1. Preconstruction:
   - Estimate, proposal, contract baseline.
2. Budget setup:
   - Cost codes, schedule of values (SOV), commitments/subcontracts.
3. Execution:
   - Schedule progress, daily logs, field updates.
4. Change management:
   - Change event or change order, approval routing, budget updates.
5. Billing and payables:
   - Owner invoices, vendor/sub invoices, payment processing, retainage handling.
6. Accounting close loop:
   - Sync transactions and statuses with accounting system.

## Replacement Implications for bill-n-chill

- Required platform properties:
  - Single project-financial graph across estimates, budgets, commitments, invoices, payments.
  - Strong change management primitives so scope changes impact both schedule and money.
  - Role-aware portals for internal team, subs/vendors, and clients/owners.
  - Integration-first architecture for accounting and payroll/time tools.

- Practical v1 wedge:
  - Prioritize the money loop first:
    `Estimate -> Budget/SOV -> Change Orders -> Invoices -> Payments -> Accounting Sync`.

## Open Questions

1. Which initial ICP is primary:
   - Residential GC/remodeler, or commercial GC?
2. Which accounting destination is required on day 1:
   - QuickBooks Online only, or multi-ERP?
3. Which billing styles must launch first:
   - Progress billing, AIA-style, milestone, cost-plus?
4. What compliance depth is needed in v1:
   - Lien waivers only, or insurance + full document controls?

## References

- Beam homepage: https://www.trybeam.com/
- Beam invoicing: https://www.trybeam.com/invoicing
- Beam bill payment: https://www.trybeam.com/bill-payment
- Beam change orders: https://www.trybeam.com/change-order-management
- Beam QuickBooks integration: https://www.trybeam.com/quickbooks-integration
- Buildertrend homepage: https://buildertrend.com/
- Buildertrend project management: https://buildertrend.com/project-management/
- Buildertrend scheduling: https://buildertrend.com/project-management/schedule/
- Buildertrend financial tools: https://buildertrend.com/financial-tools/
- Buildertrend payment processing: https://buildertrend.com/payment-processing/
- Procore homepage: https://www.procore.com/
- Procore platform: https://www.procore.com/platform
- Procore financial management: https://www.procore.com/financial-management
- Procore commitments: https://www.procore.com/financial-management/commitments
- Procore project management: https://www.procore.com/project-management
- Procore GC financial management guide: https://support.procore.com/products/online/financial-management-user-guides/general-contractor-financial-management-user-guide
- Procore ERP integrations overview: https://support.procore.com/products/online/user-guide/company-level/erp-integrations
