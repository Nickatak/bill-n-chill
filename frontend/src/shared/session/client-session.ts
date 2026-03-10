/**
 * Client-side session persistence layer.
 *
 * Stores the authenticated session (token, email, role, org) in
 * localStorage under a versioned key. Changes are broadcast via a
 * custom DOM event so other tabs and the SessionAuthorizationProvider
 * can react immediately.
 */

export const SESSION_STORAGE_KEY = "bnc-session-v1";
export const REAL_SESSION_STORAGE_KEY = "bnc-real-session-v1";
export const SESSION_CHANGE_EVENT = "bnc-session-change";

export type SessionRole = "owner" | "pm" | "bookkeeping" | "worker" | "viewer";

export type SessionOrganization = {
  id: number;
  displayName: string;
  onboardingCompleted: boolean;
};

export type Capabilities = Record<string, string[]>;

/**
 * Structural validation for capabilities from API/localStorage.
 * Returns the capabilities if valid, undefined if malformed.
 * Logs a warning on malformed data for debuggability.
 */
function validateCapabilities(raw: unknown): Capabilities | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    console.warn("[session] Malformed capabilities: expected object, got", typeof raw);
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
      console.warn(`[session] Malformed capabilities.${key}: expected string[], got`, value);
      return undefined;
    }
  }
  return obj as Capabilities;
}

export type ImpersonationInfo = {
  active: boolean;
  realEmail: string;
};

export type ClientSession = {
  token: string;
  email: string;
  role?: SessionRole;
  organization?: SessionOrganization;
  capabilities?: Capabilities;
  isSuperuser?: boolean;
  impersonation?: ImpersonationInfo;
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
      capabilities: validateCapabilities(parsed.capabilities),
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
  window.localStorage.removeItem(REAL_SESSION_STORAGE_KEY);
  window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
}

/** Stash the current session and activate an impersonation session. */
export function startImpersonation(impersonationSession: ClientSession): void {
  if (typeof window === "undefined") {
    return;
  }
  const current = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (current) {
    window.localStorage.setItem(REAL_SESSION_STORAGE_KEY, current);
  }
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(impersonationSession));
  window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
}

/** Restore the real session and discard the impersonation session. */
export function exitImpersonation(): void {
  if (typeof window === "undefined") {
    return;
  }
  const real = window.localStorage.getItem(REAL_SESSION_STORAGE_KEY);
  if (real) {
    window.localStorage.setItem(SESSION_STORAGE_KEY, real);
    window.localStorage.removeItem(REAL_SESSION_STORAGE_KEY);
  } else {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }
  window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
}

/** Check if an impersonation session is currently active. */
export function isImpersonating(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(REAL_SESSION_STORAGE_KEY) !== null;
}
