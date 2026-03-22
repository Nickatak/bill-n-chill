import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
const mockSearchParams = vi.hoisted(() => new URLSearchParams());

vi.mock("@/shared/session/use-shared-session", () => ({
  useSharedSessionAuth: vi.fn(() => ({
    token: "test-token",
    email: "owner@test.com",
    authMessage: "Authenticated.",
    role: "owner",
    organization: null,
    capabilities: { estimates: ["view", "create", "send", "approve"] },
  })),
}));

vi.mock("@/shared/session/rbac", () => ({
  canDo: vi.fn((_caps: unknown, resource: string) => {
    if (resource === "estimates") return true;
    return false;
  }),
}));

vi.mock("@/shared/shell/printable-context", () => ({
  usePrintable: vi.fn(() => ({ isPrintable: false, setPrintable: vi.fn() })),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: mockPush, replace: vi.fn(), back: vi.fn() })),
  useSearchParams: vi.fn(() => mockSearchParams),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) => {
    const { href, ...rest } = props;
    return <a href={String(href ?? "")} {...rest}>{children as React.ReactNode}</a>;
  },
}));

vi.mock("../components/estimates-workspace-panel", () => ({
  EstimatesWorkspacePanel: (props: Record<string, unknown>) => (
    <div data-testid="workspace-panel">
      {props.workspaceBadgeLabel && (
        <span>{String(props.workspaceBadgeLabel)}</span>
      )}
      {!props.canMutateEstimates && (
        <p>Role `{String(props.role)}` can view estimates but cannot create or update.</p>
      )}
    </div>
  ),
}));

vi.stubGlobal("fetch", mockFetch);

import { EstimatesConsole } from "../components/estimates-console";
import { policyContract } from "./fixtures";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    name: "Kitchen Remodel",
    customer_display_name: "Jane Smith",
    status: "active",
    contract_value_original: "100000.00",
    contract_value_current: "100000.00",
    ...overrides,
  };
}

function makeEstimate(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    project: 7,
    version: 1,
    family_key: "1",
    status: "draft",
    title: "Foundation Work",
    subtotal: "5000.00",
    tax_percent: "0",
    grand_total: "5000.00",
    valid_through: "2026-04-01",
    terms_text: "",
    estimate_date: "2026-03-01",
    line_items: [],
    is_active_estimate: false,
    created_at: "2026-03-01T10:00:00Z",
    updated_at: "2026-03-01T10:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDefaultFetch(overrides: {
  projects?: unknown[];
  estimates?: unknown[];
  costCodes?: unknown[];
  statusEvents?: unknown[];
} = {}) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/contracts/estimates")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: policyContract }),
      });
    }
    if (url.includes("/status-events")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: overrides.statusEvents ?? [] }),
      });
    }
    if (url.includes("/projects/") && url.includes("/estimates")) {
      // Estimates endpoint returns data as direct array
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: overrides.estimates ?? [makeEstimate()] }),
      });
    }
    if (url.includes("/organization/")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              organization: {
                default_estimate_valid_delta: 30,
                estimate_terms_and_conditions: "Standard terms",
              },
            },
          }),
      });
    }
    if (url.includes("/projects")) {
      // Projects endpoint returns data as direct array
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: overrides.projects ?? [makeProject()] }),
      });
    }
    if (url.includes("/cost-codes")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: overrides.costCodes ?? [] }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EstimatesConsole", () => {
  beforeEach(async () => {
    mockFetch.mockReset();
    // Ensure canDo mock is restored to default (may leak from read-only test)
    const { canDo } = await import("@/shared/session/rbac");
    (canDo as ReturnType<typeof vi.fn>).mockImplementation(
      (_caps: unknown, resource: string) => resource === "estimates",
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("renders and fetches policy contract on mount", async () => {
    setupDefaultFetch();
    render(<EstimatesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/contracts/estimates"),
        expect.anything(),
      );
    });
  });

  it("fetches and displays project estimates when scoped to a project", async () => {
    setupDefaultFetch();
    render(<EstimatesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/projects/7/estimates"),
        expect.anything(),
      );
    });
  });

  it("loads estimates for the selected project after dependencies resolve", async () => {
    setupDefaultFetch();
    render(<EstimatesConsole scopedProjectId={7} />);

    // After loading deps + selecting project, estimates endpoint should be called
    await waitFor(() => {
      const estimateCalls = mockFetch.mock.calls.filter(
        (call) => String(call[0]).includes("/projects/7/estimates"),
      );
      expect(estimateCalls.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 3000 });
  });

  it("renders status filter section with label", async () => {
    setupDefaultFetch();
    render(<EstimatesConsole scopedProjectId={7} />);

    await waitFor(() =>
      expect(screen.getByText("Estimate status filter")).toBeTruthy(),
    );
  });

  it("renders empty state when no estimates exist", async () => {
    setupDefaultFetch({ estimates: [] });
    render(<EstimatesConsole scopedProjectId={7} />);

    await waitFor(() =>
      expect(screen.getByText(/No estimates yet/i)).toBeTruthy(),
    );
  });

  it("shows read-only hint when user lacks create capability", async () => {
    const { canDo } = await import("@/shared/session/rbac");
    (canDo as ReturnType<typeof vi.fn>).mockReturnValue(false);

    setupDefaultFetch();
    render(<EstimatesConsole scopedProjectId={7} />);

    await waitFor(() =>
      expect(screen.getByText(/can view estimates but cannot create/i)).toBeTruthy(),
    );

    // Restore
    (canDo as ReturnType<typeof vi.fn>).mockImplementation(
      (_caps: unknown, resource: string) => resource === "estimates",
    );
  });

  it("displays project name in lifecycle header", async () => {
    setupDefaultFetch({ projects: [makeProject({ id: 7, name: "Kitchen Remodel" })] });
    render(<EstimatesConsole scopedProjectId={7} />);

    await waitFor(() =>
      expect(screen.getByText(/Estimates for: Kitchen Remodel/)).toBeTruthy(),
    );
  });

  it("fetches cost codes for the project", async () => {
    setupDefaultFetch();
    render(<EstimatesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/cost-codes"),
        expect.anything(),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Action buttons & confirmation panel
  // ---------------------------------------------------------------------------

  it("shows action buttons for a draft estimate", async () => {
    setupDefaultFetch({
      estimates: [makeEstimate({ id: 42, status: "draft" })],
    });
    render(<EstimatesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("Foundation Work")).toBeInTheDocument();
    }, { timeout: 3000 });

    // Click the family card to select the estimate
    const familyCard = screen.getByText("Foundation Work").closest("[role='button']")!;
    fireEvent.click(familyCard);

    await waitFor(() => {
      // Policy fixture allows draft → sent only
      expect(screen.getByRole("button", { name: "Send to Customer" })).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("shows confirmation panel when Send to Customer is clicked", async () => {
    setupDefaultFetch({
      estimates: [makeEstimate({ id: 42, status: "draft" })],
    });
    render(<EstimatesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("Foundation Work")).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByText("Foundation Work").closest("[role='button']")!);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send to Customer" })).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "Send to Customer" }));

    expect(screen.getByText(/Send estimate #42 v1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm Send to Customer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("shows no-email notice in confirmation when customer has no email", async () => {
    setupDefaultFetch({
      estimates: [
        makeEstimate({
          id: 42,
          status: "draft",
          project_context: {
            id: 7,
            name: "Kitchen Remodel",
            status: "active",
            customer_display_name: "Jane Smith",
            customer_email: "",
          },
        }),
      ],
    });
    render(<EstimatesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("Foundation Work")).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByText("Foundation Work").closest("[role='button']")!);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send to Customer" })).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "Send to Customer" }));

    expect(screen.getByText(/No email on file/)).toBeInTheDocument();
  });

  it("shows email notice in confirmation when customer has email", async () => {
    setupDefaultFetch({
      projects: [makeProject({ customer_email: "jane@example.com" })],
      estimates: [
        makeEstimate({
          id: 42,
          status: "draft",
          project_context: {
            id: 7,
            name: "Kitchen Remodel",
            status: "active",
            customer_display_name: "Jane Smith",
            customer_email: "jane@example.com",
          },
        }),
      ],
    });
    render(<EstimatesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("Foundation Work")).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByText("Foundation Work").closest("[role='button']")!);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send to Customer" })).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "Send to Customer" }));

    expect(screen.getByText(/Email notification will be sent to jane@example.com/)).toBeInTheDocument();
  });

  it("closes confirmation panel when Cancel is clicked", async () => {
    setupDefaultFetch({
      estimates: [makeEstimate({ id: 42, status: "draft" })],
    });
    render(<EstimatesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("Foundation Work")).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByText("Foundation Work").closest("[role='button']")!);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send to Customer" })).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "Send to Customer" }));
    expect(screen.getByText(/Send estimate #42 v1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Send estimate #42 v1/)).not.toBeInTheDocument();
  });

  it("shows Re-send and Mark Approved buttons for a sent estimate", async () => {
    setupDefaultFetch({
      estimates: [makeEstimate({ id: 42, status: "sent" })],
    });
    render(<EstimatesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("Foundation Work")).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByText("Foundation Work").closest("[role='button']")!);

    await waitFor(() => {
      // Policy fixture allows sent → approved, rejected
      expect(screen.getByRole("button", { name: "Mark Approved" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Mark Rejected" })).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("shows no action buttons for an approved estimate", async () => {
    setupDefaultFetch({
      estimates: [makeEstimate({ id: 42, status: "approved" })],
    });
    render(<EstimatesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("Foundation Work")).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByText("Foundation Work").closest("[role='button']")!);

    // Approved is terminal — no action buttons should appear
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Send to Customer" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Void Estimate" })).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Confirm action → PATCH + success message
  // ---------------------------------------------------------------------------

  it("sends PATCH and shows success message on confirm send", async () => {
    setupDefaultFetch({
      estimates: [makeEstimate({ id: 42, status: "draft", public_ref: "foundation-work--abc123" })],
    });
    render(<EstimatesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("Foundation Work")).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByText("Foundation Work").closest("[role='button']")!);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send to Customer" })).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "Send to Customer" }));

    // Mock the PATCH response
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: makeEstimate({ id: 42, status: "sent", public_ref: "foundation-work--abc123", sender_name: "Test Org" }),
            email_sent: true,
          }),
        });
      }
      // Status events reload
      if (String(url).includes("/status-events")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirm Send to Customer" }));

    await waitFor(() => {
      expect(screen.getByText(/Sent estimate #42/)).toBeInTheDocument();
    }, { timeout: 3000 });

    // Confirmation panel should be closed
    expect(screen.queryByText(/Send estimate #42 v1/)).not.toBeInTheDocument();

    // Verify PATCH was called with correct body
    const patchCall = mockFetch.mock.calls.find(
      (call: unknown[]) => (call[1] as RequestInit)?.method === "PATCH",
    );
    expect(patchCall).toBeTruthy();
    const patchBody = JSON.parse((patchCall![1] as RequestInit).body as string);
    expect(patchBody.status).toBe("sent");
  });

  it("shows success message on confirm mark approved", async () => {
    setupDefaultFetch({
      estimates: [makeEstimate({ id: 42, status: "sent" })],
    });
    render(<EstimatesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("Foundation Work")).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByText("Foundation Work").closest("[role='button']")!);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Mark Approved" })).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "Mark Approved" }));
    expect(screen.getByText(/Mark estimate #42 v1 as approved/)).toBeInTheDocument();

    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: makeEstimate({ id: 42, status: "approved" }),
          }),
        });
      }
      if (String(url).includes("/status-events")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirm Mark Approved" }));

    await waitFor(() => {
      expect(screen.getByText(/Marked estimate #42 as approved/)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("shows error message on confirm when PATCH fails", async () => {
    setupDefaultFetch({
      estimates: [makeEstimate({ id: 42, status: "draft" })],
    });
    render(<EstimatesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("Foundation Work")).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByText("Foundation Work").closest("[role='button']")!);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send to Customer" })).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "Send to Customer" }));

    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({
            error: { message: "Invalid status transition." },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirm Send to Customer" }));

    await waitFor(() => {
      expect(screen.getByText(/Invalid status transition/)).toBeInTheDocument();
    }, { timeout: 3000 });

    // Confirmation panel should remain open on error
    expect(screen.getByRole("button", { name: "Confirm Send to Customer" })).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Terminal project guards
  // -------------------------------------------------------------------------

  it("shows read-only workspace when project is cancelled", async () => {
    setupDefaultFetch({ projects: [makeProject({ status: "cancelled" })] });
    render(<EstimatesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("READ-ONLY")).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("shows read-only workspace when project is completed", async () => {
    setupDefaultFetch({ projects: [makeProject({ status: "completed" })] });
    render(<EstimatesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("READ-ONLY")).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});
