# Email Verification + Enumeration Fix

**Resolves:** MVP gaps #8 (no email verification), #9 (registration email enumeration), #5 (invite registration race)

## Problem

1. **No email verification (#8):** Anyone can register with any email address. No proof of ownership.
2. **Email enumeration (#9):** Registration returns distinct errors for "email taken" vs success — an attacker can probe which emails have accounts.
3. **Invite race (#5):** Depends on #8. Once verification exists, the invite check happens after the user proves they own the email, closing the race window.

## Infrastructure Required

**Transactional email provider** (one of):
- AWS SES (~$0.10/1000 emails)
- Postmark (100/month free tier)
- Sendgrid (100/day free tier)

**DNS records** (one-time):
- SPF record for the sending domain
- DKIM record (provider generates the key)

**No additional infrastructure.** No Celery, no Redis, no message queue. At current volume (single-digit emails/day), `send_mail()` inline in the request-response cycle adds ~200ms — invisible to the user who's about to check their email anyway.

## Design

### New Models

#### `EmailVerificationToken`
Reuses the `OrganizationInvite` token pattern.

```python
class EmailVerificationToken(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="verification_tokens")
    token = models.CharField(max_length=64, unique=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)

    EXPIRY_HOURS = 24

    def save(self, *args, **kwargs):
        if not self.token:
            self.token = secrets.token_urlsafe(32)
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(hours=self.EXPIRY_HOURS)
        super().save(*args, **kwargs)

    @classmethod
    def lookup_valid(cls, token_str):
        # Same 3-tuple pattern as OrganizationInvite.lookup_valid()
        ...
```

#### `EmailRecord`
Immutable audit log for all transactional emails.

```python
class EmailRecord(models.Model):
    class EmailType(models.TextChoices):
        VERIFICATION = "verification"
        INVITE = "invite"
        PASSWORD_RESET = "password_reset"  # future

    class Status(models.TextChoices):
        SENT = "sent"
        FAILED = "failed"

    recipient = models.EmailField()
    email_type = models.CharField(max_length=32, choices=EmailType.choices)
    status = models.CharField(max_length=16, choices=Status.choices)
    organization = models.ForeignKey("Organization", null=True, blank=True, on_delete=models.SET_NULL)
    triggered_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    error_detail = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
```

#### User field addition
Add `is_email_verified = models.BooleanField(default=False)` to User.

**Note:** We're on Django's default `auth.User` (#15 in MVP gaps). Two options:
- **Option A:** Add the field to a `UserProfile` model (one-to-one, already planned for custom user migration)
- **Option B:** Just check `EmailVerificationToken.consumed_at IS NOT NULL` for the user's most recent token — no User model change needed

Option B is simpler and avoids touching the User model before #15 is resolved.

### Changed Endpoints

#### `POST /api/v1/auth/register/` (Flow A — standard registration)

**Current behavior:**
1. Validate email + password
2. Create User + auto-org + membership
3. Return 201 with token + auth payload

**New behavior:**
1. Check if email already exists → **return identical response** (fixes #9)
2. If new: Create User + auto-org + membership
3. Generate `EmailVerificationToken`
4. Send verification email (inline `send_mail()`)
5. Log to `EmailRecord`
6. Return 201 with `{"data": {"message": "Check your email to verify your account."}}`
7. **No auth token returned** — user must verify first

For existing emails: still return the same 201 + same message. Optionally send a "someone tried to register with your email" notification to the existing user (nice-to-have, not MVP).

#### `POST /api/v1/auth/register/` (Flow B — invite registration)

Invite registration **skips email verification** — the invite itself proves the email was expected. Behavior stays the same (returns auth token immediately).

#### `GET /api/v1/auth/verify-email/{token}/`

**New endpoint.**

1. Look up token via `EmailVerificationToken.lookup_valid()`
2. If valid: mark `consumed_at`, return 200 + auth payload (log user in)
3. If expired/consumed/not_found: return appropriate error

This doubles as the login mechanism for first-time users — clicking the email link verifies and logs them in simultaneously.

#### `POST /api/v1/auth/login/`

**Current behavior:** Authenticate email + password, return token.

**New behavior:** Same, but after successful password check, verify `is_email_verified` (or check for consumed verification token). If not verified:
- Return 403 with `{"error": {"code": "email_not_verified", "message": "Please verify your email before logging in."}}`
- Optionally: resend verification email automatically

#### `POST /api/v1/auth/resend-verification/`

**New endpoint.** Rate-limited (1 per 60s per email).

1. Accept `{"email": "..."}`
2. If user exists and unverified: generate new token, send email, log to `EmailRecord`
3. Always return 200 with generic message (no enumeration leak)

### Frontend Changes

#### Post-registration screen
New component: after Flow A registration, show "Check your email" screen with:
- "We sent a verification link to {email}"
- "Didn't get it? Resend" button (calls resend endpoint)
- Link to go back to login

#### Login error handling
If login returns `email_not_verified`:
- Show inline message: "Please verify your email first"
- Show "Resend verification email" link

#### Verification landing page
Route: `/verify-email/{token}`
- Calls `GET /api/v1/auth/verify-email/{token}/`
- On success: stores auth token, redirects to dashboard
- On error: shows appropriate message (expired → resend option, consumed → login link)

### Django Email Configuration

```python
# settings.py
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_USE_TLS = True
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "noreply@billnchill.com")
```

Dev override:
```python
# Use console backend in development (prints to stdout)
if DEBUG:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
```

## Migration Plan

### Phase 1: Models + Email Config
- `EmailVerificationToken` model + migration
- `EmailRecord` model + migration
- Django email backend configuration
- Console backend for dev

### Phase 2: Registration Flow
- Modify `register_view()` Flow A: generate token, send email, return generic response
- Add `verify-email/{token}/` endpoint
- Add `resend-verification/` endpoint
- Fix enumeration: same response for new + existing emails

### Phase 3: Login Gate
- Add verification check to `login_view()`
- Return `email_not_verified` error code
- Auto-resend option on failed login

### Phase 4: Frontend
- Post-registration "check your email" screen
- Verification landing page (`/verify-email/{token}`)
- Login error handling for unverified accounts
- Resend button + rate limit feedback

### Phase 5: Invite Flow Cleanup (#5)
- Review invite race condition in context of verified emails
- Ensure `check-invite-by-email` only returns results for verified users
- Close any remaining race windows

## Testing

### Backend
- Register Flow A → no auth token returned, verification token created, EmailRecord logged
- Register with existing email → same response (no enumeration)
- Verify valid token → user logged in, token consumed
- Verify expired/consumed/invalid token → appropriate errors
- Login unverified user → 403 with `email_not_verified`
- Login verified user → normal success
- Resend verification → new token generated, old one still valid
- Resend rate limiting → 429 on rapid requests
- Flow B (invite) → skips verification, immediate auth

### Frontend
- Post-registration screen renders with email
- Resend button calls endpoint, shows feedback
- Verification page handles success/expired/consumed
- Login shows verification error + resend link

## Decisions

- **Inline `send_mail()`, no task queue** — volume doesn't justify Celery. Revisit when sending >100 emails/day.
- **Option B for verified flag** — check token consumption rather than adding User model field. Avoids #15 dependency.
- **Invite registration skips verification** — the invite token itself is proof of expected email. The inviter authorized that address.
- **Verification link = login** — clicking the email link both verifies and logs in. No separate login step needed for first-time users.
- **Console backend in dev** — emails print to Django stdout in development. No external service needed for local testing.

## Post-Implementation Status

**Implemented** (March 2026). All 6 phases complete, 41 backend + 417 frontend tests passing. See `docs/call-chains/auth.md` for full trace.

### Future Optimization: Denormalize `email_verified` onto User

Currently `is_user_verified()` derives status from the `EmailVerificationToken` table (1-2 indexed queries per login). This is fine at current scale — login is once per session, queries are sub-millisecond on a tiny table.

When to revisit:
- If verification status needs checking on every authenticated request (e.g. middleware gate)
- If/when we migrate to a custom User model (MVP gap #15)

The migration is straightforward: add `BooleanField(default=True)` to User, set `False` on Flow A registration, set `True` in `verify_email_view`. Legacy/seed users default to `True`.
