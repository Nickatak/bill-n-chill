# Change Orders Call Chains

> **Line anchors are pinned manually.** Update after refactors that move function definitions.

End-to-end function call order for CO page initialization and the line-item local ID race condition that was discovered and fixed in March 2026.

## Key Source Files

| Layer | File | Purpose |
|-------|------|---------|
| Frontend | [`change-orders-console.tsx`](../../frontend/src/features/change-orders/components/change-orders-console.tsx) | Full CO page: create, edit, status transitions, line items |
| Frontend | [`helpers.ts`](../../frontend/src/features/change-orders/helpers.ts) | `emptyLine()`, validation, display helpers |

## Page Initialization (No Existing COs)

This traces the load sequence when a project has one approved quote and zero change orders — the exact scenario that triggered the duplicate-key race.

`FRONTEND` — [`ChangeOrdersConsole`](../../frontend/src/features/change-orders/components/change-orders-console.tsx#L56)

*── initial state ──*

- [`newLineNextLocalId = 2`](../../frontend/src/features/change-orders/components/change-orders-console.tsx#L139) — create form counter
- [`editLineNextLocalId = 2`](../../frontend/src/features/change-orders/components/change-orders-console.tsx#L140) — edit form counter
- `newLineItems = [emptyLine(1)]`

*── mount effect ──*

- [`useEffect → loadProjects()`](../../frontend/src/features/change-orders/components/change-orders-console.tsx#L1102)
  - [`loadProjects`](../../frontend/src/features/change-orders/components/change-orders-console.tsx#L1019)
    - `setNewLineItems([emptyLine(1)])`, `setNewLineNextLocalId(2)` — reset create form
    - `setSelectedProjectId(...)`, `setSelectedProjectName(...)`
    - `await Promise.all([`
      - [`loadProjectQuotes(projectId)`](../../frontend/src/features/change-orders/components/change-orders-console.tsx#L835) — **sets `selectedViewerQuoteId`**
      - `loadProjectAuditEvents(projectId)`
    - `])`
    - [`fetchProjectChangeOrders(projectId)`](../../frontend/src/features/change-orders/components/change-orders-console.tsx#L978) — returns `[]` (no COs)
    - [`hydrateEditForm(undefined)`](../../frontend/src/features/change-orders/components/change-orders-console.tsx#L712)
      - `setEditLineItems([emptyLine(1)])`
      - `setEditLineNextLocalId(2)` — resets **edit** counter only

*── user interaction ──*

- User clicks **Add Line Item**
  - [`addLine(setNewLineItems, newLineNextLocalId, setNewLineNextLocalId)`](../../frontend/src/features/change-orders/components/change-orders-console.tsx#L1193)
    - Reads `newLineNextLocalId`
    - Appends `emptyLine(newLineNextLocalId)` — all unique

## The Race Condition (Pre-Fix, Historical)

Before the fix, `nextLineLocalId` was a **single shared counter** used by both the create and edit forms. Concurrent async effects (line prefill and CO fetch) could clobber each other's counter values, producing duplicate React keys (`localId: 2` on both a prefilled row and the new row), causing:
- React console error: `Encountered two children with the same key`
- Synced/mirrored input fields (React reuses DOM for same-key siblings)
- Validation errors on wrong rows

## The Fix

Split the shared counter into two independent counters:

| Counter | Used by | Set by |
|---------|---------|--------|
| `newLineNextLocalId` | Create form `addLine` | `loadProjects` reset, `handleStartNewChangeOrder`, post-create cleanup |
| `editLineNextLocalId` | Edit form `addLine` | `hydrateEditForm` (both undefined and populated branches) |

`hydrateEditForm(undefined)` now only touches `editLineNextLocalId`, so it can never clobber the create form's counter regardless of fetch resolution order.
