# Responsive Navigation — Deferred Notes

## Current state (March 2026)

Two-tier responsive layout:

- **Mobile (≤700px):** Hamburger drawer replaces the desktop toolbar, navbar, and
  breadcrumbs. Contains all workflow routes, ops/meta routes, and actions.
  Located at `shared/shell/mobile-drawer/`.

- **Desktop (>700px):** Horizontal workflow navbar (left, fixed) + app toolbar
  (right, fixed) share the same 48px strip at the top of the viewport.

No intermediate breakpoint exists.

## Known overlap zone

The toolbar and navbar coexist in the same 48px row. At viewport widths between
roughly **1000–1400px** (older laptops, tablets in landscape, small split-screen
windows), the two bars can overlap because neither one yields space to the other.

On standard office monitors (1920px+) this isn't an issue. On phones (≤700px)
the mobile drawer handles it. The gap is the 700–1400px band — primarily
laptops and tablets.

## Why it matters later

- **Field workers on laptops:** A site worker using a laptop to add a billable
  or review a change order hits the overlap zone directly.
- **RBAC-driven nav:** Role-based access is now live — different roles see
  different route sets. Fewer visible routes means fewer pills, which helps, but
  the toolbar (org, quick jump, ops/meta, theme, logout) is always present.
- **Tablet usage:** iPads in landscape (1024px) are squarely in the overlap zone.

## Potential approaches

1. **Extend the hamburger drawer breakpoint** upward (e.g., ≤1024px) so tablets
   and small laptops get the drawer too. Straightforward, but loses the at-a-glance
   horizontal nav for users who have enough room for most of it.

2. **Collapse the toolbar into the navbar** so they're a single row that wraps
   or scrolls together. The toolbar items move into a single "..." dropdown or
   icon row at the right end of the navbar. Eliminates the dual-bar conflict.

3. **Stack the bars** on mid-width screens: navbar on top, toolbar below (or
   vice versa). Costs more vertical space but avoids overlap cleanly.

4. **Responsive navbar redesign** when RBAC lands: conditionally rendered routes
   naturally reduce pill count, and the nav could switch to a compact icon-based
   layout at mid-widths.

## Decision

Deferred. The overlap doesn't affect the primary user segments today (office
staff on 1080p+ monitors, field workers on phones). RBAC is now live and
does reduce pill count for restricted roles. Revisit when laptop/tablet usage
becomes a confirmed need.
