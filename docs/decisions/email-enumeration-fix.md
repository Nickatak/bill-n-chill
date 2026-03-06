# Decision Record: Registration Email Enumeration Fix

Date: 2026-03-05
Status: Implemented (bundled with email verification)

## Problem

The registration endpoint returned distinct errors for "email already taken" vs success.
This allowed an attacker to enumerate valid email addresses — a low-severity information
disclosure risk (OWASP: Broken Authentication).

## Analysis

- **Severity:** Low. Pre-launch, small user base, no sensitive PII beyond email existence.
- **Standard mitigation:** Return the same response regardless of whether the email is new
  or already registered. If the account exists, silently send a password-reset or
  notification email instead of a verification email.
- **Dependency:** The fix requires email verification infrastructure — you can't return
  "check your email" if there's no email to send.

## Decision

Bundle with the email verification feature (#8). When verification ships, the registration
endpoint returns an identical 201 response for both new and existing emails:

```
{"data": {"message": "Check your email to verify your account."}}
```

- New email: sends verification link
- Existing email: returns the same message (optionally sends "someone tried to register
  with your email" notification — not implemented in MVP, noted as future nice-to-have)

No auth token is returned at registration time for either case. The user must click the
verification link to complete sign-up.

## Implementation

**Endpoint:** `POST /api/v1/auth/register/` (Flow A — standard registration)

Key changes to `register_view()`:
1. Check if email exists before creating a user
2. Return identical response shape regardless of outcome
3. Generate `EmailVerificationToken` and send verification email for new accounts
4. Log all sends to `EmailRecord` for audit

**Tests:** Covered in `test_email_verification.py` — specifically tests that registering
with an existing email returns the same 201 response as a new registration.

## Tradeoffs

- **Chosen:** Generic response eliminates enumeration entirely. Standard industry practice.
- **Accepted cost:** Slightly worse UX for users who accidentally re-register — they don't
  get told "you already have an account." They'll figure it out when they check email and
  see a different message (or no message, depending on future notification implementation).
- **Not implemented:** "Someone tried to register with your email" notification to existing
  users. Low priority — adds complexity for a rare edge case.

## Related

- Email verification decision doc: `docs/decisions/email-verification.md`
- Auth call chain: `docs/call-chains/auth.md`
- Original deferred doc: removed (superseded by this record)
