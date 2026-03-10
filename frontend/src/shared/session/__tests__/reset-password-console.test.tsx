import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

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

import { ResetPasswordConsole } from "../components/reset-password-console";

// ---------------------------------------------------------------------------
// Forgot password form (no token)
// ---------------------------------------------------------------------------

describe("ResetPasswordConsole — Forgot form", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows error when submitting with empty email", () => {
    render(<ResetPasswordConsole />);
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    expect(screen.getByText("Email is required.")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows confirmation screen on successful submission", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    render(<ResetPasswordConsole />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nick@test.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() => {
      expect(screen.getByText("Check your email")).toBeInTheDocument();
      expect(screen.getByText(/nick@test.com/)).toBeInTheDocument();
    });
  });

  it("shows error on rate limit", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });

    render(<ResetPasswordConsole />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nick@test.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Please wait before requesting another email."),
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Reset password form (with token)
// ---------------------------------------------------------------------------

describe("ResetPasswordConsole — Reset form", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockPush.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows error when submitting with empty passwords", () => {
    render(<ResetPasswordConsole token="reset-abc" />);
    fireEvent.click(screen.getByRole("button", { name: /reset password/i }));

    expect(screen.getByText("Both password fields are required.")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows error when passwords do not match", () => {
    render(<ResetPasswordConsole token="reset-abc" />);
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "longpassword1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "longpassword2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /reset password/i }));

    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows error when password is too short", () => {
    render(<ResetPasswordConsole token="reset-abc" />);
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: /reset password/i }));

    expect(screen.getByText("Password must be at least 8 characters.")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("saves session and redirects on successful reset", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            token: "new-session-token",
            user: { email: "nick@test.com", role: "owner" },
            organization: { id: 1, display_name: "Acme" },
          },
        }),
    });

    render(<ResetPasswordConsole token="reset-abc" />);
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "newsecurepass" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "newsecurepass" },
    });
    fireEvent.click(screen.getByRole("button", { name: /reset password/i }));

    await waitFor(() => {
      expect(screen.getByText(/Password updated/)).toBeInTheDocument();
    });
  });
});
