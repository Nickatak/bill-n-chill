# Deferred: Nav collapse for narrow desktop / tablet portrait (701–850px)

## Context

The workflow navbar reserves 300px right padding to avoid overlapping with the app toolbar buttons. At 701–850px viewport width, this leaves insufficient horizontal space for all 5 nav links, triggering a horizontal scrollbar on the `.scroll` container.

At <=700px the mobile drawer takes over, so this only affects a narrow band of tablet-portrait and small-window users.

## Options when revisited

1. **Collapse into dropdown/hamburger at ~850px** — add a breakpoint that hides the pill row and shows a compact nav control (similar to mobile drawer but inline).
2. **Raise the mobile drawer breakpoint** — bump the mobile/desktop cutover from 700px to ~850px so the drawer covers this range.
3. **Abbreviate labels** — shorten nav labels at narrow widths (e.g. "Dash", "Cust", "Proj") to avoid overflow.

## When to revisit

- If tablet usage becomes significant in analytics.
- If more nav items are added (making the overflow worse on wider screens too).
