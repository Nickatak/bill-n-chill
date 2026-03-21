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
  // No-email customer warning
  // ---------------------------------------------------------------------------

  it("shows no-email warning when Sent is selected and customer has no email", async () => {
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

    // Wait for the estimate to auto-select and the "Sent" transition pill to appear
    const sentButton = await screen.findByRole("button", { name: "Sent" }, { timeout: 3000 });
    fireEvent.click(sentButton);

    expect(
      screen.getByText(/WARNING.*no email on file/),
    ).toBeInTheDocument();
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

  it("does not show no-email warning when Sent is selected and customer has email", async () => {
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

    const sentButton = await screen.findByRole("button", { name: "Sent" }, { timeout: 3000 });
    fireEvent.click(sentButton);

    expect(
      screen.queryByText(/WARNING.*no email on file/),
    ).not.toBeInTheDocument();
  });
});
