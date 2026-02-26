# Feature Map: Financials Auditing

## Purpose
Centralize financial reporting, one-screen immutable chronological audit working-tree graph/history, accounting export, and sync-event operations.

## Route Surface
1. `/financials-auditing`

## Mutation Map
1. `AccountingSyncEvent`
   - create sync event (`POST /projects/{id}/accounting-sync-events/`)
   - retry failed sync event (`POST /accounting-sync-events/{id}/retry/`)
2. `AccountingExportArtifact`
   - generate/download project export (`GET /projects/{id}/accounting-export/?export_format=csv`)
3. `ReportDatasets`
   - refresh portfolio/change-impact/attention-feed views (`GET /reports/portfolio/`, `GET /reports/change-impact/`, `GET /reports/attention-feed/`)
4. `AuditTrailExport`
   - download full audit trail as JSON/CSV from loaded project audit events.

## Composition and Entry Flow
1. Entry sources:
   - direct route entry: `frontend/src/app/financials-auditing/page.tsx` renders `FinancialsAuditingConsole`
   - feature export entry: `frontend/src/features/financials-auditing/index.ts` exports `FinancialsAuditingConsole`
2. Parent/Owner:
   `FinancialsAuditingConsole` owns project selection, reporting fetches, and sync-event actions.
3. Controller/Hook:
   console-level state/effects handle selected project, report filters, and sync create/retry sequencing.
4. Children:
   project selector, FIN-01 summary panel, one-screen chronological audit graph (project main branch + per-object child branches), sync-event controls, report widgets.
5. Default behavior:
   selecting a project auto-loads immutable audit events and re-renders the graph with chronological left-to-right branch lanes.
6. Overrides:
   sync create/retry and report date-filter changes trigger targeted data refresh.
7. Relationship flow:
   route mount -> console selects project/filter -> API fetches/mutations -> console recalculates and re-renders report/event panels.

## API Surface Used
1. `GET /projects/`:
   lists available projects for report/event scoping.
2. `GET /projects/{id}/financial-summary/`:
   hydrates project-level financial summary panel.
3. `GET /projects/{id}/audit-events/`:
   loads immutable project audit timeline; optional `object_type` query params apply OR-filtering server-side.
4. `GET /projects/{id}/accounting-sync-events/`:
   loads sync-event history and retry candidates.
5. `POST /projects/{id}/accounting-sync-events/`:
   records a new sync attempt event.
6. `POST /accounting-sync-events/{id}/retry/`:
   retries a failed sync event.
7. `GET /projects/{id}/accounting-export/?export_format=csv`:
   requests CSV export artifact for download.
8. `GET /reports/portfolio/`:
   loads portfolio-level report dataset.
9. `GET /reports/change-impact/`:
   loads change-impact report dataset.
10. `GET /reports/attention-feed/`:
   loads attention-feed report dataset.

## Backend Contracts Used
- Contract endpoint(s): none
- Consumed fields: none
- Behavior source: standard API responses from reporting, export, and sync-event endpoints
- Fallback policy: n/a (no contract adapter in this feature)

## State Model (Remote, Local, Derived)
- State buckets:
  - Remote Data:
    - project list
    - selected project financial summary
    - audit events
    - sync events
    - report datasets
  - Local UI State:
    - selected project
    - audit object/event filters
    - selected audit event node (graph inspector)
    - sync-event form fields
    - retry target
    - report date filters
    - status messages
  - Derived State:
    - failed-sync retry candidates
    - rendered table/chart rows

## Error and Empty States
- Error states:
  - sync create/retry validation failures
  - export endpoint failures
  - report endpoint failures
- Empty states:
  - no project selected
  - no audit events for selected project
  - no audit events matching selected filters
  - no sync events for selected project
  - no rows for selected report filters

## Test Anchors
- Existing anchors:
  - backend tests in `backend/core/tests/test_project_reporting.py`
  - backend tests in `backend/core/tests/test_accounting_sync.py`
- TODO:
  - add frontend tests for sync create/retry flow state transitions
  - add frontend tests for report filter fetch/render behavior
