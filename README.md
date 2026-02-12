# Buildr

`Buildr` is an exploratory full-stack project using:

- Backend: Django + Django REST Framework (DRF)
- Frontend: Next.js

## Project Goals

- Build a clean API-first backend with DRF.
- Build a fast, modern frontend with Next.js.
- Keep backend and frontend loosely coupled for independent iteration.
- Establish a structure that supports local development first, then production deployment.

## Architecture (High Level)

- `backend` handles business logic, authentication, persistence, and API endpoints.
- `frontend` handles UI rendering, routing, and API consumption.
- Frontend communicates with backend over JSON HTTP APIs.

```text
Next.js App  <----HTTP/JSON---->  Django/DRF API  <---->  Database
```

## Suggested Repository Layout

```text
buildr/
  backend/         # Django project + DRF apps
  frontend/        # Next.js app
  docs/            # Additional project documentation
  README.md
```

## Backend Plan (Django + DRF)

- Initialize Django project in `backend/`.
- Add DRF and core dependencies.
- Set up app modules by domain (example: `users`, `projects`, `tasks`).
- Add API versioning (`/api/v1/...`).
- Configure auth strategy (session + token/JWT, depending on product needs).
- Add `pytest` or Django test suite from day one.

## Frontend Plan (Next.js)

- Initialize Next.js app in `frontend/`.
- Use `app/` router.
- Add API client layer (`lib/api.ts`) to centralize backend calls.
- Organize UI by feature/domain where possible.
- Add linting and formatting early.

## Local Development Strategy

- Run backend and frontend independently during development.
- Use environment variables for API base URLs and secrets.
- Enable CORS in Django for local frontend origin.
- Start with SQLite for speed; migrate to Postgres when data model stabilizes.

## Recommended First Milestones

1. Scaffold both apps (`backend/` and `frontend/`).
2. Add health endpoint in DRF (`GET /api/v1/health/`).
3. Render a Next.js home page that calls and displays health status.
4. Add container/dev scripts once the first end-to-end request works.

## Documentation Roadmap

- `docs/setup.md`: local setup instructions.
- `docs/architecture.md`: detailed system boundaries and conventions.
- `docs/api.md`: endpoint reference and API standards.
- `docs/contributing.md`: workflow, branching, testing, and code style.
- `docs/product-map.md`: Beam/Buildertrend/Procore capability comparison and replacement implications.
- `docs/mvp-v1.md`: initial MVP scope, acceptance criteria, and phased delivery.
- `docs/domain-model.md`: core entities, lifecycles, and API direction for construction billing workflows.
- `docs/gc-pm-use-case.md`: step-by-step GC/PM scenario with required features, device posture, and edge conditions.
- `docs/feature-list.md`: complete ordered feature backlog with dependencies and acceptance checks.

## Notes

This file is intentionally lightweight and practical. As implementation begins, move decisions from "plan" to concrete docs in `docs/`.
