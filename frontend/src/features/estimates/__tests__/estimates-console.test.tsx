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
  canDo: vi.fn((_caps: unknown, resource: string, action: string) => {
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

vi.stubGlobal("fetch", mockFetch);

// jsdom doesn't implement HTMLDialogElement methods
HTMLDialogElement.prototype.showModal = HTMLDialogElement.prototype.showModal || vi.fn();
HTMLDialogElement.prototype.close = HTMLDialogElement.prototype.close || vi.fn();

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
} = {}) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/contracts/estimates")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: policyContract }),
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
  beforeEach(() => {
    mockFetch.mockReset();
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
        ([url]: [string]) => url.includes("/projects/7/estimates"),
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
});
