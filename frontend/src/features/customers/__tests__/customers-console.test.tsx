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

const mockUseSharedSessionAuth = vi.hoisted(() => vi.fn());

vi.mock("@/shared/session/use-shared-session", () => ({
  useSharedSessionAuth: mockUseSharedSessionAuth,
}));

vi.mock("@/shared/session/rbac", () => ({
  hasAnyRole: vi.fn((role: string, roles: string[]) => roles.includes(role)),
  canDo: vi.fn((caps: Record<string, string[]> | undefined, resource: string, action: string) =>
    Boolean(caps?.[resource]?.includes(action)),
  ),
}));

vi.mock("@/shared/phone-format", () => ({
  formatPhone: (v: string) => v,
}));

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

vi.stubGlobal("fetch", mockFetch);

import { CustomersConsole } from "../components/customers-console";

// ---------------------------------------------------------------------------
// Session defaults
// ---------------------------------------------------------------------------

const DEFAULT_SESSION = {
  token: "test-token",
  email: "nick@test.com",
  authMessage: "Using shared session for nick@test.com (owner).",
  role: "owner",
  organization: null,
  capabilities: { customers: ["view", "create"], projects: ["view", "create"] },
};

const VIEW_ONLY_SESSION = {
  ...DEFAULT_SESSION,
  role: "viewer",
  capabilities: { customers: ["view"], projects: ["view"] },
};

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
    projects_count: 1,
    active_projects_count: 1,
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
    projects_count: 0,
    active_projects_count: 0,
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
            pagination_metadata: { page: 1, total_pages: 1, total_count: (overrides.customers as unknown[] ?? CUSTOMER_ROWS).length },
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
    mockUseSharedSessionAuth.mockReturnValue(DEFAULT_SESSION);
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
              pagination_metadata: { page: 1, total_pages: 1, total_count: 2 },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Customer" }));

    await waitFor(() => {
      expect(screen.getByText(/Saved Jane Doe-Smith/)).toBeInTheDocument();
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
        projects_count: 0,
        active_projects_count: 0,
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
              pagination_metadata: { page: 1, total_pages: 3, total_count: 75 },
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

  // ---------------------------------------------------------------------------
  // Pagination navigation
  // ---------------------------------------------------------------------------

  it("clicking Next fetches and renders page 2", async () => {
    // Page 1 response
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/customers/")) {
        const page = new URL(url, "http://localhost").searchParams.get("page");
        if (page === "2") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                data: [{ ...CUSTOMER_ROWS[1], id: 3, display_name: "Page 2 Person" }],
                pagination_metadata: { page: 2, total_pages: 3, total_count: 75 },
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: CUSTOMER_ROWS,
              pagination_metadata: { page: 1, total_pages: 3, total_count: 75 },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument();
      expect(screen.getByText("Page 2 Person")).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  it("search input triggers API call with query param", async () => {
    setupDefaultFetch();
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    // Track fetch calls after initial load
    mockFetch.mockClear();
    setupDefaultFetch({ customers: [CUSTOMER_ROWS[0]] });

    fireEvent.change(screen.getByPlaceholderText(/search by name/i), {
      target: { value: "jane" },
    });

    // Wait for debounce (250ms) and verify fetch was called with search param
    await waitFor(() => {
      const customerCall = mockFetch.mock.calls.find(
        (call: unknown[]) => typeof call[0] === "string" && call[0].includes("/customers/") && call[0].includes("q=jane"),
      );
      expect(customerCall).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // Edit save error paths
  // ---------------------------------------------------------------------------

  it("shows error on edit save API failure", async () => {
    setupDefaultFetch();
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Jane Doe"));
    expect(screen.getByText("Edit Customer")).toBeInTheDocument();

    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return Promise.resolve({
          ok: false,
          json: () =>
            Promise.resolve({
              error: { message: "Cannot archive customer with active projects." },
            }),
        });
      }
      if (url.includes("/customers/") && !url.includes("/projects/")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: CUSTOMER_ROWS,
              pagination_metadata: { page: 1, total_pages: 1, total_count: 2 },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Customer" }));

    await waitFor(() => {
      expect(
        screen.getAllByText("Cannot archive customer with active projects.").length,
      ).toBeGreaterThan(0);
    });
  });

  it("shows error on edit save network failure", async () => {
    setupDefaultFetch();
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Jane Doe"));

    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return Promise.reject(new Error("Network error"));
      }
      if (url.includes("/customers/") && !url.includes("/projects/")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: CUSTOMER_ROWS,
              pagination_metadata: { page: 1, total_pages: 1, total_count: 2 },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Customer" }));

    await waitFor(() => {
      expect(
        screen.getAllByText("Could not reach customer detail endpoint.").length,
      ).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Project create success + error paths
  // ---------------------------------------------------------------------------

  it("creates project and navigates to workspace on success", async () => {
    setupDefaultFetch();
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: /add new project for jane doe/i }),
    );
    const dialog = screen.getByRole("dialog", { name: /create project/i });

    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: { project: { id: 42, name: "Jane Doe Project", status: "prospect", customer: 1 } },
            }),
        });
      }
      if (typeof url === "string" && url.includes("/customers/") && !url.includes("/projects/")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: CUSTOMER_ROWS,
            pagination_metadata: { page: 1, total_pages: 1, total_count: 2 },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Create Project" }));

    await waitFor(() => {
      expect(screen.getByText(/Created project #42/)).toBeInTheDocument();
      expect(mockPush).toHaveBeenCalledWith("/projects?project=42");
    });
  });

  it("shows error on project create API failure", async () => {
    setupDefaultFetch();
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: /add new project for jane doe/i }),
    );
    const dialog = screen.getByRole("dialog", { name: /create project/i });

    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: false,
          json: () =>
            Promise.resolve({
              error: { message: "Customer is archived." },
            }),
        });
      }
      if (typeof url === "string" && url.includes("/customers/") && !url.includes("/projects/")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: CUSTOMER_ROWS,
            pagination_metadata: { page: 1, total_pages: 1, total_count: 2 },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Create Project" }));

    await waitFor(() => {
      expect(screen.getAllByText("Customer is archived.").length).toBeGreaterThan(0);
    });
  });

  it("shows error on project create network failure", async () => {
    setupDefaultFetch();
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: /add new project for jane doe/i }),
    );
    const dialog = screen.getByRole("dialog", { name: /create project/i });

    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.reject(new Error("Network error"));
      }
      if (typeof url === "string" && url.includes("/customers/") && !url.includes("/projects/")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: CUSTOMER_ROWS,
            pagination_metadata: { page: 1, total_pages: 1, total_count: 2 },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Create Project" }));

    await waitFor(() => {
      expect(
        screen.getAllByText("Could not reach customer project creation endpoint.").length,
      ).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Archive toggle guard
  // ---------------------------------------------------------------------------

  it("disables archive checkbox when customer has active/on-hold project", async () => {
    setupDefaultFetch();
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    // Jane Doe has has_active_or_on_hold_project: true, is_archived: false
    fireEvent.click(screen.getByText("Jane Doe"));
    expect(screen.getByText("Edit Customer")).toBeInTheDocument();

    const archiveCheckbox = screen.getByRole("checkbox");
    expect(archiveCheckbox).toBeDisabled();
    expect(screen.getByText("Archive is blocked while this customer has active or on-hold projects.")).toBeInTheDocument();
  });

  it("enables archive checkbox when customer has no active/on-hold projects", async () => {
    setupDefaultFetch();
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Bob Smith")).toBeInTheDocument();
    });

    // Bob Smith has has_active_or_on_hold_project: false
    fireEvent.click(screen.getByText("Bob Smith"));
    expect(screen.getByText("Edit Customer")).toBeInTheDocument();

    const archiveCheckbox = screen.getByRole("checkbox");
    expect(archiveCheckbox).not.toBeDisabled();
    expect(screen.queryByText("Archive is blocked while this customer has active or on-hold projects.")).not.toBeInTheDocument();
  });

  it("allows un-archiving even when customer has active/on-hold projects", async () => {
    const archivedWithActiveProject = {
      ...CUSTOMER_ROWS[0],
      id: 5,
      display_name: "Archived Active",
      is_archived: true,
      has_active_or_on_hold_project: true,
    };
    setupDefaultFetch({ customers: [archivedWithActiveProject] });
    render(<CustomersConsole />);

    // Default activity filter is "active" — switch to "All" to see archived customer
    await waitFor(() => {
      expect(screen.queryByText("Archived Active")).not.toBeInTheDocument();
    });
    const allButtons = screen.getAllByRole("button", { name: "All" });
    fireEvent.click(allButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Archived Active")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Archived Active"));
    expect(screen.getByText("Edit Customer")).toBeInTheDocument();

    // archiveToggleBlocked = hasActiveOrOnHoldProject && !isArchived
    // Since isArchived=true, the guard does NOT block — un-archiving is allowed
    const archiveCheckbox = screen.getByRole("checkbox");
    expect(archiveCheckbox).not.toBeDisabled();
    expect(archiveCheckbox).toBeChecked();
  });

  it("shows prospect cancellation warning when archive is toggled on", async () => {
    setupDefaultFetch();
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Bob Smith")).toBeInTheDocument();
    });

    // Bob Smith has no active projects — archive toggle is enabled
    fireEvent.click(screen.getByText("Bob Smith"));
    expect(screen.getByText("Edit Customer")).toBeInTheDocument();

    const archiveCheckbox = screen.getByRole("checkbox");
    expect(archiveCheckbox).not.toBeChecked();

    // No warning before toggling
    expect(screen.queryByText(/automatically cancel/)).not.toBeInTheDocument();

    // Toggle archive on
    fireEvent.click(archiveCheckbox);

    expect(screen.getByText(/automatically cancel this customer/)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Read-only mode (viewer/worker roles)
  // ---------------------------------------------------------------------------

  it("disables Save Customer button when user lacks create capability", async () => {
    mockUseSharedSessionAuth.mockReturnValue(VIEW_ONLY_SESSION);
    setupDefaultFetch();
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Jane Doe"));
    expect(screen.getByText("Edit Customer")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Save Customer" })).toBeDisabled();
  });

  it("shows read-only message when viewer attempts to save customer edit", async () => {
    mockUseSharedSessionAuth.mockReturnValue(VIEW_ONLY_SESSION);
    setupDefaultFetch();
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Bob Smith")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Bob Smith"));

    // Force-submit the form (button is disabled but the hook guard is what we're testing)
    const form = screen.getByText("Edit Customer").closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("Your role is read-only for customer mutations.")).toBeInTheDocument();
    });
  });

  it("disables Create Project button when user lacks project create capability", async () => {
    mockUseSharedSessionAuth.mockReturnValue(VIEW_ONLY_SESSION);
    setupDefaultFetch();
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: /add new project for jane doe/i }),
    );
    const dialog = screen.getByRole("dialog", { name: /create project/i });

    expect(within(dialog).getByRole("button", { name: "Create Project" })).toBeDisabled();
  });

  // ---------------------------------------------------------------------------
  // Empty-field validation
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Empty state messages
  // ---------------------------------------------------------------------------

  it("shows search-no-results message when API returns empty for a query", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/customers/")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [],
              pagination_metadata: { page: 1, total_pages: 1, total_count: 0 },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    render(<CustomersConsole />);

    // Type a search query
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search by name/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/search by name/i), {
      target: { value: "nonexistent" },
    });

    await waitFor(() => {
      expect(screen.getByText("No customers matched your search.")).toBeInTheDocument();
    });
  });

  it("shows first-time message when no customers exist and no search query", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/customers/")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [],
              pagination_metadata: { page: 1, total_pages: 1, total_count: 0 },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    render(<CustomersConsole />);

    await waitFor(() => {
      expect(
        screen.getByText("No customers yet. Use the Quick Add form above to create your first one."),
      ).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Enter Payment link visibility by project status
  // ---------------------------------------------------------------------------

  it("shows Enter Payment link for active and on-hold projects", async () => {
    const projects = [
      { id: 10, name: "Active Project", status: "active", customer: 1, site_address: "123 Main" },
      { id: 11, name: "On Hold Project", status: "on_hold", customer: 1, site_address: "456 Oak" },
    ];
    setupDefaultFetch({ projects });
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    // Wait for projects to load, then expand Jane Doe's accordion
    await waitFor(() => {
      expect(screen.getByText("2 projects")).toBeInTheDocument();
    });
    const janeAccordion = screen.getByText("2 projects").closest("button")!;
    fireEvent.click(janeAccordion);

    await waitFor(() => {
      expect(screen.getByText("#10 Active Project")).toBeInTheDocument();
      expect(screen.getByText("#11 On Hold Project")).toBeInTheDocument();
    });

    const paymentLinks = screen.getAllByText("Enter Payment");
    expect(paymentLinks).toHaveLength(2);
  });

  it("hides Enter Payment link for prospect, cancelled, and completed projects", async () => {
    const projects = [
      { id: 10, name: "Prospect Project", status: "prospect", customer: 1, site_address: "111 A St" },
      { id: 11, name: "Cancelled Project", status: "cancelled", customer: 1, site_address: "222 B St" },
      { id: 12, name: "Completed Project", status: "completed", customer: 1, site_address: "333 C St" },
    ];
    setupDefaultFetch({ projects });
    render(<CustomersConsole />);

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("3 projects")).toBeInTheDocument();
    });
    const janeAccordion = screen.getByText("3 projects").closest("button")!;
    fireEvent.click(janeAccordion);

    await waitFor(() => {
      expect(screen.getByText("#10 Prospect Project")).toBeInTheDocument();
      expect(screen.getByText("#11 Cancelled Project")).toBeInTheDocument();
      expect(screen.getByText("#12 Completed Project")).toBeInTheDocument();
    });

    expect(screen.queryByText("Enter Payment")).not.toBeInTheDocument();
  });

  it("shows filter-mismatch message when all customers are filtered out", async () => {
    const allArchived = [
      {
        id: 3,
        display_name: "Archived Corp",
        phone: "",
        email: "",
        billing_address: "",
        is_archived: true,
        projects_count: 0,
        active_projects_count: 0,
        has_project: false,
        has_active_or_on_hold_project: false,
        created_at: "2025-06-01T10:00:00Z",
      },
    ];

    setupDefaultFetch({ customers: allArchived });
    render(<CustomersConsole />);

    // Default activity filter is "active", so archived-only list is fully filtered out
    await waitFor(() => {
      expect(screen.getByText("No customers match the current filters.")).toBeInTheDocument();
    });
  });
});
