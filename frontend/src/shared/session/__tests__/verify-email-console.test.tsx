import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { SESSION_STORAGE_KEY } from "../client-session";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: mockPush, replace: vi.fn() })),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

vi.stubGlobal("fetch", mockFetch);

import { VerifyEmailConsole } from "../components/verify-email-console";

// ---------------------------------------------------------------------------
// VerifyEmailConsole
// ---------------------------------------------------------------------------

describe("VerifyEmailConsole", () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetch.mockReset();
    mockPush.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows error immediately when no token is provided", () => {
    render(<VerifyEmailConsole />);
    expect(screen.getByText("Verification Failed")).toBeInTheDocument();
    expect(
      screen.getByText("No verification token provided."),
    ).toBeInTheDocument();
  });

  it("shows verifying state while fetch is in flight", () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    render(<VerifyEmailConsole token="abc123" />);
    expect(screen.getByText("Verifying your email...")).toBeInTheDocument();
  });

  it("saves session and shows success on valid token", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            token: "session-token",
            user: { email: "nick@test.com", role: "owner" },
            organization: { id: 1, display_name: "Acme" },
            capabilities: { estimates: ["view"] },
          },
        }),
    });

    render(<VerifyEmailConsole token="valid-token" />);

    await waitFor(() => {
      expect(screen.getByText(/Email confirmed/)).toBeInTheDocument();
    });

    const stored = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY)!);
    expect(stored.token).toBe("session-token");
    expect(stored.email).toBe("nick@test.com");
  });

  it("redirects to dashboard after success delay", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: { token: "t", user: { email: "a@b.com" } },
          }),
      }),
    );

    render(<VerifyEmailConsole token="valid" />);

    await waitFor(() => {
      expect(screen.getByText(/Email confirmed/)).toBeInTheDocument();
    });

    // Real setTimeout(2500) — wait for it to fire.
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard"), {
      timeout: 4000,
    });
  });

  it("shows error on API failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({ error: { message: "Token has expired." } }),
    });

    render(<VerifyEmailConsole token="expired" />);

    await waitFor(() => {
      expect(screen.getByText("Verification Failed")).toBeInTheDocument();
      expect(screen.getByText("Token has expired.")).toBeInTheDocument();
    });
  });

  it("shows consumed-token message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          error: {
            code: "consumed",
            message: "This link is no longer active. If you\u2019ve already verified, sign in instead.",
          },
        }),
    });

    render(<VerifyEmailConsole token="used-token" />);

    await waitFor(() => {
      expect(screen.getByText("Verification Failed")).toBeInTheDocument();
      expect(
        screen.getByText(/no longer active/),
      ).toBeInTheDocument();
    });
  });

  it("shows expired-token message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          error: {
            code: "expired",
            message: "This verification link has expired. Request a new one.",
          },
        }),
    });

    render(<VerifyEmailConsole token="old-token" />);

    await waitFor(() => {
      expect(screen.getByText("Verification Failed")).toBeInTheDocument();
      expect(
        screen.getByText("This verification link has expired. Request a new one."),
      ).toBeInTheDocument();
    });
  });

  it("shows error on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    render(<VerifyEmailConsole token="any" />);

    await waitFor(() => {
      expect(screen.getByText("Verification Failed")).toBeInTheDocument();
      expect(
        screen.getByText("Could not reach the server."),
      ).toBeInTheDocument();
    });
  });
});
