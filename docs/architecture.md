# Architecture

## System Boundaries

- Backend (`backend/`): domain logic, persistence, API contracts, auth.
- Frontend (`frontend/`): routing, rendering, UI state, user interactions.

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
  - Default to light mode.
  - Persist user theme preference across sessions/devices when authenticated.

## API Strategy

- REST endpoints served by DRF under `/api/v1/`.
- JSON request/response contracts.
- Clear serializer-level validation and explicit error responses.

## Data & Persistence

- Use MySQL for local, dev, and prod-like environments.
- Local host workflows can run Django/Next.js directly while MySQL runs in Docker.

## Auth (Initial Direction)

- Start simple and secure.
- Choose one of:
  - Session auth (if mostly browser + same-site patterns)
  - Token/JWT auth (if API consumed by multiple consumer apps)

## Cross-Cutting Concerns

- Logging: structured logs where possible.
- Testing: backend API tests + frontend component/integration tests.
- Security: CORS, CSRF handling, secret management by environment.
- Versioning: keep API changes behind versioned routes.
- Frontend delivery: ensure responsive behavior and feature parity for core field actions on mobile.
- Accessibility: verify contrast/readability for both light and dark themes.
