# Dashboard-As-Home (Auth-Gated) Sketch

## Intent

Use `/` as both splash and operational entry:
- If unauthenticated: show a minimal sign-in screen.
- If authenticated: show an operations dashboard with immediate workflow actions.

## Why

1. Faster field usage for already signed-in users.
2. Cleaner login and entry flow.
3. Single canonical starting route for day-to-day operations.

## UX Sketch

### Unauthenticated Home (`/`)

- Brand header (`bill-n-chill`)
- Short value line
- Login form (email + password + submit)
- Clear session/login status message
- Lightweight API health status indicator

### Authenticated Home (`/`)

- Header: "Operations Dashboard"
- Signed-in identity display
- Quick actions (top workflows):
  1. Quick Add Contact
  2. Projects
  3. Estimates
  4. Invoices
- Session status line (shared session in use)
- API health status indicator
- Sign out action

## Interaction Rules

- On load with saved token, auto-check `/auth/me`.
- Invalid token should clear local session and return to login state.
- Login success should persist session and transition directly to dashboard view.
- Sign out should clear local session and return to login view.

## Alignment with Current Navigation

- Global workflow navbar remains on all pages.
- Dashboard quick actions are accelerators, not replacements for full nav order.
