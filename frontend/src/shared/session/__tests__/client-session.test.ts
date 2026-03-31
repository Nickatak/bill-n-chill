import { describe, expect, it, beforeEach, vi } from "vitest";

import {
  SESSION_CHANGE_EVENT,
  SESSION_STORAGE_KEY,
  clearClientSession,
  loadClientSession,
  saveClientSession,
} from "../client-session";

// ---------------------------------------------------------------------------
// loadClientSession
// ---------------------------------------------------------------------------

describe("loadClientSession", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when localStorage is empty", () => {
    expect(loadClientSession()).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    localStorage.setItem(SESSION_STORAGE_KEY, "not-json{{{");
    expect(loadClientSession()).toBeNull();
  });

  it("returns null when token is missing", () => {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ email: "a@b.com" }),
    );
    expect(loadClientSession()).toBeNull();
  });

  it("parses a valid session with all fields", () => {
    const session = {
      token: "abc123",
      email: "nick@test.com",
      role: "owner",
      organization: { id: 1, displayName: "Acme", onboardingCompleted: true },
      capabilities: { quotes: ["view", "create"] },
    };
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    expect(loadClientSession()).toEqual(session);
  });

  it("defaults email to empty string when absent", () => {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ token: "abc" }),
    );
    expect(loadClientSession()?.email).toBe("");
  });

  it("rejects capabilities that are not an object", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ token: "abc", capabilities: "bad" }),
    );
    expect(loadClientSession()?.capabilities).toBeUndefined();
    spy.mockRestore();
  });

  it("rejects capabilities with non-string-array values", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ token: "abc", capabilities: { quotes: [1, 2] } }),
    );
    expect(loadClientSession()?.capabilities).toBeUndefined();
    spy.mockRestore();
  });

  it("accepts capabilities with an empty object (no resources)", () => {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ token: "abc", capabilities: {} }),
    );
    expect(loadClientSession()?.capabilities).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// saveClientSession
// ---------------------------------------------------------------------------

describe("saveClientSession", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists session to localStorage", () => {
    const session = { token: "abc", email: "nick@test.com" };
    saveClientSession(session);
    expect(JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY)!)).toEqual(
      session,
    );
  });

  it("dispatches SESSION_CHANGE_EVENT", () => {
    const handler = vi.fn();
    window.addEventListener(SESSION_CHANGE_EVENT, handler);
    saveClientSession({ token: "abc", email: "" });
    expect(handler).toHaveBeenCalledOnce();
    window.removeEventListener(SESSION_CHANGE_EVENT, handler);
  });
});

// ---------------------------------------------------------------------------
// clearClientSession
// ---------------------------------------------------------------------------

describe("clearClientSession", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("removes session from localStorage", () => {
    localStorage.setItem(SESSION_STORAGE_KEY, "something");
    clearClientSession();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("dispatches SESSION_CHANGE_EVENT", () => {
    const handler = vi.fn();
    window.addEventListener(SESSION_CHANGE_EVENT, handler);
    clearClientSession();
    expect(handler).toHaveBeenCalledOnce();
    window.removeEventListener(SESSION_CHANGE_EVENT, handler);
  });
});
