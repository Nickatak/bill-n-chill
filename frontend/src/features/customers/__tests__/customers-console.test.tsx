import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: mockPush, replace: vi.fn() })),
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
    capabilities: { customers: ["view", "create"], projects: ["view", "create"] },
  })),
}));

vi.mock("@/shared/phone-format", () => ({
  formatPhone: (v: string) => v,
}));

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

vi.stubGlobal("fetch", mockFetch);

import { CustomersConsole } from "../components/customers-console";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CUSTOMER_ROWS = [
  {
    id: 1,
    display_name: "Jane Doe",
    phone: "5551234567",
    email: "jane@example.com",
    billing_address: "123 Main St",
    is_archived: false,
    project_count: 1,
    active_project_count: 1,
    has_project: true,
    has_active_or_on_hold_project: true,
    created_at: "2026-01-15T10:00:00Z",
  },
  {
    id: 2,
    display_name: "Bob Smith",
    phone: "5559876543",
    email: "bob@example.com",
    billing_address: "456 Oak Ave",
    is_archived: false,
    project_count: 0,
    active_project_count: 0,
    has_project: false,
    has_active_or_on_hold_project: false,
    created_at: "2026-02-01T10:00:00Z",
  },
];

/**
 * Route-aware fetch mock. The component fires two fetches on mount
 * (customers list + project index), so we route based on URL.
 */
function setupDefaultFetch(overrides: Record<string, unknown> = {}) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/customers/") && !url.includes("/projects/")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: overrides.customers ?? CUSTOMER_ROWS,
            meta: { page: 1, total_pages: 1, total_count: (overrides.customers as unknown[] ?? CUSTOMER_ROWS).length },
          }),
      });
    }
    if (url.includes("/projects/")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: overrides.projects ?? [] }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CustomersConsole", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockPush.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  // The component debounces the customer fetch by 250ms, so waitFor handles the delay.

  it("loads and displays customer list from API", async () => {
    setupDefaultFetch();
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
      expect(screen.getByText("Bob Smith")).toBeInTheDocument();
    });
  });

  it("shows error on customer load failure", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/customers/")) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: { message: "Unauthorized." } }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Unauthorized.")).toBeInTheDocument();
    });
  });

  it("opens edit modal when customer name is clicked", async () => {
    setupDefaultFetch();
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Jane Doe"));

    expect(screen.getByText("Edit Customer")).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toHaveValue("Jane Doe");
  });

  it("saves customer edit via PATCH and closes modal", async () => {
    setupDefaultFetch();
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Jane Doe"));
    expect(screen.getByText("Edit Customer")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Jane Doe-Smith" },
    });

    // Mock the PATCH response (keep routing other fetches normally)
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: { ...CUSTOMER_ROWS[0], display_name: "Jane Doe-Smith" },
            }),
        });
      }
      if (url.includes("/customers/") && !url.includes("/projects/")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: CUSTOMER_ROWS,
              meta: { page: 1, total_pages: 1, total_count: 2 },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Customer" }));

    await waitFor(() => {
      expect(screen.getByText(/Saved customer #1/)).toBeInTheDocument();
    });
  });

  it("filters customers by activity status (client-side)", async () => {
    const rows = [
      ...CUSTOMER_ROWS,
      {
        id: 3,
        display_name: "Archived Corp",
        phone: "",
        email: "",
        billing_address: "",
        is_archived: true,
        project_count: 0,
        active_project_count: 0,
        has_project: false,
        has_active_or_on_hold_project: false,
        created_at: "2025-06-01T10:00:00Z",
      },
    ];

    setupDefaultFetch({ customers: rows });
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    // Default filter is "active", so archived customer should not appear
    expect(screen.queryByText("Archived Corp")).not.toBeInTheDocument();

    // Switch to "All" to see archived customers
    const allButtons = screen.getAllByRole("button", { name: "All" });
    fireEvent.click(allButtons[0]);

    expect(screen.getByText("Archived Corp")).toBeInTheDocument();
  });

  it("filters customers by project ownership (client-side)", async () => {
    setupDefaultFetch();
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
      expect(screen.getByText("Bob Smith")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "With Projects" }));

    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.queryByText("Bob Smith")).not.toBeInTheDocument();
  });

  it("shows pagination when multiple pages exist", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/customers/")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: CUSTOMER_ROWS,
              meta: { page: 1, total_pages: 3, total_count: 75 },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
      expect(screen.getByText(/75 customers/)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled();
  });

  it("closes edit modal on Close button click", async () => {
    setupDefaultFetch();
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Jane Doe"));
    expect(screen.getByText("Edit Customer")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Edit Customer")).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Empty-field validation
  // ---------------------------------------------------------------------------

  it("shows error when saving customer with empty display name", async () => {
    setupDefaultFetch();
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Jane Doe"));
    expect(screen.getByText("Edit Customer")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Customer" }));

    // Message appears in both the main status area and the editor form
    expect(screen.getAllByText("Display name is required.").length).toBeGreaterThanOrEqual(1);
  });

  it("shows error when creating project with empty name", async () => {
    setupDefaultFetch();
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: /add new project for jane doe/i }),
    );
    const dialog = screen.getByRole("dialog", { name: /create project/i });

    // openProjectCreator pre-fills name — clear it to trigger validation
    fireEvent.change(within(dialog).getByLabelText("Project name"), {
      target: { value: "" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Project" }));

    expect(screen.getAllByText("Project name is required.").length).toBeGreaterThanOrEqual(1);
  });

  it("shows error when creating project with empty site address", async () => {
    setupDefaultFetch();
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: /add new project for jane doe/i }),
    );
    const dialog = screen.getByRole("dialog", { name: /create project/i });

    // Clear site address but keep project name
    fireEvent.change(within(dialog).getByLabelText("Site address"), {
      target: { value: "" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Project" }));

    expect(screen.getAllByText("Site address is required.").length).toBeGreaterThanOrEqual(1);
  });
});
