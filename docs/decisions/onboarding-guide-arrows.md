# Decision Record: Onboarding Guide Arrows

Date: 2026-03-05
Status: Implemented

## Problem

New users on the onboarding checklist (`/onboarding`) had to read step descriptions to
figure out where in the UI to go next. There was no visual connection between "Set up your
organization" and the org dropdown in the toolbar, or between "Add your first customer" and
the Customers nav link.

## Decision

Add animated SVG arrows that draw from onboarding step cards to their corresponding
navigation elements on hover. Desktop only — hidden on mobile where hover doesn't exist
and navbars are collapsed into the drawer.

The goal is spatial learning: the user sees exactly where to click next without needing to
read instructions.

## Design

### Arrow Target Mapping

| Step | Arrow Target | Location |
|------|-------------|----------|
| Set up your organization | Org dropdown | AppToolbar (top-right) |
| Add your first customer | "Customers" | WorkflowNavbar |
| Create a project | "Projects" | WorkflowNavbar |
| Build an quote | "Projects" | WorkflowNavbar |
| Send for customer approval | "Projects" | WorkflowNavbar |
| Create an invoice | "Invoices" | WorkflowNavbar |

Steps 3-5 all point to "Projects" — the repetition reinforces that quotes and sending
happen inside the projects workflow.

### Technical Approach

- **Data attributes:** `data-onboarding-target` attributes on nav elements
  (`app-toolbar.tsx`, `workflow-navbar.tsx`) mark them as arrow targets.
- **SVG overlay:** Fixed-position `<svg>` covering the viewport (`z-index: 950`,
  `pointer-events: none`). Contains a single `<path>` with an arrowhead `<marker>`.
- **Geometry:** `getBoundingClientRect()` on both the step card and target element,
  connected by a quadratic bezier curve. Control point biased upward for a clean arc.
- **Animation:** `stroke-dasharray` / `stroke-dashoffset` draw-in effect over ~300ms.
  Fade out on mouse leave rather than reverse-drawing.
- **Target highlight:** CSS class toggled on the target element during hover for a subtle
  background glow.
- **Resize handling:** Arrow recalculates on window resize (debounced).

### Key Files

- `shared/onboarding/guide-arrow-overlay.tsx` — SVG overlay component
- `shared/onboarding/guide-arrow-overlay.module.css` — Arrow styles + animation
- `app/onboarding/onboarding-checklist.tsx` — Step cards with hover handlers
- `shared/shell/app-toolbar/app-toolbar.tsx` — `data-onboarding-target="organization"`
- `shared/shell/workflow-navbar/workflow-navbar.tsx` — `data-onboarding-target` on nav links

## Tradeoffs

- **Chosen:** Pure SVG + CSS + `getBoundingClientRect()`. No dependencies, no libraries.
- **Accepted limitation:** Arrows only work on desktop (>700px). Mobile users rely on step
  descriptions alone — acceptable because mobile users interact with the drawer, not the
  horizontal nav.
- **Not implemented:** Arrows to elements inside dropdown menus (only top-level triggers).
  No persistence — arrows are purely ephemeral hover feedback.

## Related

- Onboarding checklist: `app/onboarding/`
- Original design spec: removed from deferred (superseded by this record)
