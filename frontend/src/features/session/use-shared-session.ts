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
  type Capabilities,
  type ClientSession,
  type SessionRole,
} from "./client-session";

const NO_SHARED_SESSION_MESSAGE = "No shared session found. Go to / and login first.";

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
  return window.localStorage.getItem(SESSION_STORAGE_KEY);
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
  const sessionSnapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const session = useMemo<ClientSession | null>(() => {
    if (!sessionSnapshot) {
      return null;
    }
    try {
      const parsed = JSON.parse(sessionSnapshot) as Partial<ClientSession>;
      if (!parsed?.token) {
        return null;
      }
      return {
        token: parsed.token,
        email: parsed.email ?? "",
        role: parsed.role,
        organization: parsed.organization,
        capabilities: parsed.capabilities,
      };
    } catch {
      return null;
    }
  }, [sessionSnapshot]);

  const token = session?.token ?? "";
  const role: SessionRole = session?.role || "owner";
  const organization = session?.organization ?? null;
  const capabilities: Capabilities | undefined = session?.capabilities;
  const orgLabel = organization?.displayName || "";
  const authMessage = session
    ? `Using shared session for ${session.email || "user"} (${role})${orgLabel ? ` in ${orgLabel}` : ""}.`
    : NO_SHARED_SESSION_MESSAGE;

  const email = session?.email ?? "";

  return { token, email, authMessage, role, organization, capabilities };
}
