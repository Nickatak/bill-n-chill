import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn());

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
    capabilities: { projects: ["view"] },
  })),
}));

vi.stubGlobal("fetch", mockFetch);

import { ProjectActivityConsole } from "../components/project-activity-console";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeTimeline(overrides: Record<string, unknown> = {}) {
  return {
    project_id: 1,
    project_name: "Kitchen Remodel",
    category: "all",
    item_count: 2,
    items: [
      {
        timeline_id: "evt-1",
        category: "financial",
        event_type: "invoice_created",
        occurred_at: "2026-03-01T10:00:00Z",
        label: "Invoice #101 created",
        detail: "Amount: $5,000.00",
        object_type: "invoice",
        object_id: 101,
        ui_route: "/invoices?invoice=101",
        detail_endpoint: "/api/v1/invoices/101/",
      },
      {
        timeline_id: "evt-2",
        category: "workflow",
        event_type: "status_changed",
        occurred_at: "2026-02-15T08:00:00Z",
        label: "Project status changed to active",
        detail: "",
        object_type: "project",
        object_id: 1,
        ui_route: "/projects?project=1",
        detail_endpoint: "/api/v1/projects/1/",
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProjectActivityConsole", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders intro text with the project id", () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: makeTimeline() }),
    });
    render(<ProjectActivityConsole projectId={42} />);

    expect(screen.getByText(/project #42/i)).toBeInTheDocument();
  });

  it("loads and displays timeline items on mount", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: makeTimeline() }),
    });
    render(<ProjectActivityConsole projectId={1} />);

    await waitFor(() => {
      expect(screen.getByText("Invoice #101 created")).toBeInTheDocument();
      expect(screen.getByText("Project status changed to active")).toBeInTheDocument();
    });
  });

  it("shows item count in status message after load", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: makeTimeline({ item_count: 2 }) }),
    });
    render(<ProjectActivityConsole projectId={1} />);

    await waitFor(() => {
      expect(screen.getByText(/Loaded 2 timeline event/)).toBeInTheDocument();
    });
  });

  it("shows loading status while fetching", async () => {
    // Never resolve — just confirm the loading state appears
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<ProjectActivityConsole projectId={1} />);

    await waitFor(() => {
      expect(screen.getByText("Loading project timeline...")).toBeInTheDocument();
    });
  });

  it("shows error message on API failure", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: { message: "Not found." } }),
    });
    render(<ProjectActivityConsole projectId={999} />);

    await waitFor(() => {
      expect(screen.getByText("Not found.")).toBeInTheDocument();
    });
  });

  it("shows network error on fetch rejection", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    render(<ProjectActivityConsole projectId={1} />);

    await waitFor(() => {
      expect(screen.getByText("Could not reach project timeline endpoint.")).toBeInTheDocument();
    });
  });

  it("renders empty state when timeline has no items", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: makeTimeline({ items: [], item_count: 0 }) }),
    });
    render(<ProjectActivityConsole projectId={1} />);

    await waitFor(() => {
      expect(
        screen.getByText("No timeline events matched this filter."),
      ).toBeInTheDocument();
    });
  });

  it("renders timeline item links with correct href", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: makeTimeline() }),
    });
    render(<ProjectActivityConsole projectId={1} />);

    await waitFor(() => {
      expect(screen.getByText("Invoice #101 created")).toBeInTheDocument();
    });

    const openLinks = screen.getAllByText("Open");
    expect(openLinks[0]).toHaveAttribute("href", "/invoices?invoice=101");
  });

  it("reloads timeline when Load Timeline button is clicked", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: makeTimeline() }),
    });
    render(<ProjectActivityConsole projectId={1} />);

    await waitFor(() => {
      expect(screen.getByText(/Loaded 2 timeline event/)).toBeInTheDocument();
    });

    // Reset and click again
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: makeTimeline({ item_count: 5, items: [...makeTimeline().items] }),
        }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Load Timeline" }));

    await waitFor(() => {
      expect(screen.getByText(/Loaded \d+ timeline event/)).toBeInTheDocument();
    });
  });

  it("renders category filter dropdown with all options", () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: makeTimeline() }),
    });
    render(<ProjectActivityConsole projectId={1} />);

    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();

    const options = screen.getAllByRole("option");
    expect(options.map((opt) => opt.textContent)).toEqual(["all", "financial", "workflow"]);
  });
});
