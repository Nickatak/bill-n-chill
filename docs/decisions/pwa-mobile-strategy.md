# PWA Mobile Strategy

Date: 2026-03-19
Supersedes: `product-direction-refinement.md` (2026-03-11)

## Context

The product direction refinement established that every flow must work on mobile and that BnC is the system of record for our ICP. Two unsolved problems remained:

1. **Push notifications** — How does a contractor know when a customer approves or rejects a document via the public link? Without notifications, they have to check the app manually.
2. **SMS document sharing** — Email works for sending public document links, but many contractors communicate with customers via text. Programmatic SMS (A2P) requires 10DLC registration, carrier filtering, TCPA compliance, and per-message costs — a regulatory and financial burden disproportionate to the value.

We initially explored React Native for a native mobile app. This was rejected: it would mean a second codebase for a B2B app that doesn't need native device APIs (NFC, Bluetooth, etc.), plus app store review overhead.

Progressive Web Apps (PWAs) solve both problems without a native app.

## Decisions

### 1. PWA is the mobile delivery mechanism

BnC ships as a Progressive Web App. Users install it via "Add to Home Screen" — no app store, no native build pipeline. The existing Next.js frontend gains a service worker and web app manifest.

**What this provides:**
- Home screen icon with native-feeling launch experience
- Background push notifications (Web Push API)
- Offline caching via service workers (useful for spotty field connectivity)
- Same codebase, same deployment, zero app store gatekeeping

**Known tradeoff:** iOS requires the PWA to be installed (Add to Home Screen) before push notifications work. This is an onboarding friction point we accept — we don't have user data to optimize for, and if it becomes a real problem, Capacitor (native shell wrapping the same web app) is an upgrade path that doesn't require a rewrite.

### 2. Push notifications for internal status changes

When a customer acts on a public document link (approves, rejects, disputes), the contractor who sent it receives a push notification.

**Scope:**
- Web Push API via service worker
- Backend manages push subscriptions per user/device
- Notifications triggered on document status events (the audit event infrastructure already exists)
- Notification content: document type, customer name, action taken

**Live page updates via service worker:**

When the SW receives a push event for a document status change (e.g. customer approved an quote), it can also post a message to any open app tab via `clients.matchAll()` + `client.postMessage()`. The tab receives the message and updates the displayed data in-place — the user sees the status flip to "Approved" without refreshing. This means the push notification system does double duty: background notifications when the app isn't focused, and live data updates when it is. The hook points already exist — the backend decision endpoints record status events that can trigger the push.

**Not in scope (yet):**
- Notification preferences / granularity settings
- In-app notification center / history
- Team-wide notifications (only the document owner is notified)

### 3. Web Share API replaces programmatic SMS

Instead of BnC sending SMS programmatically (A2P), the **user sends the message from their own device**. This completely sidesteps FCC/TCPA compliance because it's person-to-person communication, not application-to-person.

**Implementation:**
- "Share" button on document send flows calls `navigator.share()` on mobile (opens native share sheet — Messages, WhatsApp, etc.)
- Fallback: `sms:?body=...` URI to open Messages app with pre-populated text containing the public document link
- Desktop fallback: copy-to-clipboard with toast confirmation

**Why this is better than programmatic SMS:**
- Zero compliance burden (no 10DLC, no TCPA, no carrier filtering)
- Zero per-message cost
- Customer sees the message from their contractor's actual phone number — trust and recognition built in
- Works with any messaging platform, not just SMS

### 4. The entire app must work on mobile (carried forward)

Every flow must work on mobile. The UI adapts — desktop gets dense tables and inline editing, mobile gets stacked cards and simplified entry — but no flow is desktop-only.

This was established in `product-direction-refinement.md` and remains unchanged. PWA makes this feel native rather than "a website on a phone."

### 5. Payments: first-class feature, not a sync placeholder (carried forward)

Payments is the real thing, not a stand-in for QBO/gateway integration. Payment entry targets under 30 seconds from a phone. Core flow: "Got paid $X from [customer] via [method]. Done."

Carried forward from `product-direction-refinement.md`.

### 6. BnC is system of record; QBO is downstream mirror (carried forward)

Push-only sync (BnC → QBO). No bidirectional sync. Plaid bank feed is a future channel, architecturally distinct from QBO.

Carried forward from `product-direction-refinement.md`.

## What doesn't change

- **Backend financial model.** Immutable audit records, snapshot history, proper money handling — all stays.
- **Desktop power-user density.** Responsive doesn't mean dumbed-down.
- **Quote → CO → invoice → payment pipeline** is the core product.
- **Theme requirements.** Dark/light mode, public pages forced light.
- **Document templates idea** (unscoped). Pre-stored documents loaded into the creator — potential unlock for mobile-first document creation. Still idea phase.

## Alternatives considered

| Option | Verdict | Reason |
|--------|---------|--------|
| React Native | Rejected | Second codebase, app store overhead, no native APIs needed |
| Capacitor / Ionic | Deferred | Upgrade path if iOS PWA friction becomes a real problem. Wraps same web app in native shell — not a fork. |
| Programmatic SMS (Twilio, 10DLC) | Rejected | Regulatory burden (FCC/TCPA), carrier filtering, per-message cost — all solved better by user-initiated share |
| Email-only notifications | Insufficient | Not real-time, easily lost in inbox noise. Push is the right channel for time-sensitive status changes. |
| Native app (Flutter, etc.) | Rejected | Same problems as React Native. Different framework, same overhead. |

## Impact on existing documents

- `product-direction-refinement.md` — superseded by this document
- `DEFERRED_CUSTOMER_NOTIFICATIONS.md` — deleted. SMS section resolved by this decision; no-email customer handling was already implemented.
- `DEFERRED_PAYMENT_SYNC.md` — unchanged (QBO push-only and Plaid directions still valid)
- `mobile-desktop-strategy-v1.md` — already superseded (by product-direction-refinement, now transitively by this)
