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
        timeline_id: "quote-event-1",
        category: "workflow",
        event_type: "quote_status",
        occurred_at: "2026-03-01T10:00:00Z",
        label: "Quote draft → sent",
        detail: "",
        object_type: "quote",
        object_id: 10,
        ui_route: "/projects/1/quotes?quote=10",
      },
      {
        timeline_id: "payment-record-1",
        category: "financial",
        event_type: "payment_record",
        occurred_at: "2026-02-15T08:00:00Z",
        label: "Payment #5 created",
        detail: "Initial deposit received",
        object_type: "payment",
        object_id: 5,
        ui_route: "/accounting",
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

  it("auto-loads and displays timeline items on mount", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: makeTimeline() }),
    });
    render(<ProjectActivityConsole projectId={1} />);

    await waitFor(() => {
      expect(screen.getByText("Quote draft → sent")).toBeInTheDocument();
      expect(screen.getByText("Payment #5 created")).toBeInTheDocument();
    });
  });

  it("shows loading state while fetching", async () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<ProjectActivityConsole projectId={1} />);

    await waitFor(() => {
      expect(screen.getByText(/Loading timeline/)).toBeInTheDocument();
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
      expect(screen.getByText("Could not reach the server.")).toBeInTheDocument();
    });
  });

  it("renders empty state when timeline has no items", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: makeTimeline({ items: [], item_count: 0 }) }),
    });
    render(<ProjectActivityConsole projectId={1} />);

    await waitFor(() => {
      expect(screen.getByText("No events found for this filter.")).toBeInTheDocument();
    });
  });

  it("renders timeline item links with correct href", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: makeTimeline() }),
    });
    render(<ProjectActivityConsole projectId={1} />);

    await waitFor(() => {
      expect(screen.getByText("Quote draft → sent")).toBeInTheDocument();
    });

    const viewLinks = screen.getAllByText("View →");
    expect(viewLinks[0]).toHaveAttribute("href", "/projects/1/quotes?quote=10");
  });

  it("renders event type badges", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: makeTimeline() }),
    });
    render(<ProjectActivityConsole projectId={1} />);

    await waitFor(() => {
      expect(screen.getByText("Quote")).toBeInTheDocument();
      expect(screen.getByText("Payment")).toBeInTheDocument();
    });
  });

  it("renders category filter pills", () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: makeTimeline() }),
    });
    render(<ProjectActivityConsole projectId={1} />);

    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workflow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Financial" })).toBeInTheDocument();
  });

  it("reloads timeline when category pill is clicked", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: makeTimeline() }),
    });
    render(<ProjectActivityConsole projectId={1} />);

    await waitFor(() => {
      expect(screen.getByText("Quote draft → sent")).toBeInTheDocument();
    });

    // Switch to financial category
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: makeTimeline({
            category: "financial",
            item_count: 1,
            items: [makeTimeline().items[1]],
          }),
        }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Financial" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("category=financial"),
        expect.any(Object),
      );
    });
  });

  it("shows detail text when present", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: makeTimeline() }),
    });
    render(<ProjectActivityConsole projectId={1} />);

    await waitFor(() => {
      expect(screen.getByText("Initial deposit received")).toBeInTheDocument();
    });
  });
});
