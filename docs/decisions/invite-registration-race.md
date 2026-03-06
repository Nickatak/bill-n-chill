# Decision Record: Invite Registration Race Condition

Date: 2026-03-05
Status: Implemented (bundled with email verification)

## Problem

A user invited to an organization could navigate to `/register` directly (bypassing the
invite link) and register via Flow A (no token). This created a new user + new org + owner
membership, leaving the pending invite unconsumed. The user ended up in their own empty org
instead of the org they were invited to.

**Root cause:** `register_view()` only checked for invites when `invite_token` was present
in the request body. It had no reason to look up pending invites by email.

## Options Considered

| Approach | Tradeoff |
|----------|----------|
| **A. Auto-detect at registration** | Most user-friendly. Look up unconsumed invites by email during Flow A. If found, show a banner with the option to use the invite link or continue with a new org. Minor info leak: reveals org name to anyone who guesses an invited email. |
| **B. Auto-consume at registration** | Surprising. Silently joins the user to an org they didn't explicitly consent to. |
| **C. Post-registration prompt** | Non-disruptive but adds complexity. User already has an org by the time they see the prompt. |
| **D. Do nothing** | Zero complexity. Document it, tell org owners to remind invitees to use the link. |

## Decision

**Option A — auto-detect at registration.** During Flow A, look up unconsumed/unexpired
invites matching the registering email. If found, show a banner:

> "You've been invited to join **{org}**. [Use invite link] or [Continue with new account]."

**Info leak assessment:** Acceptable. Exploiting it requires knowing the exact invited
email and hitting registration within 24 hours of the invite being created. If an attacker
has both of those, the org name leak is the least of your problems.

**Email verification dependency:** Once email verification shipped, this race condition
closed naturally — the user can't complete registration without proving they own the email,
and the verification flow surfaces pending invites as part of the post-verification
onboarding.

## Implementation

Bundled with the email verification feature. The verification flow checks for pending
invites after the user confirms their email, surfacing any pending invites before the user
lands in their default empty org.

**Tests:** Covered in `test_email_verification.py` and `test_invites.py`.

## Related

- Email verification decision doc: `docs/decisions/email-verification.md`
- Invite flow security: `docs/decisions/invite-flow-security.md`
- Auth call chain: `docs/call-chains/auth.md`
- Original deferred doc: removed (superseded by this record)
