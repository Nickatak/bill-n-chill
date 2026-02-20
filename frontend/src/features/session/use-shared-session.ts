"use client";

import { useMemo, useSyncExternalStore } from "react";

import { SESSION_CHANGE_EVENT, SESSION_STORAGE_KEY, type ClientSession } from "./client-session";

const NO_SHARED_SESSION_MESSAGE = "No shared session found. Go to / and login first.";

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener("focus", handler);
  window.addEventListener(SESSION_CHANGE_EVENT, handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("focus", handler);
    window.removeEventListener(SESSION_CHANGE_EVENT, handler);
  };
}

function getSnapshot() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(SESSION_STORAGE_KEY);
}

function getServerSnapshot() {
  return null;
}

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
      };
    } catch {
      return null;
    }
  }, [sessionSnapshot]);
  const token = session?.token ?? "";
  const authMessage = session
    ? `Using shared session for ${session.email || "user"}.`
    : NO_SHARED_SESSION_MESSAGE;

  return { token, authMessage };
}
