# PWA Implementation — Needs Review

**Status:** Scaffolded, not yet reviewed by Nick.

## What was implemented
- Web App Manifest (`app/manifest.ts`) — standalone display, theme colors, icons
- Service Worker (`public/sw.js`) — cache-first for shell/assets, network-only for API, push notification plumbing
- Offline fallback page (`app/offline/page.tsx`)
- SW registration component (`shared/pwa/service-worker-registration.tsx`)
- Root layout wired up: viewport export, apple web app meta, favicon/icon links
- Generated icons: 32px favicon, 180px apple-touch, 192px + 512px PWA icons (steel-blue "B" with green dollar accent)

## Needs review
- [ ] Icon design — placeholder generated via Pillow, likely want real branding
- [ ] Service worker caching strategy — currently conservative (network-only for API, stale-while-revalidate for JS/CSS bundles). May want to tune for field worker use case
- [ ] Offline page UX — bare minimum right now
- [ ] Push notification payloads — SW handles them, but backend subscription endpoints don't exist yet
- [ ] Theme color (`#374b6e`) — matches generated icon, confirm against actual brand

## Related
- Decision doc exists (Nick mentioned it, location TBD)
- Backend push subscription management is deferred
