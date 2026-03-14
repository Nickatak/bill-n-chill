import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(() => ({
    get: vi.fn(() => null),
  })),
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
    capabilities: { projects: ["view", "create"] },
  })),
}));

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

vi.stubGlobal("fetch", mockFetch);

import { ProjectsConsole } from "../components/projects-console";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    customer: 10,
    customer_display_name: "Jane Doe",
    name: "Kitchen Remodel",
    status: "active",
    contract_value_original: "25000.00",
    contract_value_current: "25000.00",
    accepted_contract_total: "25000.00",
    ...overrides,
  };
}

function makeFinancialSummary(overrides: Record<string, unknown> = {}) {
  return {
    project_id: 1,
    contract_value_original: "25000.00",
    contract_value_current: "25000.00",
    accepted_contract_total: "25000.00",
    approved_change_orders_total: "0.00",
    invoiced_to_date: "10000.00",
    paid_to_date: "5000.00",
    ar_outstanding: "5000.00",
    ap_total: "8000.00",
    ap_paid: "3000.00",
    ap_outstanding: "5000.00",
    inbound_unapplied_credit: "0.00",
    outbound_unapplied_credit: "0.00",
    traceability: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Route-aware fetch mock. The component fires up to 4 requests on mount
 * (projects list, financial summary, estimates, change orders).
 */
function setupDefaultFetch(overrides: {
  projects?: unknown[];
  summary?: Record<string, unknown>;
  estimates?: unknown[];
  changeOrders?: unknown[];
} = {}) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/projects/") && url.includes("/financial-summary/")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: overrides.summary ?? makeFinancialSummary() }),
      });
    }
    if (url.includes("/projects/") && url.includes("/estimates/")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: overrides.estimates ?? [
              { status: "draft", grand_total: "5000.00" },
              { status: "approved", grand_total: "25000.00" },
            ],
          }),
      });
    }
    if (url.includes("/projects/") && url.includes("/change-orders/")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: overrides.changeOrders ?? [
              { status: "accepted", amount_delta: "2000.00" },
            ],
          }),
      });
    }
    if (url.includes("/projects/")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: overrides.projects ?? [makeProject()],
          }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProjectsConsole", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows empty state when no projects exist", async () => {
    setupDefaultFetch({ projects: [] });
    render(<ProjectsConsole />);

    await waitFor(() => {
      expect(screen.getByText(/No projects yet/)).toBeInTheDocument();
    });

    expect(screen.getByText("Customers")).toHaveAttribute("href", "/customers");
  });

  it("loads and displays a project in the list", async () => {
    setupDefaultFetch();
    render(<ProjectsConsole />);

    await waitFor(() => {
      // Project appears in both the card ("#1 Kitchen Remodel") and the overview root title
      const matches = screen.getAllByText(/Kitchen Remodel/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("auto-selects the first project and shows its overview", async () => {
    setupDefaultFetch();
    render(<ProjectsConsole />);

    await waitFor(() => {
      // The selected project name appears in the tree panel root title
      expect(screen.getByText("Kitchen Remodel")).toBeInTheDocument();
    });

    // Pipeline stage links are rendered with the project id
    expect(screen.getByRole("link", { name: /Estimates/ })).toHaveAttribute("href", "/projects/1/estimates");
    expect(screen.getByRole("link", { name: /Change Orders/ })).toHaveAttribute("href", "/projects/1/change-orders");
  });

  it("displays financial summary metrics section headers", async () => {
    setupDefaultFetch();
    render(<ProjectsConsole />);

    await waitFor(() => {
      expect(screen.getByText("Estimates / Approvals")).toBeInTheDocument();
    });

    expect(screen.getByText("Income")).toBeInTheDocument();
    expect(screen.getByText("Expenses")).toBeInTheDocument();
    expect(screen.getByText("Invoiced to date")).toBeInTheDocument();
    expect(screen.getByText("AR outstanding")).toBeInTheDocument();
    expect(screen.getByText("AP outstanding")).toBeInTheDocument();
  });

  it("displays estimate and CO status count badges", async () => {
    setupDefaultFetch({
      estimates: [
        { status: "draft", grand_total: "5000.00" },
        { status: "draft", grand_total: "3000.00" },
        { status: "sent", grand_total: "7000.00" },
        { status: "approved", grand_total: "25000.00" },
      ],
      changeOrders: [
        { status: "draft", amount_delta: "1000.00" },
        { status: "accepted", amount_delta: "2000.00" },
        { status: "accepted", amount_delta: "3000.00" },
      ],
    });
    render(<ProjectsConsole />);

    // Estimate badges: D{draft} S{sent} A{approved}
    await waitFor(() => {
      expect(screen.getByText("D2")).toBeInTheDocument();
    });
    expect(screen.getByText("S1")).toBeInTheDocument();

    // Approved estimates badge (first A in scope control)
    const aBadges = screen.getAllByText(/^A\d+$/);
    expect(aBadges.length).toBeGreaterThanOrEqual(2);
  });

  it("opens edit form and saves via PATCH", async () => {
    setupDefaultFetch();
    render(<ProjectsConsole />);

    await waitFor(() => {
      expect(screen.getByText("Edit Project")).toBeInTheDocument();
    });

    // Open edit form
    fireEvent.click(screen.getByText("Edit Project"));
    expect(screen.getByText("Close Edit")).toBeInTheDocument();

    // The edit form has a "Project name" label with an input
    const nameInput = screen.getByLabelText("Project name");
    fireEvent.change(nameInput, { target: { value: "Kitchen Remodel v2" } });

    // Mock the PATCH response
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: makeProject({ name: "Kitchen Remodel v2" }),
            }),
        });
      }
      // Keep other routes working
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText(/Project #1 saved/)).toBeInTheDocument();
    });
  });

  it("does not show Edit button for terminal (completed) projects", async () => {
    setupDefaultFetch({
      projects: [makeProject({ status: "completed" })],
    });
    render(<ProjectsConsole />);

    await waitFor(() => {
      expect(screen.getByText("Kitchen Remodel")).toBeInTheDocument();
    });

    expect(screen.queryByText("Edit Project")).not.toBeInTheDocument();
  });

  it("does not show Edit button for cancelled projects", async () => {
    setupDefaultFetch({
      projects: [makeProject({ status: "cancelled" })],
    });
    render(<ProjectsConsole />);

    await waitFor(() => {
      expect(screen.getByText("Kitchen Remodel")).toBeInTheDocument();
    });

    expect(screen.queryByText("Edit Project")).not.toBeInTheDocument();
  });

  it("shows status pills in the edit form for non-terminal projects", async () => {
    setupDefaultFetch({
      projects: [makeProject({ status: "active" })],
    });
    render(<ProjectsConsole />);

    await waitFor(() => {
      expect(screen.getByText("Kitchen Remodel")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Edit Project"));

    // Active status allows: active (current), on_hold, completed, cancelled
    expect(screen.getByText("Current: active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "on hold" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "completed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "cancelled" })).toBeInTheDocument();
  });

  it("shows PATCH error on save failure", async () => {
    setupDefaultFetch();
    render(<ProjectsConsole />);

    await waitFor(() => {
      expect(screen.getByText("Kitchen Remodel")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Edit Project"));

    // Mock a failed PATCH
    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return Promise.resolve({
          ok: false,
          json: () =>
            Promise.resolve({
              error: { message: "Name cannot be empty." },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Name cannot be empty.")).toBeInTheDocument();
    });
  });

  it("renders multiple projects and shows scope control links for selected", async () => {
    setupDefaultFetch({
      projects: [
        makeProject({ id: 1, name: "Kitchen Remodel" }),
        makeProject({ id: 2, name: "Deck Build", status: "prospect" }),
      ],
    });
    render(<ProjectsConsole />);

    await waitFor(() => {
      // Both projects appear as cards in the list
      expect(screen.getByText(/Deck Build/)).toBeInTheDocument();
    });

    // "Kitchen Remodel" appears in both the card and the overview title
    expect(screen.getAllByText(/Kitchen Remodel/).length).toBeGreaterThanOrEqual(2);

    // First matching project is auto-selected — pipeline links point to project 1
    expect(screen.getByRole("link", { name: /Estimates/ })).toHaveAttribute("href", "/projects/1/estimates");
  });

  // ---------------------------------------------------------------------------
  // Workflow tree links
  // ---------------------------------------------------------------------------

  it("renders all workflow tree links with correct hrefs for selected project", async () => {
    setupDefaultFetch();
    render(<ProjectsConsole />);

    await waitFor(() => {
      expect(screen.getByText("Kitchen Remodel")).toBeInTheDocument();
    });

    expect(screen.getByRole("link", { name: /Estimates/ })).toHaveAttribute("href", "/projects/1/estimates");
    expect(screen.getByRole("link", { name: /Change Orders/ })).toHaveAttribute("href", "/projects/1/change-orders");
    expect(screen.getByRole("link", { name: /Invoices/ })).toHaveAttribute("href", "/projects/1/invoices");
    expect(screen.getByRole("link", { name: /Payments/ })).toHaveAttribute("href", "/payments");
    expect(screen.getByRole("link", { name: /Event History/ })).toHaveAttribute("href", "/projects/1/audit-trail");
  });

  // ---------------------------------------------------------------------------
  // Search filtering
  // ---------------------------------------------------------------------------

  it("search input filters projects by name", async () => {
    setupDefaultFetch({
      projects: [
        makeProject({ id: 1, name: "Kitchen Remodel" }),
        makeProject({ id: 2, name: "Deck Build", status: "prospect" }),
      ],
    });
    render(<ProjectsConsole />);

    await waitFor(() => {
      expect(screen.getByText(/Deck Build/)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Search projects"), {
      target: { value: "Deck" },
    });

    // "Deck Build" still visible (card + auto-selected overview), "Kitchen Remodel" gone
    expect(screen.getAllByText(/Deck Build/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/Kitchen Remodel/)).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Status filter toggle
  // ---------------------------------------------------------------------------

  it("toggling a status filter hides projects with that status", async () => {
    setupDefaultFetch({
      projects: [
        makeProject({ id: 1, name: "Kitchen Remodel", status: "active" }),
        makeProject({ id: 2, name: "Deck Build", status: "prospect" }),
      ],
    });
    render(<ProjectsConsole />);

    await waitFor(() => {
      expect(screen.getByText(/Deck Build/)).toBeInTheDocument();
    });

    // Default filters: active + prospect. Toggle off "prospect" via the filter button.
    const filtersContainer = screen.getByText("Project status filter").parentElement!;
    fireEvent.click(within(filtersContainer).getByRole("button", { name: /prospect/i }));

    // Prospect project hidden, active still visible
    expect(screen.queryByText(/Deck Build/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Kitchen Remodel/).length).toBeGreaterThan(0);
  });

  it("Show all projects reveals projects in all statuses", async () => {
    setupDefaultFetch({
      projects: [
        makeProject({ id: 1, name: "Kitchen Remodel", status: "active" }),
        makeProject({ id: 2, name: "Old Job", status: "completed" }),
      ],
    });
    render(<ProjectsConsole />);

    await waitFor(() => {
      expect(screen.getAllByText(/Kitchen Remodel/).length).toBeGreaterThan(0);
    });

    // Default filters exclude "completed" — Old Job not visible
    expect(screen.queryByText(/Old Job/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show all projects/i }));

    expect(screen.getByText(/Old Job/)).toBeInTheDocument();
  });

  it("Reset filters restores default active + prospect filters", async () => {
    setupDefaultFetch({
      projects: [
        makeProject({ id: 1, name: "Kitchen Remodel", status: "active" }),
        makeProject({ id: 2, name: "Old Job", status: "completed" }),
      ],
    });
    render(<ProjectsConsole />);

    await waitFor(() => {
      expect(screen.getAllByText(/Kitchen Remodel/).length).toBeGreaterThan(0);
    });

    // Show all first, then reset
    fireEvent.click(screen.getByRole("button", { name: /show all projects/i }));
    expect(screen.getByText(/Old Job/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /reset filters/i }));
    expect(screen.queryByText(/Old Job/)).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Edit form toggle
  // ---------------------------------------------------------------------------

  it("Close Edit button hides the edit form", async () => {
    setupDefaultFetch();
    render(<ProjectsConsole />);

    await waitFor(() => {
      expect(screen.getByText("Edit Project")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Edit Project"));
    expect(screen.getByLabelText("Project name")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Close Edit"));
    expect(screen.queryByLabelText("Project name")).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Edit save network failure
  // ---------------------------------------------------------------------------

  it("shows error on PATCH network failure", async () => {
    setupDefaultFetch();
    render(<ProjectsConsole />);

    await waitFor(() => {
      expect(screen.getByText("Kitchen Remodel")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Edit Project"));

    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(
        screen.getByText("Could not reach project detail endpoint."),
      ).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Project selection switch
  // ---------------------------------------------------------------------------

  it("clicking a different project card updates the overview", async () => {
    setupDefaultFetch({
      projects: [
        makeProject({ id: 1, name: "Kitchen Remodel" }),
        makeProject({ id: 2, name: "Deck Build", status: "prospect" }),
      ],
    });
    render(<ProjectsConsole />);

    await waitFor(() => {
      // Project 1 auto-selected — pipeline links point to project 1
      expect(screen.getByRole("link", { name: /Estimates/ })).toHaveAttribute("href", "/projects/1/estimates");
    });

    // Click on Deck Build card (role="button")
    fireEvent.click(screen.getByText(/Deck Build/));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Estimates/ })).toHaveAttribute("href", "/projects/2/estimates");
    });
  });

  // ---------------------------------------------------------------------------
  // Status pills for prospect (different FSM)
  // ---------------------------------------------------------------------------

  it("shows correct status transition pills for prospect project", async () => {
    setupDefaultFetch({
      projects: [makeProject({ status: "prospect" })],
    });
    render(<ProjectsConsole />);

    await waitFor(() => {
      expect(screen.getByText("Kitchen Remodel")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Edit Project"));

    // Scope to the edit form to avoid filter button conflicts
    const editForm = screen.getByLabelText("Project name").closest("form")!;

    // Prospect transitions: prospect (current), active, cancelled
    expect(screen.getByText("Current: prospect")).toBeInTheDocument();
    // The pressed pill is prospect (current status); the label wrapping causes
    // its accessible name to include parent text, so target by pressed state.
    const pressedPill = within(editForm).getByRole("button", { pressed: true });
    expect(pressedPill).toHaveTextContent("prospect");
    expect(within(editForm).getByRole("button", { name: "active" })).toBeInTheDocument();
    expect(within(editForm).getByRole("button", { name: "cancelled" })).toBeInTheDocument();
    // on_hold and completed NOT available from prospect
    expect(within(editForm).queryByRole("button", { name: "on hold" })).not.toBeInTheDocument();
    expect(within(editForm).queryByRole("button", { name: "completed" })).not.toBeInTheDocument();
  });

});
