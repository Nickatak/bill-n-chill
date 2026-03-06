# Deferred: Nav Overlap for Narrow Desktop / Tablet (701-850px)

## Status: Deferred from MVP

## Context

The workflow navbar reserves right padding to avoid overlapping the app toolbar buttons.
At 701-850px viewport width, this leaves insufficient horizontal space for all nav links,
triggering a horizontal scrollbar on the `.scroll` container.

At <=700px the mobile drawer takes over, so this only affects a narrow band of
tablet-portrait and small-window users.

The toolbar and navbar coexist in the same row. On standard monitors (1920px+) this isn't
an issue. On phones (<=700px) the mobile drawer handles it. The gap is the 701-850px band
-- primarily tablets in portrait and small laptop windows.

## Why It Matters

- **Field workers on laptops:** A site worker using a laptop to review a change order or
  add a billable hits the overlap zone directly.
- **Tablet usage:** iPads in portrait (768-810px) are squarely in the affected range.
- **Nav item count:** RBAC reduces visible routes for restricted roles, which helps, but
  the toolbar (org dropdown, print, logout) is always present.

## Options When Revisited

1. **Raise the mobile drawer breakpoint** to ~850px so the drawer covers this range.
   Simplest fix. Trade-off: loses the at-a-glance horizontal nav for users who have
   enough room for most of it.

2. **Collapse into dropdown at ~850px** — add a breakpoint that hides the pill row and
   shows a compact nav control (similar to mobile drawer but inline).

3. **Abbreviate labels** at narrow widths (e.g. "Dash", "Cust", "Proj") to reduce
   overflow. Cheapest change but least elegant.

4. **Stack the bars** on mid-width screens: navbar on top, toolbar below. Costs vertical
   space but avoids overlap cleanly.

## When to Revisit

- If tablet usage becomes significant in analytics
- If more nav items are added (making overflow worse at wider screens too)
- If field-worker laptop usage is confirmed as a common pattern
