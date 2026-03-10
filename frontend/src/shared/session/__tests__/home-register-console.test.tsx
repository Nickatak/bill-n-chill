import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

import { SESSION_STORAGE_KEY } from "../client-session";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = vi.hoisted(() => vi.fn());
const mockReplace = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: mockPush, replace: mockReplace })),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

vi.stubGlobal("fetch", mockFetch);

import { HomeRegisterConsole } from "../components/home-register-console";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HEALTHY = { ok: true, message: "" };

function verifyInviteResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        data: {
          organization_name: "Acme Corp",
          email: "nick@test.com",
          role: "pm",
          is_existing_user: false,
          ...overrides,
        },
      }),
  };
}

function authSuccessResponse(
  overrides: Record<string, unknown> = {},
) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        data: {
          token: "new-token",
          user: { email: "nick@test.com", role: "pm" },
          organization: { id: 2, display_name: "Acme Corp" },
          capabilities: { estimates: ["view"] },
          ...overrides,
        },
      }),
  };
}

// ---------------------------------------------------------------------------
// Flow A — Standard registration (no invite)
// ---------------------------------------------------------------------------

describe("HomeRegisterConsole — Flow A (standard)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetch.mockReset();
    mockPush.mockClear();
    mockReplace.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows 'check your email' screen on successful registration", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: { message: "Please verify your email." },
        }),
    });

    render(<HomeRegisterConsole health={HEALTHY} />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nick@test.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "securepass" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText("Check your email")).toBeInTheDocument();
      expect(screen.getByText(/nick@test.com/)).toBeInTheDocument();
    });
  });

  it("shows error message on registration failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          error: { message: "A user with this email already exists." },
        }),
    });

    render(<HomeRegisterConsole health={HEALTHY} />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "existing@test.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "securepass" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(
        screen.getByText("A user with this email already exists."),
      ).toBeInTheDocument();
    });
  });

  it("redirects authenticated users to home", () => {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ token: "existing", email: "nick@test.com" }),
    );

    render(<HomeRegisterConsole health={HEALTHY} />);
    expect(mockReplace).toHaveBeenCalledWith("/dashboard");
  });

  it("shows error when submitting with empty email", () => {
    render(<HomeRegisterConsole health={HEALTHY} />);
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(screen.getByText("Email is required.")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows error when submitting with email but no password", () => {
    render(<HomeRegisterConsole health={HEALTHY} />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nick@test.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(screen.getByText("Password is required.")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows error when password is too short", () => {
    render(<HomeRegisterConsole health={HEALTHY} />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nick@test.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(screen.getByText("Password must be at least 8 characters.")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Flow B — New user accepting an invite
// ---------------------------------------------------------------------------

describe("HomeRegisterConsole — Flow B (new user invite)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetch.mockReset();
    mockPush.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("verifies invite and shows context banner, then register saves session", async () => {
    // First fetch: verify invite
    mockFetch.mockResolvedValueOnce(verifyInviteResponse());
    // Second fetch: register
    mockFetch.mockResolvedValueOnce(authSuccessResponse());

    render(<HomeRegisterConsole health={HEALTHY} inviteToken="invite-abc" />);

    // Wait for invite verification to render the banner
    await waitFor(() => {
      expect(screen.getByText(/You're Invited/)).toBeInTheDocument();
      expect(screen.getByText(/Acme Corp/)).toBeInTheDocument();
    });

    // Email pre-filled from invite, fill password and submit
    expect(screen.getByLabelText("Email")).toHaveValue("nick@test.com");
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "securepass" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /create account & join/i }),
    );

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard");
    });

    const stored = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY)!);
    expect(stored.token).toBe("new-token");
  });
});

// ---------------------------------------------------------------------------
// Flow C — Existing user accepting an invite (org switch)
// ---------------------------------------------------------------------------

describe("HomeRegisterConsole — Flow C (existing user invite)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetch.mockReset();
    mockPush.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows org switch warning and accepts invite on password confirm", async () => {
    // First fetch: verify invite (existing user)
    mockFetch.mockResolvedValueOnce(
      verifyInviteResponse({ is_existing_user: true }),
    );
    // Second fetch: accept invite
    mockFetch.mockResolvedValueOnce(authSuccessResponse());

    render(<HomeRegisterConsole health={HEALTHY} inviteToken="invite-xyz" />);

    await waitFor(() => {
      expect(screen.getByText("Organization Switch")).toBeInTheDocument();
      expect(
        screen.getByText(/lose access to your current org/),
      ).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Confirm Password"), {
      target: { value: "mypassword" },
    });
    fireEvent.click(screen.getByRole("button", { name: /accept invite/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard");
    });

    const stored = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY)!);
    expect(stored.token).toBe("new-token");
  });

  it("shows error when submitting with empty password", async () => {
    mockFetch.mockResolvedValueOnce(
      verifyInviteResponse({ is_existing_user: true }),
    );

    render(<HomeRegisterConsole health={HEALTHY} inviteToken="invite-xyz" />);

    await waitFor(() => {
      expect(screen.getByText("Organization Switch")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /accept invite/i }));

    expect(screen.getByText("Password is required.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Invite errors
// ---------------------------------------------------------------------------

describe("HomeRegisterConsole — invite errors", () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows error for expired invite (410)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 410,
      json: () =>
        Promise.resolve({
          error: { message: "This invite has already been used." },
        }),
    });

    render(<HomeRegisterConsole health={HEALTHY} inviteToken="used-invite" />);

    await waitFor(() => {
      expect(
        screen.getByText("This invite has already been used."),
      ).toBeInTheDocument();
    });
  });

  it("shows error for invalid invite link", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    });

    render(<HomeRegisterConsole health={HEALTHY} inviteToken="bad-token" />);

    await waitFor(() => {
      expect(
        screen.getByText("This invite link is not valid."),
      ).toBeInTheDocument();
    });
  });
});
