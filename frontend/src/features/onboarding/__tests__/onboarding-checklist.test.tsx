import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
const mockLoadClientSession = vi.hoisted(() => vi.fn());
const mockSaveClientSession = vi.hoisted(() => vi.fn());

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

vi.mock("@/shared/session/use-shared-session", () => ({
  useSharedSessionAuth: vi.fn(() => ({
    token: "test-token",
    email: "nick@test.com",
    authMessage: "Using shared session for nick@test.com (owner).",
    role: "owner",
    organization: null,
    capabilities: {},
  })),
}));

vi.mock("@/shared/session/client-session", () => ({
  loadClientSession: mockLoadClientSession,
  saveClientSession: mockSaveClientSession,
}));

vi.mock("@/shared/onboarding/guide-arrow-overlay", () => ({
  GuideArrowOverlay: () => <div data-testid="guide-arrow-overlay" />,
}));

vi.stubGlobal("fetch", mockFetch);

import { OnboardingChecklist, ORG_VISITED_KEY } from "../components/onboarding-checklist";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mock all progress-check endpoints as returning empty arrays (no progress). */
function setupEmptyProgress() {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data: [] }),
  });
}

/** Mock progress-check endpoints with some entities present. */
function setupPartialProgress(overrides: { customers?: boolean; projects?: boolean; invoices?: boolean } = {}) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/customers/") && overrides.customers) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 1, display_name: "Jane Doe" }] }),
      });
    }
    if (url.includes("/projects/") && overrides.projects) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 5, name: "Kitchen Remodel" }] }),
      });
    }
    if (url.includes("/invoices/") && overrides.invoices) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 10, status: "draft" }] }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OnboardingChecklist", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockPush.mockClear();
    mockLoadClientSession.mockReturnValue(null);
    mockSaveClientSession.mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders with Remodelers / GCs tab active by default", async () => {
    setupEmptyProgress();
    render(<OnboardingChecklist />);

    await waitFor(() => {
      expect(screen.queryByText("Checking progress\u2026")).not.toBeInTheDocument();
    });

    // Remodeler-specific steps visible
    expect(screen.getByText("Handle a change order")).toBeInTheDocument();
    expect(screen.getByText("Track a vendor bill")).toBeInTheDocument();
  });

  it("switches to Individual Contractors tab", async () => {
    setupEmptyProgress();
    render(<OnboardingChecklist />);

    await waitFor(() => {
      expect(screen.queryByText("Checking progress\u2026")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Individual Contractors"));

    // Individual-specific: has "Record a payment" but not "Track a vendor bill"
    expect(screen.getByText("Record a payment")).toBeInTheDocument();
    expect(screen.queryByText("Track a vendor bill")).not.toBeInTheDocument();
  });

  it("persists tab choice to localStorage", async () => {
    setupEmptyProgress();
    render(<OnboardingChecklist />);

    await waitFor(() => {
      expect(screen.queryByText("Checking progress\u2026")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Individual Contractors"));
    expect(localStorage.getItem("onboarding:workflow-tab")).toBe("individual");

    fireEvent.click(screen.getByText("Remodelers / GCs"));
    expect(localStorage.getItem("onboarding:workflow-tab")).toBe("remodeler");
  });

  it("shows loading state while checking progress", () => {
    // Never resolve — confirm loading state appears
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<OnboardingChecklist />);

    expect(screen.getByText("Checking progress\u2026")).toBeInTheDocument();
  });

  it("shows progress after loading (0 of N with no data)", async () => {
    setupEmptyProgress();
    render(<OnboardingChecklist />);

    await waitFor(() => {
      expect(screen.getByText(/0 of \d+ steps complete/)).toBeInTheDocument();
    });
  });

  it("detects completed steps from API probes", async () => {
    setupPartialProgress({ customers: true, projects: true });
    render(<OnboardingChecklist />);

    await waitFor(() => {
      expect(screen.getByText(/2 of \d+ steps complete/)).toBeInTheDocument();
    });
  });

  it("detects organization step from localStorage flag", async () => {
    localStorage.setItem(ORG_VISITED_KEY, "true");
    setupEmptyProgress();
    render(<OnboardingChecklist />);

    await waitFor(() => {
      expect(screen.getByText(/1 of \d+ steps complete/)).toBeInTheDocument();
    });
  });

  it("marks completed steps with a checkmark", async () => {
    localStorage.setItem(ORG_VISITED_KEY, "true");
    setupEmptyProgress();
    render(<OnboardingChecklist />);

    await waitFor(() => {
      expect(screen.getByText("\u2713")).toBeInTheDocument();
    });
  });

  it("shows Optional badge on optional steps", async () => {
    setupEmptyProgress();
    render(<OnboardingChecklist />);

    await waitFor(() => {
      expect(screen.queryByText("Checking progress\u2026")).not.toBeInTheDocument();
    });

    // Remodeler tab has "Handle a change order" as optional
    const badges = screen.getAllByText("Optional");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it("renders shared steps across both tabs", async () => {
    setupEmptyProgress();
    render(<OnboardingChecklist />);

    await waitFor(() => {
      expect(screen.queryByText("Checking progress\u2026")).not.toBeInTheDocument();
    });

    // Shared steps always present
    expect(screen.getByText("Set up your organization")).toBeInTheDocument();
    expect(screen.getByText("Add your first customer")).toBeInTheDocument();
    expect(screen.getByText("Create a project")).toBeInTheDocument();
  });

  it("resolves dynamic hrefs when a project is detected", async () => {
    setupPartialProgress({ projects: true });
    render(<OnboardingChecklist />);

    await waitFor(() => {
      expect(screen.getByText(/\d+ of \d+ steps complete/)).toBeInTheDocument();
    });

    // The "Build an estimate" step should link to /projects/5 (detected project id)
    const estimateLink = screen.getAllByText(/Projects \u2192/);
    const dynamicLink = estimateLink.find((el) => el.getAttribute("href")?.includes("/projects/5"));
    expect(dynamicLink).toBeTruthy();
  });

  it("calls complete-onboarding API and navigates on Dismiss Guide", async () => {
    setupEmptyProgress();
    mockLoadClientSession.mockReturnValue({
      organization: { id: 1, name: "Test Co", onboardingCompleted: false },
    });
    // Mock the dismiss POST as well as progress probes
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "POST" && url.includes("/complete-onboarding/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    render(<OnboardingChecklist />);

    await waitFor(() => {
      expect(screen.queryByText("Checking progress\u2026")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Dismiss Guide"));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard");
    });

    expect(mockSaveClientSession).toHaveBeenCalledWith(
      expect.objectContaining({
        organization: expect.objectContaining({ onboardingCompleted: true }),
      }),
    );
  });

  it("renders the guide arrow overlay", async () => {
    setupEmptyProgress();
    render(<OnboardingChecklist />);

    expect(screen.getByTestId("guide-arrow-overlay")).toBeInTheDocument();
  });
});
