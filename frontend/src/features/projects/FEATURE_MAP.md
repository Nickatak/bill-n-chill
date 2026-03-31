# Feature Map: Projects

## Purpose
Provide project-shell management, project-level financial snapshot visibility, and cross-domain activity timeline access.

## Route Surface
1. `/projects`
2. `/projects/[projectId]/activity`

## Mutation Map
1. `Project`
   - update project profile/status (`PATCH /projects/{id}/`)
2. `ProjectAccountingExportArtifact`
   - generate/download export (`GET /projects/{id}/accounting-export/?export_format=csv`)
3. `ProjectTimelineView`
   - update category-scoped timeline selection (`GET /projects/{id}/timeline/?category={all|financial|workflow}`)

## Composition and Entry Flow
1. Entry sources:
   - direct route entry: `frontend/src/app/projects/page.tsx` renders `ProjectsConsole`
   - direct route entry: `frontend/src/app/projects/[projectId]/activity/page.tsx` renders `ProjectActivityConsole`
   - feature export entry: `frontend/src/features/projects/index.ts` exports `ProjectsConsole`
2. Parent/Owner:
   `ProjectsConsole` owns list/profile/summary actions; `ProjectActivityConsole` owns timeline rendering.
3. Controller/Hook:
   console-level state/effects manage projects fetch, selection, filters, pagination, profile drafts, and timeline category.
4. Children:
   project list/profile editor, summary cards, activity timeline panels.
5. Default behavior:
   load projects -> select target -> hydrate summary/profile/timeline context.
6. Overrides:
   filter/search and timeline-category changes trigger scoped refetch/recompute behavior.
7. Relationship flow:
   route mount -> projects fetch -> selection/filter action -> endpoint read/mutation -> UI refresh.

## API Surface Used
1. `GET /projects/`:
   loads project rows and base shell metadata.
2. `PATCH /projects/{id}/`:
   updates selected project profile/status fields.
3. `GET /projects/{id}/financial-summary/`:
   loads selected project financial snapshot.
4. `GET /projects/{id}/quotes/`:
   loads quote counts/context for selected project.
5. `GET /projects/{id}/accounting-export/?export_format=csv`:
   requests project accounting export artifact.
6. `GET /projects/{id}/timeline/?category={all|financial|workflow}`:
   loads category-scoped activity timeline.

## Backend Contracts Used
- Contract endpoint(s): none
- Consumed fields: none
- Behavior source: standard API responses with inline project status-transition policy in frontend
- Fallback policy: n/a (no contract adapter in this feature)

## State Model (Remote, Local, Derived)
- State buckets:
  - Remote Data:
    - projects
    - selected-project financial summary
    - selected-project quote context
    - timeline datasets
  - Local UI State:
    - selected project
    - search/filter/pagination
    - project profile form state
    - timeline category
  - Derived State:
    - allowed project status transitions
    - status-filtered project lists
    - summary counters

## Error and Empty States
- Error states:
  - missing shared session token
  - save/export/summary/timeline endpoint failures
- Empty states:
  - no projects in scope
  - filtered/search result has no project matches

## Test Anchors
- Existing anchors:
  - backend tests in `backend/core/tests/test_projects.py`
  - backend tests in `backend/core/tests/test_project_activity.py`
- TODO:
  - add frontend tests for status-filter pagination behavior
  - add frontend tests for timeline category loading and fallback selection
