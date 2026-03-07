# Deferred: Differentiate consumed vs expired verification links

## Context
When a user clicks an old verification link (consumed because they resent), the verify-email page shows the same "Verification Failed" warning + resend form as an expired link. This is misleading — the user likely already verified via the newer link.

## Desired behavior
- **Consumed token:** Softer message, e.g. "This link is no longer active. If you've already verified, sign in below." Show a "Sign in" button instead of the resend form.
- **Expired token:** Keep the current resend form flow.

## Frontend change
Use the `error.code` field from the backend response (`"consumed"` vs `"expired"`) to render different UI in `verify-email-console.tsx`.

## Backend
Already returns distinct error codes: `consumed` and `expired` (both 410). No backend changes needed.
