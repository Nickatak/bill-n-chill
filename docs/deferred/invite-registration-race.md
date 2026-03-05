# Invite Registration Race Condition

**Found:** 2026-03-05

## The Bug

1. Org owner sends invite to `alice@example.com`
2. Alice navigates to `/register` directly (not via the invite link)
3. Alice registers with `alice@example.com` — hits Flow A (no token)
4. Flow A creates a new user + new org + owner membership
5. The pending invite is never consumed — it just sits there until it expires

**Result:** Alice ends up in her own empty org instead of the org she was invited to. The invite is wasted. The inviting org owner sees the invite as "pending" even though Alice already has an account.

## Why It Happens

`register_view` only checks for an invite when `invite_token` is present in the request body. It has no reason to look up pending invites by email — it doesn't know the user was invited.

## Possible Fixes

| Approach | Tradeoff |
|----------|----------|
| **A. Auto-detect at registration** — Look up unconsumed invites by email during Flow A. If found, show a banner: "You have a pending invite to **{org}**. [Use invite link] or [Continue with new org]." | Most user-friendly. Leaks org name to anyone who guesses an invited email. |
| **B. Auto-consume at registration** — Silently treat Flow A as Flow B when a matching invite exists. | Surprising — user didn't consent to joining that org. |
| **C. Post-registration prompt** — After Flow A, check for pending invites and show a prompt on the dashboard. | Non-disruptive but adds complexity. User already has an org. |
| **D. Do nothing** — Document it, tell org owners to remind invitees to use the link. | Zero complexity. Acceptable for MVP. |

## Decision

**Option A — auto-detect at registration.** During Flow A, look up unconsumed/unexpired invites matching the registering email. If found, show a banner: "You've been invited to join **{org}**. [Use invite link] or [Continue with new account]."

**Info leak assessment:** Acceptable. Exploiting it requires knowing the exact invited email and hitting registration within 24 hours of the invite being created. If an attacker has both of those, you have bigger problems than an org name leak.

## Known Gap: No Email Verification

Neither this auto-detect flow nor the original invite link flow verify that the registering user actually owns the email address. Anyone who knows (or guesses) an invited email can register with it and join the org — with or without the invite link.

This is a conscious deferral: email verification is a separate feature that would close this gap across all registration flows. Until then, email ownership is a trust assumption. The org owner invited a specific person; if someone else registers with that email, it's an HR/trust problem, not an application security problem.

**Closes when:** email verification is implemented (confirm-your-email flow before account activation).

## Related

- Invite flow implementation: RBAC Phase 4 in `MEMORY.md`
- `backend/core/views/auth.py` — `register_view` (Flow A/B logic)
- `backend/core/views/auth.py` — `accept_invite_view` (Flow C)
