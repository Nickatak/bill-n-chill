/**
 * Client-side session persistence layer.
 *
 * Stores the authenticated session (token, email, role, org) in
 * localStorage under a versioned key. Changes are broadcast via a
 * custom DOM event so other tabs and the SessionAuthorizationProvider
 * can react immediately.
 */

export const SESSION_STORAGE_KEY = "bnc-session-v1";
export const SESSION_CHANGE_EVENT = "bnc-session-change";

export type SessionRole = "owner" | "pm" | "bookkeeping" | "worker" | "viewer";

export type SessionOrganization = {
  id: number;
  displayName: string;
  slug: string;
};

export type ClientSession = {
  token: string;
  email: string;
  role?: SessionRole;
  organization?: SessionOrganization;
};

/** Read the current session from localStorage. Returns null if absent, expired, or malformed. */
export function loadClientSession(): ClientSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ClientSession>;
    if (!parsed?.token) {
      return null;
    }
    return {
      token: parsed.token,
      email: parsed.email ?? "",
      role: parsed.role,
      organization: parsed.organization,
    };
  } catch {
    return null;
  }
}

/** Persist a session to localStorage and notify listeners (other tabs, providers). */
export function saveClientSession(session: ClientSession): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
}

/** Remove the session from localStorage and notify listeners. */
export function clearClientSession(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
  window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
}
