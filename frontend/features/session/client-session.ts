export const SESSION_STORAGE_KEY = 'template-session-v1';
export const SESSION_CHANGE_EVENT = 'template-session-change';

const LEGACY_ACCESS_TOKEN_KEY = 'accessToken';
const LEGACY_REFRESH_TOKEN_KEY = 'refreshToken';

export type ClientSession = {
  token: string;
  refreshToken?: string;
  email?: string;
};

function dispatchSessionChange(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new Event(SESSION_CHANGE_EVENT));
}

export function loadClientSession(): ClientSession | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<ClientSession>;
      if (parsed?.token) {
        return {
          token: parsed.token,
          refreshToken: parsed.refreshToken,
          email: parsed.email,
        };
      }
    } catch {
      // Fall through to legacy token keys.
    }
  }

  const legacyToken = window.localStorage.getItem(LEGACY_ACCESS_TOKEN_KEY);
  if (!legacyToken) {
    return null;
  }

  return {
    token: legacyToken,
    refreshToken: window.localStorage.getItem(LEGACY_REFRESH_TOKEN_KEY) ?? undefined,
  };
}

export function saveClientSession(session: ClientSession): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  window.localStorage.setItem(LEGACY_ACCESS_TOKEN_KEY, session.token);

  if (session.refreshToken) {
    window.localStorage.setItem(LEGACY_REFRESH_TOKEN_KEY, session.refreshToken);
  } else {
    window.localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY);
  }

  dispatchSessionChange();
}

export function clearClientSession(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(SESSION_STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY);

  dispatchSessionChange();
}
