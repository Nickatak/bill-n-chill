# Testing

Bill n' Chill uses three test layers: backend unit/integration tests (Django TestCase), frontend unit tests (Vitest + React Testing Library), and end-to-end tests (Playwright). Each layer has a distinct purpose and trade-offs.

## Test layers at a glance

| Layer | Tool | Count | Runs against | What it verifies |
|-------|------|-------|-------------|-----------------|
| Backend | Django TestCase | ~605 | Test DB (in-process) | Model constraints, view contracts, RBAC, status transitions, financial math |
| Frontend | Vitest + RTL | ~61 files | jsdom (mocked API) | Component rendering, hook logic, formatting, validation, RBAC gating |
| E2E | Playwright | 49 | Full Docker stack | Real user flows across browser, frontend, backend, and database |

## Backend tests

Location: `backend/core/tests/`

29 test files covering all domain areas: auth, customers, projects, quotes, invoices, change orders, vendor bills, payments, RBAC, invites, push notifications, public signing, reporting, and more.

### Running

```bash
# Via Docker (recommended - matches CI)
make docker-shell-backend
python manage.py test core

# On host (requires .venv and local DB)
make local-test-backend
```

### Conventions

- Each test file uses `_bootstrap_org(user)` from `core/tests/common.py` for org setup.
- Tests hit a real (test) database - no mocking of the ORM.
- Financial tests assert exact decimal values, not floats.
- RBAC tests verify both allowed and denied capability gates.

## Frontend tests

Location: `frontend/src/**/__tests__/`

61 test files covering component rendering, hook behavior, utility functions, session management, and RBAC permission gating.

### Running

```bash
# Lint + type check (runs in CI)
make local-test-frontend

# Unit tests directly
cd frontend && npm test
```

### Conventions

- Console component tests mock the session hook and API calls.
- Utility tests (formatting, validation, date math) are pure function tests.
- RBAC tests verify capability-gated UI elements render/hide correctly.

## E2E tests

Location: `e2e/`

49 tests across 5 spec files, running against the full Docker Compose stack (frontend + backend + database + Mailpit).

### Architecture

```
e2e/
  helpers/
    auth.ts       # Register + verify + login via API, localStorage injection
    api.ts        # Authenticated API calls for test data setup
    mailpit.ts    # Email retrieval and token extraction
  tests/
    auth/         # Login, registration, email verification (5 tests)
    customers/    # Quick-add, editor, archive, search, filters, accordion (15 tests)
    projects/     # List, editor, status transitions, pipeline, metrics (13 tests)
    organization/ # Business profile, doc settings, team/invites, notifications (16 tests)
  playwright.config.ts
```

### How it works

Each spec file creates a fresh user account in `beforeAll` via the API (register, verify through Mailpit, login). The auth token is injected into the browser's `localStorage` before each test navigates, so tests skip the login UI and go straight to the page under test.

Test data (customers, projects, etc.) is created via API helpers in `beforeAll` or within individual tests, keeping setup fast and tests focused on UI behavior.

### Running

The full Docker stack must be running first:

```bash
# Start the stack
make docker-up

# Install Playwright (first time only)
make e2e-install

# Run all e2e tests
make e2e-test

# Run headed (visible browser)
make e2e-test-headed

# Run a single spec file
cd e2e && npx playwright test customers/customers.spec.ts

# Open the HTML report from the last run
make e2e-report
```

### Configuration

- **Browser:** Chromium only (sufficient for dev-stage coverage).
- **Base URL:** `http://localhost:3000` (frontend), `http://localhost:8000` (backend API).
- **Parallelism:** 4 workers by default. If the async email worker is cold after a stack restart, use `--workers=1` or `--workers=2` to avoid email queue saturation.
- **Retries:** 0 locally, 2 in CI.
- **Timeout:** 30s per test.
- **Screenshots:** On failure only.
- **Traces:** On first retry.

### Coverage map

| Page | Spec file | Flows |
|------|-----------|-------|
| Auth (login, register) | `auth/login.spec.ts`, `auth/register.spec.ts` | Login (verified, wrong password, unverified), registration + email verification, short password validation |
| Customers | `customers/customers.spec.ts` | Quick-add (customer only, customer+project, validation, duplicates), editor (edit fields, archive, archive blocked), browse (search, activity filter, project filter), accordion (expand, status chips), project creation, URL deep-linking |
| Projects | `projects/projects.spec.ts` | List (display, search, status filters), editor (name, status transition, terminal hints), financial metrics, workflow pipeline links, URL deep-linking, customer scoping, payment button state |
| Organization | `organization/organization.spec.ts` | Business tab (company name, contact, address, license/tax, save-disabled), Docs tab (quote/invoice/CO settings, sub-tab switching), Team tab (self-edit blocked, invite creation, revoke, duplicate rejection), Notifications tab, tab navigation |

### Writing new e2e tests

1. **Create a spec file** in `e2e/tests/<page>/`. Use the shared helpers:
   - `registerAndLogin()` - creates a fresh user via API + Mailpit verification.
   - `loginAndNavigate(page, session, path)` - injects session into localStorage and navigates.
   - API helpers in `api.ts` for creating test data (customers, projects, etc.).

2. **Scope selectors carefully.** The most common failure pattern is Playwright's strict mode violation (a selector matching multiple elements). Prefer:
   - `getByRole("dialog", { name: "..." })` for modal-scoped interactions.
   - `page.locator("button[class*=specificClass]").filter({ hasText: "..." })` over bare `getByText()`.
   - `{ exact: true }` when a label or text appears as a substring elsewhere.

3. **Avoid depending on data from other tests.** Each test gets a fresh browser page. Shared data should be created in `beforeAll` via API helpers, not assumed from prior test execution.

4. **Keep tests behavioral.** Test what a user does and sees, not implementation details. A test that clicks, fills, submits, and asserts a result is more durable than one that checks CSS classes or internal state.

## CI integration

CI runs backend tests + frontend lint + type check on every push. E2E tests are not yet in CI (they require the full Docker stack with Mailpit). Adding CI e2e is tracked as future work.

## Make targets

```
make local-test              # Backend tests + frontend lint + type check
make local-test-backend      # Backend tests only
make local-test-frontend     # Frontend lint + type check only
make e2e-install             # Install Playwright + Chromium
make e2e-test                # Run all e2e tests
make e2e-test-headed         # Run e2e tests in headed browser
make e2e-report              # Open Playwright HTML report
```
