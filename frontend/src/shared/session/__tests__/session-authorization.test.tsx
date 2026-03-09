import { type ReactNode } from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import {
  SessionAuthorizationProvider,
  useSessionAuthorization,
} from "../session-authorization";
import { SESSION_STORAGE_KEY } from "../client-session";

// ---------------------------------------------------------------------------
// Global fetch mock — stub before any module-level code in the SUT calls it.
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SessionAuthorizationProvider>{children}</SessionAuthorizationProvider>
  );
}

function setSession(data: Record<string, unknown>) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
}

function okMeResponse(capabilities?: Record<string, string[]>) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ data: { capabilities } }),
  };
}

function failResponse(status: number) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
  };
}

const VALID_SESSION = {
  token: "test-token",
  email: "nick@test.com",
  role: "owner",
  organization: { id: 1, displayName: "Acme", onboardingCompleted: true },
  capabilities: { estimates: ["view", "create"] },
};

// ---------------------------------------------------------------------------
// SessionAuthorizationProvider
// ---------------------------------------------------------------------------

describe("SessionAuthorizationProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetch.mockReset();
  });

  it("starts in checking while verification is in flight", () => {
    setSession(VALID_SESSION);
    mockFetch.mockImplementation(() => new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useSessionAuthorization(), { wrapper });
    expect(result.current.isChecking).toBe(true);
    expect(result.current.status).toBe("checking");
  });

  it("transitions to authorized on successful /auth/me/ response", async () => {
    setSession(VALID_SESSION);
    mockFetch.mockResolvedValueOnce(okMeResponse({ estimates: ["view"] }));

    const { result } = renderHook(() => useSessionAuthorization(), { wrapper });
    await waitFor(() => expect(result.current.isAuthorized).toBe(true));
    expect(result.current.token).toBe("test-token");
    expect(result.current.role).toBe("owner");
  });

  it("clears session and goes unauthorized on 401", async () => {
    setSession(VALID_SESSION);
    mockFetch.mockResolvedValueOnce(failResponse(401));

    const { result } = renderHook(() => useSessionAuthorization(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthorized"));
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("clears session and goes unauthorized on 403", async () => {
    setSession(VALID_SESSION);
    mockFetch.mockResolvedValueOnce(failResponse(403));

    const { result } = renderHook(() => useSessionAuthorization(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthorized"));
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("goes unauthorized on network error without clearing session", async () => {
    setSession(VALID_SESSION);
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useSessionAuthorization(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthorized"));
    // Session preserved — only explicit auth failures (401/403) clear it.
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
  });

  it("is immediately unauthorized when no token exists", async () => {
    // No session in localStorage.
    const { result } = renderHook(() => useSessionAuthorization(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthorized"));
    expect(result.current.token).toBe("");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("persists refreshed capabilities from /me response to localStorage", async () => {
    setSession(VALID_SESSION);
    const fresh = { invoices: ["view", "create"], estimates: ["view"] };
    mockFetch.mockResolvedValueOnce(okMeResponse(fresh));

    const { result } = renderHook(() => useSessionAuthorization(), { wrapper });
    await waitFor(() => expect(result.current.isAuthorized).toBe(true));

    const stored = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY)!);
    expect(stored.capabilities).toEqual(fresh);
  });
});

// ---------------------------------------------------------------------------
// useSessionAuthorization (standalone)
// ---------------------------------------------------------------------------

describe("useSessionAuthorization", () => {
  it("throws when used outside SessionAuthorizationProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useSessionAuthorization())).toThrow(
      "useSessionAuthorization must be used within SessionAuthorizationProvider.",
    );
    spy.mockRestore();
  });
});
