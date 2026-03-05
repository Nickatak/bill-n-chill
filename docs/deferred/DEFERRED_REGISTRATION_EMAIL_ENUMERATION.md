# Deferred: Registration Email Enumeration

Decision date: 2026-03-02

## Issue

The registration endpoint currently returns a distinct error when an account already exists for the provided email. This allows an attacker to enumerate valid email addresses — a low-severity information disclosure risk.

## Planned fix

When email verification is implemented, the registration flow should:

1. Always respond with "We've sent you an email at that address" regardless of whether the account exists.
2. If the account already exists, send a password-reset link instead of a verification link.
3. Never reveal whether an email is already registered.

## Current risk assessment

Low. The app is pre-launch with a small user base. No sensitive PII is exposed beyond email existence. The fix is deferred until the email verification feature is built.

## Revisit trigger

- Email verification implementation.
