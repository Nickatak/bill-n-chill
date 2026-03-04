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

export type ClientSession = {
  token: string;
  email: string;
  role?: SessionRole;
  organization?: SessionOrganization;
  capabilities?: Capabilities;
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
  window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
}
