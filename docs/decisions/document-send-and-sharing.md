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

A third problem existed in the status management UX: the "select next status
from dropdown → click Update" pattern is a developer's mental model, not a
user's. Picking "sent" from a dropdown and clicking "Update" doesn't communicate
what's about to happen (email fires, document becomes public, etc.). Users think
in actions ("send this to my customer"), not state transitions ("change status
field to sent").

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

### 2. Action buttons replace the status dropdown

The "select next status → update" dropdown is replaced with explicit action
buttons. Each button describes what it does in plain language. The available
buttons are determined by the document's current status.

**Estimates:**

| Current status | Available actions |
|----------------|-------------------|
| Draft          | **Send to Customer**, Void |
| Sent           | **Re-send**, Mark Approved, Mark Rejected, Void |
| Approved       | *(locked — no actions)* |
| Rejected       | Void |
| Void           | *(terminal)* |

**Invoices:**

| Current status   | Available actions |
|------------------|-------------------|
| Draft            | **Send to Customer**, Void |
| Sent             | **Re-send**, Void |
| Partially Paid   | Void |
| Paid             | *(terminal)* |
| Void             | *(terminal)* |

**Change Orders:**

| Current status     | Available actions |
|--------------------|-------------------|
| Draft              | **Send for Approval**, Void |
| Pending Approval   | **Re-send**, Mark Accepted, Mark Rejected, Void |
| Accepted           | *(locked — no actions)* |
| Rejected           | Void |
| Void               | *(terminal)* |

**Rationale:** "Send to Customer" tells the user exactly what will happen.
"Void" tells them exactly what will happen. A dropdown with status codes
tells them nothing.

### 3. Action buttons live in the expansion panel

Action buttons are placed in the document expansion area (where status controls
already live), not in the document card header. The card stays clean — just
identity info (number, customer, amount, status badge). When a document is
selected and the detail panel expands, the contextual actions appear alongside
the document detail.

This removes all action links from the card surface: no "Customer View," no
inline status controls, no send links. Select a document → see its detail →
take action.

### 4. "Send to Customer" is the primary send surface

The "Send to Customer" button does two things atomically:

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

### 5. Re-send uses the same surface

For documents already in `sent` status, the "Re-send" button:

- Records a re-send audit event (infrastructure already exists)
- Opens the share mechanism again
- Does **not** change the document status (already sent)

### 6. Auto-email fires on any sent transition

The Mailgun notification email fires whenever a document transitions to sent,
regardless of which button triggered it. The customer may receive both an email
and a text/share — that's intentional. The email is the system's automatic
notification; the share is the user's personal outreach.

### 7. Action feedback: before and after

Users need to know what the system will do (before) and what it did (after).

**Send / Re-send buttons** — the button label communicates intent clearly.
After the transition completes, a toast confirms what happened:

- *"Sent. Email notification delivered to jane@example.com."*
- *"Sent. No email on file — share the link directly."*

**Other action buttons** (Void, Mark Approved, etc.) — these are
straightforward status changes. Post-action toast confirms the outcome:

- *"Estimate voided."*
- *"Marked as approved."*

Every action gives the user clear feedback about what the system did on their
behalf. No silent side effects.

### 8. "Customer View" link is removed

The current new-tab link to the public preview is removed entirely. Internal
users who want to preview the public page can use print preview or a dedicated
preview mode (future work). The public URL is not surfaced as a direct link in
the internal UI — it's delivered to the customer via the share mechanism.

## Multiple paths, consistent outcome

The backend lifecycle is strict: one state machine, one set of audit events, one
set of side effects. The frontend offers clear action buttons that map directly
to backend transitions:

| Context | Action | What happens | Feedback |
|---------|--------|-------------|----------|
| Mobile, on job site | Send to Customer → Messages | draft → sent + SMS to customer + auto-email | Toast: "Sent. Email delivered to..." |
| Desktop, composing | Send to Customer → clipboard | draft → sent + link copied + auto-email | Toast: "Sent. Link copied. Email delivered to..." |
| Re-send (any device) | Re-send → share sheet | re-send event + share (no status change) | Toast: "Re-sent. Email delivered to..." |
| Void (any device) | Void | status → void | Toast: "Voided." |

All paths go through the same backend transitions. The action buttons just make
each transition's meaning and side effects explicit.

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
- **Document consoles** (3 consoles): Replace status dropdown with contextual
  action buttons in the expansion panel. Add share mechanism (Web Share API /
  clipboard) to the send/re-send buttons.
- **Toast system**: New shared component for post-action feedback messages.
- **"Customer View" link**: Remove from all document consoles.
- **Backend**: No changes needed — the status transition, audit events, and
  email sending already exist. The frontend just needs to call them.
- **PWA manifest / service worker**: Not required for share button (Web Share
  API works without PWA install). Required later for push notifications.
