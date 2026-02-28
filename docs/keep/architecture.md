# Architecture

Last reviewed: 2026-02-28

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
- [Auth](#auth)
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
  - `backend/core/views/estimating`: estimate + budget workflows.
  - `backend/core/views/change_orders`: change-order lifecycle and public decision flows.
  - `backend/core/views/accounts_receivable`: invoice workflows and public decision flows.
  - `backend/core/views/accounts_payable`: vendor-bill workflows.
  - `backend/core/views/cash_management`: payments + allocations.
  - `backend/core/views/helpers.py`: shared role guardrails, organization scope helpers, and write-path utilities.
- Domain models:
  - `backend/core/models/shared_operations`: org, membership, customer, project, cost code, vendor, sync-event operational rows.
  - `backend/core/models/estimating`: estimates, lines, budgets, budget lines, estimate status events.
  - `backend/core/models/change_orders`: change orders, change-order lines.
  - `backend/core/models/accounts_receivable`: invoices, invoice lines, invoice status events.
  - `backend/core/models/accounts_payable`: vendor bills and related AP state.
  - `backend/core/models/cash_management`: payments and payment allocations.
  - `backend/core/models/financial_auditing`: immutable records/snapshots and canonical traceability identity (`ScopeItem`).
- Policy/contract and support layers:
  - `backend/core/policies`: workflow contract payloads consumed by frontend.
  - `backend/core/serializers`: API validation and response shaping.
  - `backend/core/utils`: shared utility helpers.
  - `backend/core/tests`: endpoint + workflow regression coverage.

### Frontend Shape

- Route layer:
  - `frontend/src/app/*`: Next.js App Router pages, route shells, auth-gated entry, and public-document routes.
- Feature layer:
  - `frontend/src/features/*`: workflow-domain UI modules (intake, estimates, change orders, invoices, bills, payments, etc.).
  - Each feature owns local components, state orchestration, and API interaction hooks/helpers.
- Shared layer:
  - `frontend/src/shared/components`: cross-feature UI primitives.
  - `frontend/src/shared/document-composer`: shared authoring patterns for financial docs.
  - `frontend/src/shared/document-viewer`: shared read/public preview rendering patterns.
- Session/navigation shell:
  - `frontend/src/features/session/*`: token/session management and auth bootstrap checks.
  - `frontend/src/app/workflow-*` + `theme-toggle.tsx`: global nav, breadcrumbs, and shell controls.

### Key Runtime Flows

- Auth + org bootstrap:
  - login/register -> token -> `auth/me` -> active org + membership context.
- Estimate lifecycle:
  - draft/sent/approved/rejected/void -> approved conversion path to active budget.
- Change-order propagation:
  - `pending_approval -> approved|rejected` with contract/budget aggregate updates on approved transitions.
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
- Mobile-first focus:
  - Fast capture and updates in the field.
  - Low-friction forms and minimal required input.
- Desktop focus:
  - Detailed creation and review workflows.
  - Dense tables, filtering, and multi-step financial operations.
- Design rule:
  - Optimize mobile for short execution tasks.
  - Optimize desktop for high-context editing and analysis.
- Theme rule:
  - Provide both light and dark mode.
  - Default to dark mode for current MVP demos.
  - Persist user theme preference across sessions/devices when authenticated.

## API Strategy

- REST endpoints served by DRF under `/api/v1/`.
- JSON request/response contracts.
- Clear serializer-level validation and explicit error responses.

## Data and Persistence

- Use MySQL for local, dev, and prod-like environments.
- Local host workflows can run Django/Next.js directly while MySQL runs in Docker.

## Auth

- Current implementation uses DRF token authentication for API access.
- Frontend stores and reuses the token for authenticated API requests.

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
