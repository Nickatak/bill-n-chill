export const SESSION_STORAGE_KEY = "bnc-session-v1";

export type ClientSession = {
  token: string;
  email: string;
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
}

export function clearClientSession(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}
