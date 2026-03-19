# Architecture

Last reviewed: 2026-03-04

## Table of Contents

- [Architecture Snapshot](#architecture-snapshot)
- [System Boundaries](#system-boundaries)
- [Application Shape](#application-shape)
  - [Backend Shape](#backend-shape)
  - [Frontend Shape](#frontend-shape)
  - [Key Runtime Flows](#key-runtime-flows)
  - [Invariant Enforcement Layers](#invariant-enforcement-layers)
- [Runtime and Deployment](#runtime-and-deployment)
- [UX Channel Strategy](#ux-channel-strategy)
- [API Strategy](#api-strategy)
- [Data and Persistence](#data-and-persistence)
- [Auth and RBAC](#auth-and-rbac)
- [Cross-Cutting Concerns](#cross-cutting-concerns)
- [Reference Docs](#reference-docs)

## Architecture Snapshot

```text
Next.js App (frontend/) <---- HTTP JSON ----> Django/DRF API (backend/) <----> MySQL
```

## System Boundaries

- Backend (`backend/`): domain logic, persistence, API contracts, auth.
- Frontend (`frontend/`): routing, rendering, UI state, user interactions.

## Application Shape

### Backend Shape

- API entrypoint:
  - `backend/core/urls.py`: route map under `/api/v1/`.
- Endpoint implementation:
  - `backend/core/views/shared_operations`: auth/org/customers/projects/cost-codes/vendors/report/search surfaces.
  - `backend/core/views/estimating`: estimate workflows.
  - `backend/core/views/change_orders`: change-order lifecycle and public decision flows.
  - `backend/core/views/accounts_receivable`: invoice workflows and public decision flows.
  - `backend/core/views/accounts_payable`: vendor-bill workflows.
  - `backend/core/views/cash_management`: payments + allocations.
  - `backend/core/views/helpers.py`: capability-based RBAC enforcement (`_capability_gate`, `_resolve_user_capabilities`), organization scope helpers, and write-path utilities.
- Domain models:
  - `backend/core/models/shared_operations`: org, membership, role template, customer, project, cost code, vendor, sync-event operational rows.
  - `backend/core/models/estimating`: estimates, estimate lines, estimate status events.
  - `backend/core/models/change_orders`: change orders, change-order lines.
  - `backend/core/models/accounts_receivable`: invoices, invoice lines, invoice status events.
  - `backend/core/models/accounts_payable`: vendor bills and related AP state.
  - `backend/core/models/cash_management`: payments and payment allocations.
  - `backend/core/models/financial_auditing`: immutable records/snapshots for audit traceability.
- Policy/contract and support layers:
  - `backend/core/policies`: workflow contract payloads consumed by frontend.
  - `backend/core/serializers`: API validation and response shaping.
  - `backend/core/utils`: shared utility helpers.
  - `backend/core/tests`: endpoint + workflow regression coverage.

### Frontend Shape

- Route layer:
  - `frontend/src/app/*`: Next.js App Router pages and route-specific content.
- Feature layer:
  - `frontend/src/features/*`: workflow-domain UI modules (customers, estimates, change orders, invoices, bills, payments, etc.).
  - Each feature owns local components, state orchestration, and API interaction hooks/helpers.
- Shared layer:
  - `frontend/src/shared/shell`: app shell — auth gate, toolbar, navbar, breadcrumbs, page layout wrappers, route metadata helpers. All styles are CSS modules.
  - `frontend/src/shared/components`: cross-feature UI primitives.
  - `frontend/src/shared/document-creator`: shared authoring patterns for financial docs.
  - `frontend/src/shared/document-viewer`: shared read/public preview rendering patterns.
- Session and RBAC:
  - `frontend/src/features/session/*`: token/session management, auth bootstrap checks, and capability-based UI gating (`rbac.ts`: `canDo`, `hasAnyRole`).

### Key Runtime Flows

- Auth + org bootstrap:
  - login/register -> token -> `auth/me` -> active org + membership context.
- Estimate lifecycle:
  - draft/sent/approved/rejected/void -> approved estimate sets project contract value.
- Change-order propagation:
  - `pending_approval -> approved|rejected` with contract value updates on approved transitions.
- Invoice + payment loop:
  - invoice send/status lifecycle -> inbound/outbound payment recording -> allocation updates balance/status.
- Public customer decisions:
  - tokenized public estimate/change-order/invoice routes with state-gated approve/reject/dispute endpoints.

### Invariant Enforcement Layers

- Data integrity first:
  - DB constraints/indexes for hard invariants where possible.
- Domain lifecycle second:
  - model-level transition guards and consistency checks.
- API contract third:
  - serializer/view validation for payload quality, UX-friendly errors, and endpoint policy.
- RBAC enforcement:
  - capability-based gates on all write endpoints (`_capability_gate`).
- Financial write safety:
  - multi-write money operations execute in atomic transactions.
- Audit posture:
  - financially relevant state/amount changes append immutable capture records.

## Runtime and Deployment

- Local development: run full stack via Docker Compose, or run frontend/backend on host with Docker MySQL.
- Deployment posture: this repo is a base app consumed by host orchestration with environment-specific compose overrides.
- Stable compose service identities: `frontend`, `backend`, `db`.

## UX Channel Strategy

- bill-n-chill serves both field and office workflows with one shared backend/API.
- **Every flow must work on mobile.** No flow is desktop-only. The ICP (1–10 person GC) works from the job site or the truck — there is no "office workflow." See `docs/decisions/pwa-mobile-strategy.md` for full rationale.
- Mobile delivery: Progressive Web App (Add to Home Screen). Same codebase, no native build.
- Desktop gets dense tables, inline editing, and power-user density — responsive doesn't mean dumbed-down.
- CSS uses desktop-first styles with `max-width` overrides at three breakpoints:
  - **900px** — tablet / narrow desktop (layout shifts: two-col → single-col, side panels collapse)
  - **700px** — mobile (major layout changes, nav transforms, padding reduction)
  - **640px** — small mobile (font sizes, compact forms, fine-tuning for narrow phones)
- Not every page needs all three tiers. Use the tiers that make sense for the content.
- Theme rule:
  - Both light and dark modes supported via theme toggle.
  - Public-facing pages force light mode; internal pages support both.

## API Strategy

- REST endpoints served by DRF under `/api/v1/`.
- JSON request/response contracts.
- Clear serializer-level validation and explicit error responses.

## Data and Persistence

- Use MySQL for local, dev, and prod-like environments.
- Local host workflows can run Django/Next.js directly while MySQL runs in Docker.

## Auth and RBAC

- Current implementation uses DRF token authentication for API access.
- Frontend stores and reuses the token for authenticated API requests.
- RBAC enforcement:
  - Backend: `_capability_gate(user, resource, action)` resolves capabilities from `RoleTemplate.capability_flags_json` and checks per-action access. All write endpoints use capability gates.
  - Frontend: `canDo(capabilities, resource, action)` gates mutation UI (create forms, submit buttons, status controls). Capabilities are stored in session from auth responses and refreshed on `/auth/me/` verification.
  - Five system roles (owner, pm, worker, bookkeeping, viewer) with preset capability matrices. Custom roles supported via org-local `RoleTemplate` (not yet exposed in UI).

## Cross-Cutting Concerns

- Logging: structured logs where possible.
- Testing: backend API tests + frontend component/integration tests.
- Security: CORS, CSRF handling, secret management by environment.
- Versioning: keep API changes behind versioned routes.
- Frontend delivery: ensure responsive behavior and feature parity for core field actions on mobile.
- Accessibility: verify contrast/readability for both light and dark themes.

## Reference Docs

- `docs/api.md`: endpoint contracts and request/response behavior.
- `docs/domain-model.md`: entity lifecycle and modeling language.
- `docs/setup.md`: local run/setup/reset workflows.
- `docs/orchestration.md`: compose contract for host orchestration.
