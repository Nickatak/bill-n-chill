# Hydration Race: False Auth Redirect on New Tab

**Date:** 2026-03-13
**Severity:** UX bug — new tabs redirected to /dashboard instead of the target page
**Status:** Fixed

## Symptom

Middle-clicking (or ctrl+clicking) any `<Link>` to open a new tab caused the **new tab** to briefly flash the target page, then redirect to `/dashboard`. The original tab was unaffected.

## Root Cause

A race condition between `useSyncExternalStore` hydration and `useEffect` execution in `SessionAuthorizationProvider`.

### The chain

1. User middle-clicks a link → browser opens a new tab at the target URL
2. Next.js server-renders the page. During SSR, `useSyncExternalStore` calls `getServerSnapshot()`, which returns `null` (no `localStorage` on the server). Token is `""`, organization is `null`.
3. The browser receives the HTML and React begins hydration.
4. **Effects fire.** `SessionAuthorizationProvider`'s effect runs with the server snapshot values (`token = ""`).
5. The effect hits the `!token` branch → immediately sets `status = "unauthorized"`.
6. `AuthGate`'s effect fires next, sees `isChecking: false, isAuthorized: false` → calls `router.replace("/login")`.
7. The login page detects the user IS authorized (localStorage session exists, `useSyncExternalStore` has caught up by now) → redirects to `/dashboard`.

### Why `useSyncExternalStore` didn't prevent this

`useSyncExternalStore` is supposed to detect server/client snapshot mismatches during hydration and trigger a synchronous re-render before effects fire. In practice, with React 19 + Next.js 16 App Router, the effect fired with the stale server snapshot values. Whether this is a framework bug or an expected edge case with the streaming/RSC hydration model is unclear — but the effect must defend against it regardless.

## Fix

In the `!token` branch of the `SessionAuthorizationProvider` effect, check `localStorage` directly via `loadClientSession()` before committing to "unauthorized":

```tsx
if (!token) {
  // During SSR hydration, useSyncExternalStore may briefly return the
  // server snapshot (null) before switching to the client snapshot.
  // Check localStorage directly to avoid a false "unauthorized" redirect
  // when a real session exists but hasn't hydrated yet.
  if (loadClientSession()?.token) {
    return () => { cancelled = true; };
  }
  verifiedTokenRef.current = "";
  setIsRefreshing(false);
  setStatus("unauthorized");
  return () => { cancelled = true; };
}
```

If localStorage has a session, the effect stays in `"checking"` (the initial state) and returns. The next render cycle — after `useSyncExternalStore` hydrates with the real client snapshot — provides the actual token and proceeds with normal verification.

## Files Changed

- `frontend/src/shared/session/session-authorization.tsx` — added localStorage fallback check in `!token` branch

## Takeaway: Defensive Rules for `useSyncExternalStore` + Effects

1. **Never trust the hook value alone in effects that gate redirects or destructive state transitions.** If the effect acts on a value that differs between server and client (like anything from `localStorage`, `window`, cookies), verify against the raw source before committing.

2. **`getServerSnapshot()` returning `null` is a hydration landmine.** Any effect that branches on "value is falsy → take irreversible action" is vulnerable. The effect doesn't know whether the value is falsy because the user is genuinely unauthenticated or because hydration hasn't caught up yet.

3. **The pattern to remember:** Before any effect sets a terminal state (unauthorized, error, redirect), ask: "Could this value be stale from SSR?" If yes, cross-check against the raw source (`localStorage`, `document.cookie`, etc.) before acting.

4. **This applies to any `useSyncExternalStore` consumer**, not just auth. If you add another external store (theme preference, feature flags, locale), the same race exists for any effect that reads from it and takes action on the first render.
