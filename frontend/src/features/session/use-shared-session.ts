"use client";

import { useSyncExternalStore } from "react";

import { loadClientSession } from "./client-session";

const NO_SHARED_SESSION_MESSAGE = "No shared session found. Go to / and login first.";

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener("focus", handler);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("focus", handler);
  };
}

function getSnapshot() {
  return loadClientSession();
}

function getServerSnapshot() {
  return null;
}

export function useSharedSessionAuth() {
  const session = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const token = session?.token ?? "";
  const authMessage = session
    ? `Using shared session for ${session.email || "user"}.`
    : NO_SHARED_SESSION_MESSAGE;

  return { token, authMessage };
}
