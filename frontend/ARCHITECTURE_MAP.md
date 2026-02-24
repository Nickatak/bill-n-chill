# Frontend Architecture Map

## Purpose
This map defines how to trace behavior from route to feature code and how to compose new frontend work without collapsing state, API, and rendering into single files.

## Layer Rules
1. `src/app/**/page.tsx` routes are thin composition and navigation layers.
2. `src/features/<feature>/components/*` contain feature UI and local interaction behavior.
3. `src/features/<feature>/api.ts` contains feature endpoint calls only.
4. `src/features/<feature>/types.ts` contains transport and feature data shapes.
5. Backend policy-contract consumption belongs in feature-level contract adapters; do not hardcode workflow transitions in route files.
6. Shared session concerns stay in `src/features/session/*`.

## Route Shim Policy
1. Route files under `src/app/**/page.tsx` are URL shims only.
2. Allowed in route files: route-level layout framing, static copy, and feature entry mounting.
3. Disallowed in route files: domain mutations, endpoint orchestration, workflow validation, and cross-feature business state.
4. If route logic starts to branch by workflow conditions, move that logic into a feature console/controller.

## Controller API Policy
1. Feature parent components (`*Console`) should call one `use<Feature>Controller` hook.
2. Parent controllers should return one explicit typed API object (for example `QuickAddControllerApi`).
3. Domain behavior should be split into focused hook/helper modules (for example auth, validation, workflow) and composed in the parent controller.
4. Child components should be wired from the parent API object and remain render/event focused.

## Function Style Convention
1. Top-level exported hooks/helpers/components should prefer `function` declarations.
2. Local callbacks and closures inside hooks/components should prefer `const ... = (...) =>`.
3. Do not mix styles arbitrarily inside the same scope; choose the style that matches visibility and ownership.

## Route To Entry Map
| Route | Route File | Primary Entry |
| --- | --- | --- |
| `/` | `frontend/src/app/page.tsx` | `frontend/src/app/home-route-content.tsx` |
| `/register` | `frontend/src/app/register/page.tsx` | `frontend/src/features/session/components/home-register-console.tsx` |
| `/settings/intake` | `frontend/src/app/settings/intake/page.tsx` | `frontend/src/features/settings-intake/components/intake-settings-console.tsx` |
| `/projects` | `frontend/src/app/projects/page.tsx` | `frontend/src/features/projects/components/projects-console.tsx` |
| `/projects/[projectId]/activity` | `frontend/src/app/projects/[projectId]/activity/page.tsx` | `frontend/src/features/projects/components/project-activity-console.tsx` |
| `/projects/[projectId]/estimates` | `frontend/src/app/projects/[projectId]/estimates/page.tsx` | `frontend/src/features/estimates/components/estimates-console.tsx` |
| `/projects/[projectId]/change-orders` | `frontend/src/app/projects/[projectId]/change-orders/page.tsx` | `frontend/src/features/change-orders/components/change-orders-console.tsx` |
| `/projects/[projectId]/vendor-bills` | `frontend/src/app/projects/[projectId]/vendor-bills/page.tsx` | `frontend/src/features/vendor-bills/components/vendor-bills-console.tsx` |
| `/invoices` | `frontend/src/app/invoices/page.tsx` | `frontend/src/features/invoices/components/invoices-console.tsx` |
| `/vendors` | `frontend/src/app/vendors/page.tsx` | `frontend/src/features/vendors/components/vendors-console.tsx` |
| `/customers` | `frontend/src/app/customers/page.tsx` | `frontend/src/features/contacts/components/contacts-console.tsx` |
| `/cost-codes` | `frontend/src/app/cost-codes/page.tsx` | `frontend/src/features/cost-codes/components/cost-codes-console.tsx` |
| `/financials-auditing` | `frontend/src/app/financials-auditing/page.tsx` | `frontend/src/features/financials-auditing/components/financials-auditing-console.tsx` + `frontend/src/features/payments/components/payments-console.tsx` |
| `/intake/quick-add` | `frontend/src/app/intake/quick-add/page.tsx` | `frontend/src/features/intake/components/quick-add-console.tsx` |
| `/estimate/[publicRef]` | `frontend/src/app/estimate/[publicRef]/page.tsx` | `frontend/src/features/estimates/components/estimate-approval-preview.tsx` |

## Workflow Split (IA Decision)
Use this ordering for navigation and page ownership.

1. `Projects` is the operational hub for scope planning and control.
2. `Estimates` and `Change Orders` are project-scoped scope controls and belong with project workflow.
3. `Billing` comes after scope decisions and owns invoice/vendor-bill/payment execution.
4. Keep project-origin links to estimates/change-orders in project context; reserve top-level billing nav for post-approval financial flow.

## Workflow Contract Features
These features consume backend policy-contract endpoints for UI status options and transition behavior.

1. `change-orders` -> `GET /contracts/change-orders/`
2. `estimates` -> `GET /contracts/estimates/`
3. `vendor-bills` -> `GET /contracts/vendor-bills/`
4. `payments` -> `GET /contracts/payments/`

## Debug Trace Protocol
When debugging UI behavior, walk this path in order.

1. Start at route file in `src/app/**/page.tsx`.
2. Identify feature entry component from imports.
3. Open that feature's `FEATURE_MAP.md`.
4. Check policy-contract adapter behavior if issue is status/options/transitions.
5. Check API call and payload shape in `api.ts`.
6. Return to component state/actions only after confirming contract and API behavior.

## Feature Map Coverage
1. `frontend/src/features/change-orders/FEATURE_MAP.md`
2. `frontend/src/features/estimates/FEATURE_MAP.md`
3. `frontend/src/features/vendor-bills/FEATURE_MAP.md`
4. `frontend/src/features/payments/FEATURE_MAP.md`
5. `frontend/src/features/budgets/FEATURE_MAP.md`
6. `frontend/src/features/contacts/FEATURE_MAP.md`
7. `frontend/src/features/cost-codes/FEATURE_MAP.md`
8. `frontend/src/features/financials-auditing/FEATURE_MAP.md`
9. `frontend/src/features/intake/FEATURE_MAP.md`
10. `frontend/src/features/invoices/FEATURE_MAP.md`
11. `frontend/src/features/projects/FEATURE_MAP.md`
12. `frontend/src/features/session/FEATURE_MAP.md`
13. `frontend/src/features/settings-intake/FEATURE_MAP.md`
14. `frontend/src/features/vendors/FEATURE_MAP.md`
15. Template: `frontend/src/features/FEATURE_MAP_TEMPLATE.md`
