# Document Send & Sharing

**Date:** 2026-03-21
**Status:** Decided
**Applies to:** Estimates, Invoices, Change Orders

## Context

Documents follow a lifecycle: draft → sent → (customer action) → terminal state.
The transition from draft to sent is the key commitment point — it means "this
document is ready and has been delivered to the customer."

Today, the "Customer View" link opens the public preview in a new tab. This was
an MVP stand-in for quick developer/QA access. It has two problems:

1. **It bypasses delivery.** The user can view the public page, but the customer
   doesn't receive anything. The user must separately change the status to "sent"
   and hope they remember to actually share the link.
2. **It exposes drafts.** Public tokens are generated at creation time, so draft
   documents are technically accessible via their public URL. This undermines the
   lifecycle — if a customer can see a draft, the draft → sent transition is
   meaningless.

The PWA decision (`pwa-mobile-strategy.md`) already established that Web Share
API is the delivery mechanism and that programmatic SMS is rejected. This
decision connects those pieces into a concrete UX.

## Decisions

### 1. Draft documents are not publicly accessible

Public preview endpoints must reject documents that have not reached `sent`
status (or equivalent: `pending_approval` for change orders). The public token
exists from creation (for URL stability), but the public page returns a
not-found or not-yet-available response until the document is sent.

**Rationale:** The lifecycle exists to enforce a deliberate gate. If drafts are
viewable, "sent" has no meaning.

### 2. Share button is the primary send surface

Each document console gets a "Send" action button (label TBD — "Send",
"Send to Customer", etc.) that does two things atomically:

1. **Transitions the document to sent** (draft → sent), firing all existing
   lifecycle side effects (audit event, identity freeze, auto-email via Mailgun).
2. **Opens the device share mechanism** with the public document link
   pre-populated:
   - **Mobile (PWA):** `navigator.share()` opens the native share sheet
     (Messages, WhatsApp, email, etc.)
   - **Mobile fallback:** `sms:?body=...` URI opens Messages with pre-populated
     text containing the public link
   - **Desktop:** Copy-to-clipboard with toast confirmation (behavior may evolve)

The user clicks one button and the document is both marked as sent and delivered
to the customer through whatever channel they choose.

### 3. Re-send uses the same surface

For documents already in `sent` status, the same button is available but labeled
differently ("Re-send", "Share Again", etc.). It:

- Records a re-send audit event (infrastructure already exists)
- Opens the share mechanism again
- Does **not** change the document status (already sent)

### 4. Manual status dropdown remains

The existing status transition dropdown is not removed. It serves as an explicit
control for power users who want to manage status independently — e.g., marking
something as sent without triggering the share sheet, or transitioning to other
statuses (void, etc.).

The share button and the status dropdown are two surfaces for the same backend
transition. The backend doesn't care which surface initiated it.

### 5. Auto-email fires on any sent transition

The Mailgun notification email fires whenever a document transitions to sent,
regardless of which surface triggered it (share button or status dropdown). This
means the customer may receive both an email and a text/share — that's
intentional. The email is the system's automatic notification; the share is the
user's personal outreach.

### 6. "Customer View" link is removed

The current new-tab link to the public preview is replaced by the share button.
Internal users who want to preview the public page can use print preview or a
dedicated preview mode (future work), but the public URL is not surfaced as a
direct link in the internal UI.

## Multiple paths, consistent outcome

The backend lifecycle is strict: one state machine, one set of audit events, one
set of side effects. The frontend offers multiple paths to the same outcome
because users operate in different contexts:

| Context | Path | What happens |
|---------|------|-------------|
| Mobile, on job site | Share button → Messages | draft → sent + SMS to customer + auto-email |
| Desktop, composing | Share button → clipboard | draft → sent + link copied + auto-email |
| Desktop, power user | Status dropdown → sent | draft → sent + auto-email (no share sheet) |
| Re-send (any device) | Share button on sent doc | re-send event + share sheet (no status change) |

All four paths produce the same backend state. The difference is only in how the
link reaches the customer.

## Desktop behavior — open question

The desktop share experience (copy-to-clipboard) works but may feel underwhelming
compared to mobile's native share sheet. Potential future options:

- Inline compose panel (paste link into a message template, choose email/SMS)
- Browser-level Web Share API (Chrome on desktop supports `navigator.share()`)
- Modal with link + QR code for in-person sharing

This is deferred — clipboard + toast is sufficient for MVP.

## Impact on existing code

- **Public preview endpoints** (estimate, invoice, change order): Add status
  guard rejecting drafts.
- **Document consoles** (3 consoles): Add share/send button, wire to status
  transition + Web Share API.
- **"Customer View" link**: Remove from all document consoles.
- **Backend**: No changes needed — the status transition, audit events, and
  email sending already exist. The frontend just needs to call them.
- **PWA manifest / service worker**: Not required for share button (Web Share
  API works without PWA install). Required later for push notifications.
