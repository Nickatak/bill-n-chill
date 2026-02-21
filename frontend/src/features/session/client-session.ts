export const SESSION_STORAGE_KEY = "bnc-session-v1";
export const SESSION_CHANGE_EVENT = "bnc-session-change";

export type ClientSession = {
  token: string;
  email: string;
  role?: "owner" | "pm" | "bookkeeping" | "viewer";
};

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
    };
  } catch {
    return null;
  }
}

export function saveClientSession(session: ClientSession): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
}

export function clearClientSession(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
  window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
}
