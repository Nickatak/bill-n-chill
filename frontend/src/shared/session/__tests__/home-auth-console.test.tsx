import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

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

import { HomeAuthConsole } from "../components/home-auth-console";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HEALTHY = { ok: true, message: "" };

function fillAndSubmitLogin(email: string, password: string) {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

// ---------------------------------------------------------------------------
// HomeAuthConsole
// ---------------------------------------------------------------------------

describe("HomeAuthConsole", () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetch.mockReset();
    mockPush.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("pre-fills email from a stored session", () => {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ token: "old", email: "nick@test.com" }),
    );

    render(<HomeAuthConsole health={HEALTHY} />);
    expect(screen.getByLabelText("Email")).toHaveValue("nick@test.com");
  });

  it("saves session and navigates on successful login", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            token: "login-token",
            user: { email: "nick@test.com", role: "owner" },
            organization: { id: 1, display_name: "Acme" },
            capabilities: { estimates: ["view", "create"] },
          },
        }),
    });

    render(<HomeAuthConsole health={HEALTHY} />);
    fillAndSubmitLogin("nick@test.com", "password123");

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard");
    });

    const stored = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY)!);
    expect(stored.token).toBe("login-token");
    expect(stored.email).toBe("nick@test.com");
  });

  it("shows normalized error on bad credentials", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({ error: { message: "Login failed." } }),
    });

    render(<HomeAuthConsole health={HEALTHY} />);
    fillAndSubmitLogin("nick@test.com", "wrong");

    await waitFor(() => {
      expect(
        screen.getByText("Invalid username/password combination."),
      ).toBeInTheDocument();
    });
  });

  it("shows resend button when email is not verified", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          error: { code: "email_not_verified", message: "Not verified." },
        }),
    });

    render(<HomeAuthConsole health={HEALTHY} />);
    fillAndSubmitLogin("nick@test.com", "pass");

    await waitFor(() => {
      expect(
        screen.getByText("Please verify your email before signing in."),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /resend verification/i }),
      ).toBeInTheDocument();
    });
  });

  it("shows error on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    render(<HomeAuthConsole health={HEALTHY} />);
    fillAndSubmitLogin("nick@test.com", "pass");

    await waitFor(() => {
      expect(
        screen.getByText("Could not reach login endpoint."),
      ).toBeInTheDocument();
    });
  });

  it("shows health warning when backend is down", () => {
    render(
      <HomeAuthConsole
        health={{ ok: false, message: "Could not reach backend." }}
      />,
    );
    expect(screen.getByText(/API Health/)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Empty-field validation
  // ---------------------------------------------------------------------------

  it("shows error when submitting with empty email", () => {
    render(<HomeAuthConsole health={HEALTHY} />);
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(screen.getByText("Email is required.")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows error when submitting with email but no password", () => {
    render(<HomeAuthConsole health={HEALTHY} />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nick@test.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(screen.getByText("Password is required.")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
