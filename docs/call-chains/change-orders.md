# Change Orders Call Chains

> **Line anchors are pinned manually.** Update after refactors that move function definitions.

End-to-end function call order for CO page initialization and the line-item local ID race condition that was discovered and fixed in March 2026.

## Key Source Files

| Layer | File | Purpose |
|-------|------|---------|
| Frontend | [`change-orders-console.tsx`](../../frontend/src/features/change-orders/components/change-orders-console.tsx) | Full CO page: create, edit, status transitions, line items |
| Frontend | [`helpers.ts`](../../frontend/src/features/change-orders/helpers.ts) | `emptyLine()`, validation, display helpers |

## Page Initialization (No Existing COs)

This traces the load sequence when a project has one approved estimate and zero change orders — the exact scenario that triggered the duplicate-key race.

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
      - [`loadBudgetLines(projectId)`](../../frontend/src/features/change-orders/components/change-orders-console.tsx#L791) — sets `budgetLines` (no prefill)
      - [`loadProjectEstimates(projectId)`](../../frontend/src/features/change-orders/components/change-orders-console.tsx#L835) — **sets `selectedViewerEstimateId`**
      - `loadProjectAuditEvents(projectId)`
    - `])`
    - [`fetchProjectChangeOrders(projectId)`](../../frontend/src/features/change-orders/components/change-orders-console.tsx#L978) — returns `[]` (no COs)
    - [`hydrateEditForm(undefined)`](../../frontend/src/features/change-orders/components/change-orders-console.tsx#L712)
      - `setEditLineItems([emptyLine(1)])`
      - `setEditLineNextLocalId(2)` — resets **edit** counter only

*── triggered effect (fires because `selectedViewerEstimateId` changed) ──*

- [`useEffect → loadBudgetLines(projectId, sourceEstimateId)`](../../frontend/src/features/change-orders/components/change-orders-console.tsx#L1155)
  - `await fetch /projects/{id}/budgets/` — async, **races against `fetchProjectChangeOrders`**
  - [`prefillNewLinesFromBudgetLines(nextLines)`](../../frontend/src/features/change-orders/components/change-orders-console.tsx#L948)
    - Maps budget lines → `localId: index + 1` → e.g. `[1, 2, 3]`
    - `setNewLineItems(mapped)`
    - `setNewLineNextLocalId(mapped.length + 1)` — e.g. `4`

*── user interaction ──*

- User clicks **Add Line Item**
  - [`addLine(setNewLineItems, newLineNextLocalId, setNewLineNextLocalId)`](../../frontend/src/features/change-orders/components/change-orders-console.tsx#L1193)
    - Reads `newLineNextLocalId` (should be `4` if prefill completed)
    - Appends `emptyLine(4)` → localIds `[1, 2, 3, 4]` — all unique ✓

## The Race Condition (Pre-Fix)

Before the fix, `nextLineLocalId` was a **single shared counter** used by both the create and edit forms. The race:

```
Timeline A (budget-prefill effect wins first):
  1. prefillNewLinesFromBudgetLines → setNextLineLocalId(4)     ← correct
  2. fetchProjectChangeOrders → hydrateEditForm(undefined)
     → setNextLineLocalId(2)                                    ← CLOBBERS to 2
  3. User clicks "Add Line Item" → localId = 2                  ← DUPLICATE

Timeline B (fetchProjectChangeOrders wins first):
  1. fetchProjectChangeOrders → hydrateEditForm(undefined)
     → setNextLineLocalId(2)
  2. prefillNewLinesFromBudgetLines → setNextLineLocalId(4)     ← correct, last write wins
  3. User clicks "Add Line Item" → localId = 4                  ← OK
```

Timeline A produced duplicate React keys (`localId: 2` on both a prefilled row and the new row), causing:
- React console error: `Encountered two children with the same key`
- Synced/mirrored input fields (React reuses DOM for same-key siblings)
- Validation errors on wrong rows

**Repro conditions:** Project with approved estimate + zero COs. The `/budgets/` fetch in the effect must resolve before `/change-orders/` returns (both are parallel network requests — order depends on server timing).

## The Fix

Split the shared counter into two independent counters:

| Counter | Used by | Set by |
|---------|---------|--------|
| `newLineNextLocalId` | Create form `addLine` | `prefillNewLinesFromBudgetLines`, `loadProjects` reset, `handleStartNewChangeOrder`, post-create cleanup |
| `editLineNextLocalId` | Edit form `addLine` | `hydrateEditForm` (both undefined and populated branches) |

`hydrateEditForm(undefined)` now only touches `editLineNextLocalId`, so it can never clobber the create form's counter regardless of fetch resolution order.
