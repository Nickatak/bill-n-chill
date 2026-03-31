import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks — hoisted values so mock factories can reference them.
// ---------------------------------------------------------------------------

const mockReplace = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/projects"),
  useRouter: vi.fn(() => ({ replace: mockReplace })),
}));

vi.mock("@/shared/session/session-authorization", () => ({
  useSessionAuthorization: vi.fn(() => ({
    isAuthorized: false,
    isChecking: true,
    status: "checking" as const,
    token: "",
    role: "owner" as const,
    capabilities: undefined,
    organization: null,
    authMessage: "",
    isRefreshing: false,
    isSuperuser: false,
    isImpersonating: false,
    impersonation: undefined,
  })),
}));

import { usePathname } from "next/navigation";
import { useSessionAuthorization } from "@/shared/session/session-authorization";
import { AuthGate } from "../auth-gate";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setAuthState(overrides: Partial<ReturnType<typeof useSessionAuthorization>>) {
  vi.mocked(useSessionAuthorization).mockReturnValue({
    isAuthorized: false,
    isChecking: true,
    status: "checking",
    token: "",
    role: "owner",
    capabilities: undefined,
    organization: null,
    authMessage: "",
    isRefreshing: false,
    isSuperuser: false,
    isImpersonating: false,
    impersonation: undefined,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// AuthGate
// ---------------------------------------------------------------------------

describe("AuthGate", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockReplace.mockClear();
    vi.mocked(usePathname).mockReturnValue("/projects");
  });

  it("renders children immediately for public auth routes", () => {
    vi.mocked(usePathname).mockReturnValue("/login");
    setAuthState({ isChecking: true, isAuthorized: false });

    render(
      <AuthGate>
        <div data-testid="child">Content</div>
      </AuthGate>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("renders children for public document routes regardless of auth state", () => {
    vi.mocked(usePathname).mockReturnValue("/quote/slug--aBcDeFgH");
    setAuthState({ isChecking: false, isAuthorized: false, status: "unauthorized" });

    render(
      <AuthGate>
        <div data-testid="child">Public Preview</div>
      </AuthGate>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("renders nothing while checking on protected routes", () => {
    setAuthState({ isChecking: true, isAuthorized: false, status: "checking" });

    const { container } = render(
      <AuthGate>
        <div data-testid="child">Protected</div>
      </AuthGate>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing and redirects to /login when unauthorized", () => {
    setAuthState({ isChecking: false, isAuthorized: false, status: "unauthorized" });

    const { container } = render(
      <AuthGate>
        <div data-testid="child">Protected</div>
      </AuthGate>,
    );
    expect(container.innerHTML).toBe("");
    expect(mockReplace).toHaveBeenCalledWith("/login");
  });

  it("renders children when authorized on protected routes", () => {
    setAuthState({
      isChecking: false,
      isAuthorized: true,
      status: "authorized",
      token: "abc",
    });

    render(
      <AuthGate>
        <div data-testid="child">Dashboard</div>
      </AuthGate>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});
