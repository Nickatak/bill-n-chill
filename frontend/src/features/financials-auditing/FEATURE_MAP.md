# Feature Map: Financials Auditing

## Purpose
Audit trail export and accounting sync-event operations for a selected project. Lives on the `/financials-auditing` page alongside the Payments console.

## Route Surface
1. `/financials-auditing`

## Mutation Map
1. `AccountingSyncEvent`
   - create sync event (`POST /projects/{id}/accounting-sync-events/`)
   - retry failed sync event (`POST /accounting-sync-events/{id}/retry/`)
2. `AccountingExportArtifact`
   - generate/download project export (`GET /projects/{id}/accounting-export/?export_format=csv`)
3. `AuditTrailExport`
   - download full audit trail as JSON/CSV from loaded project audit events.

## Composition and Entry Flow
1. Entry sources:
   - direct route entry: `frontend/src/app/financials-auditing/page.tsx` renders `FinancialsAuditingConsole`
   - feature export entry: `frontend/src/features/financials-auditing/index.ts` exports `FinancialsAuditingConsole`
2. Parent/Owner:
   `FinancialsAuditingConsole` owns project selection, audit trail export, and sync-event actions.
3. Controller/Hook:
   console-level state/effects handle selected project, audit event loading, and sync create/retry sequencing.
4. Children:
   project selector, audit trail export controls (JSON/CSV download), accounting export download, sync-event CRUD controls.
5. Default behavior:
   selecting a project auto-loads audit events and sync events for that project.
6. Overrides:
   sync create/retry triggers targeted data refresh.
7. Relationship flow:
   route mount -> console selects project -> API fetches/mutations -> console renders audit export controls and sync-event panels.

## API Surface Used
1. `GET /projects/`:
   lists available projects for scoping.
2. `GET /projects/{id}/audit-events/`:
   loads immutable project audit timeline for export.
3. `GET /projects/{id}/accounting-sync-events/`:
   loads sync-event history and retry candidates.
4. `POST /projects/{id}/accounting-sync-events/`:
   records a new sync attempt event.
5. `POST /accounting-sync-events/{id}/retry/`:
   retries a failed sync event.
6. `GET /projects/{id}/accounting-export/?export_format=csv`:
   requests CSV export artifact for download.

## Backend Contracts Used
- Contract endpoint(s): none
- Consumed fields: none
- Behavior source: standard API responses from export and sync-event endpoints
- Fallback policy: n/a (no contract adapter in this feature)

## State Model (Remote, Local, Derived)
- State buckets:
  - Remote Data:
    - project list
    - audit events
    - sync events
  - Local UI State:
    - selected project
    - sync-event form fields
    - retry target
    - status messages
  - Derived State:
    - failed-sync retry candidates

## Error and Empty States
- Error states:
  - sync create/retry validation failures
  - export endpoint failures
- Empty states:
  - no project selected
  - no audit events for selected project
  - no sync events for selected project

## Test Anchors
- Existing anchors:
  - backend tests in `backend/core/tests/test_accounting_sync.py`
- TODO:
  - add frontend tests for sync create/retry flow state transitions
