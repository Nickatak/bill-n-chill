/**
 * Reactive hook that subscribes to the session in localStorage.
 *
 * Uses `useSyncExternalStore` to listen for both same-tab custom events
 * (SESSION_CHANGE_EVENT from save/clear) and cross-tab `storage` events,
 * so the UI stays in sync regardless of where the session changes.
 */
"use client";

import { useMemo, useSyncExternalStore } from "react";

import {
  SESSION_CHANGE_EVENT,
  SESSION_STORAGE_KEY,
  REAL_SESSION_STORAGE_KEY,
  type Capabilities,
  type ClientSession,
  type ImpersonationInfo,
  type SessionRole,
} from "./client-session";

const NO_SHARED_SESSION_MESSAGE = "No shared session found. Go to /login and sign in first.";

/** Subscribe to localStorage changes from both same-tab and cross-tab sources. */
function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(SESSION_CHANGE_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(SESSION_CHANGE_EVENT, handler);
  };
}

/** Read the raw session JSON from localStorage (client-side only). */
function getSnapshot() {
  if (typeof window === "undefined") {
    return null;
  }
  // Combine both keys into one snapshot string so changes to either trigger re-render.
  const session = window.localStorage.getItem(SESSION_STORAGE_KEY);
  const real = window.localStorage.getItem(REAL_SESSION_STORAGE_KEY);
  return JSON.stringify({ session, real });
}

/** Server-side snapshot — always null since localStorage doesn't exist on the server. */
function getServerSnapshot() {
  return null;
}

/**
 * Hook that reactively reads the session from localStorage and returns
 * the parsed token, role, organization, and a human-readable auth message.
 */
export function useSharedSessionAuth() {
  const combinedSnapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const { session, isImpersonating } = useMemo<{
    session: ClientSession | null;
    isImpersonating: boolean;
  }>(() => {
    if (!combinedSnapshot) {
      return { session: null, isImpersonating: false };
    }
    try {
      const { session: sessionRaw, real: realRaw } = JSON.parse(combinedSnapshot) as {
        session: string | null;
        real: string | null;
      };
      const hasRealSession = realRaw !== null;
      if (!sessionRaw) {
        return { session: null, isImpersonating: false };
      }
      const parsed = JSON.parse(sessionRaw) as Partial<ClientSession>;
      if (!parsed?.token) {
        return { session: null, isImpersonating: false };
      }
      return {
        session: {
          token: parsed.token,
          email: parsed.email ?? "",
          role: parsed.role,
          organization: parsed.organization,
          capabilities: parsed.capabilities,
          isSuperuser: parsed.isSuperuser,
          impersonation: parsed.impersonation,
        },
        isImpersonating: hasRealSession,
      };
    } catch {
      return { session: null, isImpersonating: false };
    }
  }, [combinedSnapshot]);

  const token = session?.token ?? "";
  const role: SessionRole = session?.role || "owner";
  const organization = session?.organization ?? null;
  const capabilities: Capabilities | undefined = session?.capabilities;
  const isSuperuser = session?.isSuperuser ?? false;
  const impersonation: ImpersonationInfo | undefined = session?.impersonation;
  const orgLabel = organization?.displayName || "";
  const authMessage = session
    ? `Using shared session for ${session.email || "user"} (${role})${orgLabel ? ` in ${orgLabel}` : ""}.`
    : NO_SHARED_SESSION_MESSAGE;

  const email = session?.email ?? "";

  return { token, email, authMessage, role, organization, capabilities, isSuperuser, isImpersonating, impersonation };
}
