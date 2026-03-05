# Onboarding Guide Arrows

Date: 2026-03-05
Status: Planned

## Concept

When a user hovers over a step card on the onboarding checklist (`/onboarding`), an animated SVG arrow draws from the card to the corresponding navigation element (toolbar link or navbar item). Desktop only — hidden on mobile where hover doesn't exist and navbars are collapsed.

The goal is spatial learning: the user sees exactly where to click next without needing to read instructions. "Set up your organization" → arrow points at the org link in the top-right toolbar.

## Arrow Target Mapping

| Step | Card Label | Arrow Target | Target Location |
|------|-----------|-------------|-----------------|
| 1 | Set up your organization | Org link | AppToolbar (top-right) |
| 2 | Add your first customer | "Customers" | WorkflowNavbar |
| 3 | Create a project | "Projects" | WorkflowNavbar |
| 4 | Build an estimate | "Projects" | WorkflowNavbar (same as step 3) |
| 5 | Send for customer approval | "Projects" | WorkflowNavbar (same as step 3) |
| 6 | Create an invoice | "Billing" | WorkflowNavbar |

Steps 3-5 all point to the same "Projects" nav item. This is fine — the user only hovers one card at a time, and the repetition reinforces "estimates and sending happen inside projects."

## Technical Approach

### SVG Overlay

A single fixed-position `<svg>` element covering the viewport:

```
position: fixed
inset: 0
z-index: 950        /* above navbar (900), below toolbar (1000) */
pointer-events: none /* doesn't block clicks on anything underneath */
width: 100vw
height: 100vh
```

Contains one `<path>` element that's shown/hidden and repositioned on hover.

### Data Attributes

Add `data-onboarding-target` attributes to the navigation elements that arrows can point to:

**AppToolbar** (`app-toolbar.tsx`):
```tsx
<Link data-onboarding-target="organization" href="/ops/organization">
  {orgDisplayName}
</Link>
```

**WorkflowNavbar** (`workflow-navbar.tsx`):
```tsx
<Link data-onboarding-target="customers" href="/customers">Customers</Link>
<Link data-onboarding-target="projects" href="/projects">Projects</Link>
<button data-onboarding-target="billing" ...>Billing</button>
```

### Step-to-Target Mapping

In the onboarding checklist component, each step declares its target:

```typescript
const STEP_TARGETS: Record<string, string> = {
  organization: "organization",
  customer: "customers",
  project: "projects",
  estimate: "projects",
  send: "projects",
  invoice: "billing",
};
```

### Arrow Geometry

On hover of a step card:

1. `getBoundingClientRect()` on the step card element
2. `document.querySelector(`[data-onboarding-target="${target}"]`)` to find the nav element
3. `getBoundingClientRect()` on the nav element
4. Compute a curved SVG path between them

The arrow starts from the right edge (or top edge) of the step card and curves to the target element. Use a quadratic bezier for a clean arc:

```typescript
function computeArrowPath(from: DOMRect, to: DOMRect): string {
  const startX = from.right;
  const startY = from.top + from.height / 2;
  const endX = to.left + to.width / 2;
  const endY = to.bottom;

  // Control point: midpoint X, biased toward the target Y
  const cpX = (startX + endX) / 2;
  const cpY = Math.min(startY, endY) - 40;

  return `M ${startX} ${startY} Q ${cpX} ${cpY} ${endX} ${endY}`;
}
```

The exact control point math will need tuning based on the spatial relationship — step 1 (org) arrows up-and-right to the toolbar, while steps 2-6 arrow up-and-center to the navbar.

### Arrowhead

SVG `<marker>` definition for a simple triangular arrowhead:

```svg
<defs>
  <marker id="arrowhead" markerWidth="8" markerHeight="6"
          refX="8" refY="3" orient="auto">
    <polygon points="0 0, 8 3, 0 6" fill="var(--accent)" />
  </marker>
</defs>
```

### Animation

Draw-in effect using `stroke-dasharray` / `stroke-dashoffset`:

1. Set `stroke-dasharray` to the path's total length
2. Set `stroke-dashoffset` to the same value (fully hidden)
3. On hover, transition `stroke-dashoffset` to 0 over ~300ms

```css
.arrowPath {
  stroke: var(--accent);
  stroke-width: 2;
  fill: none;
  marker-end: url(#arrowhead);
  transition: stroke-dashoffset 300ms ease-out, opacity 150ms ease-out;
}
```

On mouse leave, fade out with opacity rather than "un-drawing" (which would look weird in reverse).

### Target Highlight

When an arrow is active, add a subtle highlight to the target nav element. Since the SVG overlay has `pointer-events: none`, we can't use it for this — instead, toggle a CSS class on the target element directly:

```css
[data-onboarding-target].onboarding-highlight {
  background: var(--accent-light);
  border-radius: var(--radius-sm);
  transition: background 200ms ease;
}
```

Add/remove the class via JS on hover enter/leave.

## Implementation Plan

### Step 1: Data attributes on nav elements

Add `data-onboarding-target` to AppToolbar's org link and WorkflowNavbar's Customers, Projects, Billing items. No behavioral change — just marking elements for queryability.

**Files:** `app-toolbar.tsx`, `workflow-navbar.tsx`

### Step 2: SVG overlay component

New component: `shared/onboarding/guide-arrow-overlay.tsx`

- Renders fixed SVG with arrowhead marker def
- Exposes `showArrow(stepKey: string)` and `hideArrow()` (or just accepts `activeStep: string | null` as a prop)
- Computes path geometry from step card rect → target element rect
- Handles the draw animation
- Adds/removes highlight class on target element
- Only renders on desktop (check `window.innerWidth > 700` or use CSS `display: none` at mobile breakpoint)

**Files:** `shared/onboarding/guide-arrow-overlay.tsx`, `shared/onboarding/guide-arrow-overlay.module.css`

### Step 3: Wire into onboarding checklist

Add `onMouseEnter` / `onMouseLeave` handlers to step cards. Pass active step to the overlay component.

Each step card needs a ref or an ID so the overlay can `getBoundingClientRect()` it:

```tsx
<li
  data-onboarding-step={step.key}
  onMouseEnter={() => setActiveGuideStep(step.key)}
  onMouseLeave={() => setActiveGuideStep(null)}
>
```

**Files:** `onboarding-checklist.tsx` (or the page component that contains the steps)

### Step 4: Polish

- Tune bezier control points for each spatial relationship (up-right to toolbar vs. up-center to navbar)
- Verify arrow clears the page content and doesn't overlap text
- Test at various viewport widths above 700px
- Ensure arrow recalculates on window resize (debounced)

## What This Doesn't Do

- No arrows on mobile (hover doesn't exist, navbars are hidden)
- No arrows to elements inside dropdown menus (Billing dropdown, Ops/Meta dropdown) — only to the top-level trigger elements
- No persistence — arrows are purely ephemeral hover feedback
- No new dependencies — pure SVG + CSS + getBoundingClientRect
