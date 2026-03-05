# Deferred: Light Mode / High-Contrast Theme

## Status: Deferred from MVP

## Context

The app ships dark-only for MVP. Light mode CSS variables existed but were never styled
or tested. The theme toggle was removed (March 2026) to avoid shipping a broken experience.

## When to Revisit

When field-worker UX optimization becomes a priority (outdoor/construction-site usage).

## Design Considerations

- **Standard dark mode fails outdoors** — low contrast washes out in direct sunlight,
  dark surfaces act as mirrors for screen reflections.
- **High-contrast dark** can work if contrast ratios are pushed well above WCAG AA
  (10:1+ text-to-bg), mid-tone grays are eliminated, and accents are saturated.
- **High-contrast light** is the more conventional outdoor-friendly approach — light bg
  with very dark text, bold accents, minimal subtle borders/shadows.
- A **"Field" theme** (either high-contrast variant) could also bump touch targets and
  font sizes for gloved-hand operation.

## Implementation Notes

- All design tokens live in `globals.css` under `:root`. Re-adding themes means adding
  a `html[data-theme="light"]` (or `html[data-theme="field"]`) override block.
- The toolbar/mobile-drawer toggle infrastructure was removed — will need to be
  re-added when this is picked up.
- localStorage key was `bnc-theme`; layout.tsx had a blocking `<script>` for FOUC
  prevention. Both were removed.
