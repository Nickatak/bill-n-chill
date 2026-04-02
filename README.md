# bill-n-chill

Construction finance workflow app for small general contractors (1–10 person shops). Quotes, invoices, change orders, vendor bills, payments — all from the field or the office.

**Live:** [https://bill-n-chill.com](https://bill-n-chill.com)

## Stack

- **Backend:** Django + Django REST Framework, Python 3.12, MySQL 8.4
- **Frontend:** Next.js (App Router), React 19, TypeScript 5
- **Infra:** Docker Compose, GitHub Actions CI/CD
- **Auth:** Token-based with capability-driven RBAC (5 system roles, custom role support)

## Architecture Highlights

- **Mutable + immutable split** — operational records are editable; financially relevant changes append immutable audit snapshots/events for full traceability
- **Enforcement hierarchy** — DB constraints first, model-level guards second, serializer/view validation third
- **Atomic financial writes** — multi-write money operations wrapped in `transaction.atomic()`
- **Public tokenized routes** — customers approve/reject/dispute documents via signed public URLs with OTP verification
- **Domain-driven model layout** — models organized by business domain (`quoting/`, `accounts_receivable/`, `accounts_payable/`, `cash_management/`, `financial_auditing/`)
- **Capability-based RBAC** — granular per-resource, per-action permissions resolved from role templates with additive overrides
- **Mobile-first** — every flow works at 375px; PWA-ready for field use

## Local Setup

See [`docs/setup.md`](docs/setup.md) for full instructions. Quick start:

```bash
make docker-up        # Start full dev stack (backend + frontend + MySQL)
make db-seed          # Seed test accounts
```

## Documentation

| Doc | Purpose |
|-----|---------|
| [`setup.md`](docs/setup.md) | Local dev setup and run instructions |
| [`architecture.md`](docs/architecture.md) | System boundaries, runtime flows, enforcement layers |
| [`domain-model.md`](docs/domain-model.md) | Core entities, lifecycles, and modeling conventions |
| [`api.md`](docs/api.md) | Endpoint reference and API contracts |
| [`auth.md`](docs/auth.md) | Auth system, session management, RBAC deep-dive |
| [`contributing.md`](docs/contributing.md) | Code style, conventions, and review expectations |
| [`feature-list.md`](docs/feature-list.md) | Shipped feature inventory |
