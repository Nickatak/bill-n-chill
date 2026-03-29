import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

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

  // ── Single track structure ──────────────────────────────────────

  it("renders top-level steps (org, customer, project)", async () => {
    setupEmptyProgress();
    render(<OnboardingChecklist />);

    await waitFor(() => {
      expect(screen.queryByText("Checking progress\u2026")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Set up your organization")).toBeInTheDocument();
    expect(screen.getByText("Add your first customer")).toBeInTheDocument();
    expect(screen.getByText("Create a project")).toBeInTheDocument();
  });

  it("does not render tabs — single track only", async () => {
    setupEmptyProgress();
    render(<OnboardingChecklist />);

    await waitFor(() => {
      expect(screen.queryByText("Checking progress\u2026")).not.toBeInTheDocument();
    });

    expect(screen.queryByText("Individual Contractors")).not.toBeInTheDocument();
    expect(screen.queryByText("Remodelers / GCs")).not.toBeInTheDocument();
  });

  // ── Sub-steps ───────────────────────────────────────────────────

  it("renders project sub-steps in locked state when no project exists", async () => {
    setupEmptyProgress();
    render(<OnboardingChecklist />);

    await waitFor(() => {
      expect(screen.queryByText("Checking progress\u2026")).not.toBeInTheDocument();
    });

    // Sub-steps are visible but locked
    expect(screen.getByText("Build & send an estimate")).toBeInTheDocument();
    expect(screen.getByText("Create an invoice & record payment")).toBeInTheDocument();
    expect(screen.getByText("Track expenses")).toBeInTheDocument();
    expect(screen.getByText("Complete this step to unlock")).toBeInTheDocument();
  });

  it("reveals sub-steps with deep links when a project exists", async () => {
    setupPartialProgress({ projects: true });
    render(<OnboardingChecklist />);

    await waitFor(() => {
      expect(screen.getByText("Inside your project")).toBeInTheDocument();
    });

    // Deep links should resolve to project 5
    const invoiceLink = screen.getByText("Invoices \u2192");
    expect(invoiceLink.getAttribute("href")).toBe("/projects/5/invoices");

    const estimateLink = screen.getByText("Estimates \u2192");
    expect(estimateLink.getAttribute("href")).toBe("/projects/5/estimates");
  });

  it("shows sub-step links only when project exists (no links in locked state)", async () => {
    setupEmptyProgress();
    render(<OnboardingChecklist />);

    await waitFor(() => {
      expect(screen.queryByText("Checking progress\u2026")).not.toBeInTheDocument();
    });

    // Sub-step link labels should not appear as links when locked
    expect(screen.queryByText("Invoices \u2192")).not.toBeInTheDocument();
    expect(screen.queryByText("Estimates \u2192")).not.toBeInTheDocument();
  });

  it("vendor bill sub-step deep links into project", async () => {
    setupPartialProgress({ projects: true });
    render(<OnboardingChecklist />);

    await waitFor(() => {
      expect(screen.getByText("Inside your project")).toBeInTheDocument();
    });

    const billLink = screen.getByText("Bills \u2192");
    expect(billLink.getAttribute("href")).toBe("/projects/5/bills");
  });

  // ── Optional badges ─────────────────────────────────────────────

  it("shows Optional badge on optional sub-steps", async () => {
    setupEmptyProgress();
    render(<OnboardingChecklist />);

    await waitFor(() => {
      expect(screen.queryByText("Checking progress\u2026")).not.toBeInTheDocument();
    });

    const badges = screen.getAllByText("Optional");
    // estimate, change-order, bill = 3 optional sub-steps
    expect(badges).toHaveLength(3);
  });

  // ── Progress detection ──────────────────────────────────────────

  it("shows loading state while checking progress", () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<OnboardingChecklist />);

    expect(screen.getByText("Checking progress\u2026")).toBeInTheDocument();
  });

  it("shows 0 of N with no data", async () => {
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

  // ── Required step count ─────────────────────────────────────────

  it("counts only required steps in progress (org, customer, project, invoice)", async () => {
    // Complete all 3 top-level required steps + invoice
    localStorage.setItem(ORG_VISITED_KEY, "true");
    setupPartialProgress({ customers: true, projects: true, invoices: true });
    render(<OnboardingChecklist />);

    await waitFor(() => {
      // org + customer + project + invoice = 4 of 4
      expect(screen.getByText("4 of 4 steps complete")).toBeInTheDocument();
    });
  });

  // ── Guide arrow overlay ─────────────────────────────────────────

  it("renders the guide arrow overlay", async () => {
    setupEmptyProgress();
    render(<OnboardingChecklist />);

    expect(screen.getByTestId("guide-arrow-overlay")).toBeInTheDocument();
  });
});
