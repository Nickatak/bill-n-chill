# Invite Flow: Security Analysis & Design

## Context

Users join organizations via a time-limited invite link. The registration page
handles both new-org creation (no token) and org-join (with token) flows. This
document captures a security vulnerability we identified during design and the
mitigation strategy.

## The Vulnerability: Forced Org-Swap via Invite Link

### Attack scenario

1. Attacker creates an account and an organization (Org A).
2. Attacker knows the email of a target user who already has an account in Org B.
3. Attacker generates an invite link for the target's email address.
4. Target clicks the invite link.
5. If the system naively processes the invite, the target gets silently moved
   from Org B to Org A — losing access to all their data in Org B.

### Why this is dangerous

- The target never consented to leaving their current org.
- In a financial tool, losing access to invoices, estimates, and payment records
  is catastrophic for the target's business operations.
- The attacker doesn't need any credentials — just a known email and the ability
  to send/share a link.

## Mitigation: Password Confirmation on Org-Switch

When an invite token resolves to an **existing user**, the system must not
silently reassign them. Instead:

1. Detect that the email is already registered.
2. Display a confirmation screen explaining:
   - "You already have an account associated with **Org B**."
   - "Accepting this invite will move you to **Org A**."
   - "You will lose access to your current organization's data."
3. Require the user to **enter their password** to confirm the switch.

Password confirmation serves two purposes:
- **Proves identity**: Only the actual account holder can authorize the move.
- **Prevents drive-by attacks**: Clicking a link alone cannot trigger the switch.

## Registration Page Behavior

The registration page (`/register`) supports three flows:

### Flow A: New user, no invite token
- Standard registration: email, password.
- Optional org name field (auto-generated if blank).
- Creates new user + new org + owner membership.
- This is the current auth flow — no changes needed.

### Flow B: New user, with invite token
- Registration form includes a hidden/pre-filled token field.
- On submit: validate token (exists, not expired, not already used).
- Create user, skip org creation, join the token's org with the invited role.
- Mark the token as consumed.

### Flow C: Existing user, with invite token
- User clicks invite link, system detects email is already registered.
- Redirect to a confirmation page (not the registration form).
- Show current org, target org, and consequences.
- Require password entry to confirm.
- On valid password: move membership to new org, update role per invite.
- Mark the token as consumed.

## Invite Token Model

```
OrganizationInvite:
  - organization (FK)        # The org being joined
  - email (EmailField)       # Target email
  - role_template (FK, null) # Role to assign on join
  - token (CharField)        # Unique, URL-safe token
  - invited_by (FK to User)  # Audit trail
  - expires_at (DateTime)    # 24hr from creation
  - consumed_at (DateTime, null)  # Set when used
  - created_at (DateTime)
```

### Token lifecycle
- Created by org owner/admin via API.
- Valid for 24 hours.
- Single-use: `consumed_at` is set on acceptance.
- Expired or consumed tokens return a clear error, not a silent failure.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Token expired | Show "This invite has expired. Ask the org admin to send a new one." |
| Token already used | Show "This invite has already been used." |
| User already in the target org | Idempotent — show "You're already a member of this organization." |
| Invite email doesn't match registering email | Reject — token is email-bound for security. |

## Future Considerations

- **Multi-org support**: If we ever relax the one-org-per-user constraint,
  the forced-swap concern goes away (users would simply add a second org).
  The password confirmation would still be appropriate as a consent mechanism.
- **Invite revocation**: Org admins should be able to revoke pending invites.
- **Rate limiting**: Limit invite creation per org to prevent spam/abuse.
