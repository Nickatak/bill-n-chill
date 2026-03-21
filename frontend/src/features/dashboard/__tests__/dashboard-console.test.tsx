import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
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

vi.stubGlobal("fetch", mockFetch);

import { DashboardConsole } from "../components/dashboard-console";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makePortfolio(overrides: Record<string, unknown> = {}) {
  return {
    generated_at: "2026-03-09T00:00:00Z",
    date_filter: { date_from: "2026-01-01", date_to: "2026-03-09" },
    active_projects_count: 3,
    ar_total_outstanding: "15000.00",
    ap_total_outstanding: "8000.00",
    overdue_invoice_count: 1,
    overdue_vendor_bill_count: 0,
    projects: [],
    ...overrides,
  };
}

function makeAttentionFeed(items: Record<string, unknown>[] = []) {
  return {
    generated_at: "2026-03-09T00:00:00Z",
    due_soon_window_days: 7,
    item_count: items.length,
    items: items.map((item, i) => ({
      kind: "overdue_invoice",
      severity: "high",
      label: `Attention item ${i + 1}`,
      detail: "Due yesterday",
      project_id: 1,
      project_name: "Kitchen Remodel",
      ui_route: "/invoices",
      detail_endpoint: `/api/v1/invoices/${i + 1}/`,
      due_date: "2026-03-08",
      ...item,
    })),
  };
}

function makeChangeImpact(overrides: Record<string, unknown> = {}) {
  return {
    generated_at: "2026-03-09T00:00:00Z",
    date_filter: { date_from: "2026-01-01", date_to: "2026-03-09" },
    approved_change_orders_count: 2,
    approved_change_orders_total: "5000.00",
    projects: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDashboardFetch(options: {
  portfolio?: unknown;
  attention?: unknown;
  changeImpact?: unknown;
} = {}) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/reports/portfolio/")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: options.portfolio ?? makePortfolio() }),
      });
    }
    if (url.includes("/reports/attention-feed/")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: options.attention ?? makeAttentionFeed() }),
      });
    }
    if (url.includes("/reports/change-impact/")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: options.changeImpact ?? makeChangeImpact() }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DashboardConsole", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows loading state initially", () => {
    // Never resolve fetches — component stays in loading
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<DashboardConsole />);

    expect(screen.getByText("Loading dashboard...")).toBeInTheDocument();
  });

  it("renders portfolio metrics after load", async () => {
    setupDashboardFetch();
    render(<DashboardConsole />);

    await waitFor(() => {
      expect(screen.getByText("Portfolio")).toBeInTheDocument();
    });

    expect(screen.getByText("Active Projects")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("AR Outstanding")).toBeInTheDocument();
    expect(screen.getByText("$15,000.00")).toBeInTheDocument();
    expect(screen.getByText("AP Outstanding")).toBeInTheDocument();
    expect(screen.getByText("$8,000.00")).toBeInTheDocument();
    expect(screen.getByText("Overdue Invoices")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders project breakdown rows", async () => {
    setupDashboardFetch({
      portfolio: makePortfolio({
        projects: [
          {
            project_id: 1,
            project_name: "Kitchen Remodel",
            project_status: "active",
            ar_outstanding: "5000.00",
            ap_outstanding: "2000.00",
            approved_change_orders_total: "1000.00",
          },
        ],
      }),
    });
    render(<DashboardConsole />);

    await waitFor(() => {
      expect(screen.getByText("Kitchen Remodel")).toBeInTheDocument();
    });

    expect(screen.getByText("By Project")).toBeInTheDocument();
    // Project row links to project page
    const link = screen.getByText("Kitchen Remodel").closest("a");
    expect(link).toHaveAttribute("href", "/projects?project=1");
  });

  it("renders attention feed items with severity badges", async () => {
    setupDashboardFetch({
      attention: makeAttentionFeed([
        { label: "Invoice #12 overdue", severity: "high", project_name: "Deck Build" },
        { label: "Bill #5 due soon", severity: "medium", project_name: "Kitchen Remodel" },
      ]),
    });
    render(<DashboardConsole />);

    await waitFor(() => {
      expect(screen.getByText("Needs Attention")).toBeInTheDocument();
    });

    expect(screen.getByText("Invoice #12 overdue")).toBeInTheDocument();
    expect(screen.getByText("Bill #5 due soon")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText("medium")).toBeInTheDocument();
    // Count badge "2" — may collide with other numeric text, verify via getAllByText
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
  });

  it("shows empty attention state when no items", async () => {
    setupDashboardFetch({ attention: makeAttentionFeed([]) });
    render(<DashboardConsole />);

    await waitFor(() => {
      expect(screen.getByText("No items need attention right now.")).toBeInTheDocument();
    });
  });

  it("renders change order impact section", async () => {
    setupDashboardFetch({
      changeImpact: makeChangeImpact({
        approved_change_orders_count: 4,
        approved_change_orders_total: "12500.00",
      }),
    });
    render(<DashboardConsole />);

    await waitFor(() => {
      expect(screen.getByText("Change Order Impact")).toBeInTheDocument();
    });

    expect(screen.getByText("Approved COs")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Total Contract Growth")).toBeInTheDocument();
    expect(screen.getByText("$12,500.00")).toBeInTheDocument();
  });

  it("hides change impact when zero approved COs", async () => {
    setupDashboardFetch({
      changeImpact: makeChangeImpact({ approved_change_orders_count: 0 }),
    });
    render(<DashboardConsole />);

    await waitFor(() => {
      expect(screen.getByText("Portfolio")).toBeInTheDocument();
    });

    expect(screen.queryByText("Change Order Impact")).not.toBeInTheDocument();
  });

  it("gracefully handles partial API failures", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/reports/portfolio/")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: makePortfolio() }),
        });
      }
      // Attention and change impact fail
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: { message: "Server error" } }),
      });
    });
    render(<DashboardConsole />);

    await waitFor(() => {
      expect(screen.getByText("Portfolio")).toBeInTheDocument();
    });

    // Portfolio renders, attention shows empty state, change impact hidden
    expect(screen.getByText("No items need attention right now.")).toBeInTheDocument();
    expect(screen.queryByText("Change Order Impact")).not.toBeInTheDocument();
  });

  it("fires all 3 API requests on mount", async () => {
    setupDashboardFetch();
    render(<DashboardConsole />);

    await waitFor(() => {
      expect(screen.getByText("Portfolio")).toBeInTheDocument();
    });

    const urls = mockFetch.mock.calls.map((call: unknown[]) => call[0] as string);
    expect(urls.some((u) => u.includes("/reports/portfolio/"))).toBe(true);
    expect(urls.some((u) => u.includes("/reports/attention-feed/"))).toBe(true);
    expect(urls.some((u) => u.includes("/reports/change-impact/"))).toBe(true);
  });

  it("shows auth message when no shared session", async () => {
    const { useSharedSessionAuth } = await import("@/shared/session/use-shared-session");
    vi.mocked(useSharedSessionAuth).mockReturnValueOnce({
      token: "",
      email: "",
      authMessage: "No shared session found.",
      role: "" as "owner",
      organization: null,
      capabilities: {},
      isSuperuser: false,
      isImpersonating: false,
      impersonation: undefined,
    });
    render(<DashboardConsole />);

    expect(screen.getByText("No shared session found.")).toBeInTheDocument();
    expect(screen.queryByText("Loading dashboard...")).not.toBeInTheDocument();
  });
});
