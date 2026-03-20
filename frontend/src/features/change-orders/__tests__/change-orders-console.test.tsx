import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

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
    capabilities: { change_orders: ["view", "create", "send", "approve"] },
  })),
}));

vi.mock("@/shared/session/rbac", () => ({
  canDo: vi.fn((_caps: unknown, resource: string) => {
    if (resource === "change_orders") return true;
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

import { ChangeOrdersConsole } from "../components/change-orders-console";
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

function makeChangeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    project: 7,
    family_key: "1",
    revision_number: 1,
    title: "Add bathroom tile",
    status: "draft",
    amount_delta: "2500.00",
    days_delta: 5,
    reason: "Client requested upgrade",
    terms_text: "",
    origin_estimate: 42,
    origin_estimate_version: 1,
    previous_change_order: null,
    requested_by: 1,
    requested_by_email: "owner@test.com",
    approved_by: null,
    approved_by_email: null,
    approved_at: null,
    line_items: [],
    line_total_delta: "2500.00",
    is_latest_revision: true,
    created_at: "2026-03-01T10:00:00Z",
    updated_at: "2026-03-01T10:00:00Z",
    ...overrides,
  };
}

function makeEstimate(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    title: "Foundation Work",
    version: 1,
    status: "approved",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDefaultFetch(overrides: {
  projects?: unknown[];
  changeOrders?: unknown[];
  costCodes?: unknown[];
  estimates?: unknown[];
} = {}) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/contracts/change-orders")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: policyContract }),
      });
    }
    if (url.includes("/projects/") && url.includes("/change-orders")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: overrides.changeOrders ?? [makeChangeOrder()] }),
      });
    }
    if (url.includes("/projects/") && url.includes("/estimates")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: overrides.estimates ?? [makeEstimate()] }),
      });
    }
    if (url.includes("/projects/") && url.includes("/audit-events")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });
    }
    if (url.includes("/estimates/") && url.includes("/status-events")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          data: [
            { to_status: "approved", changed_at: "2026-02-15T10:00:00Z", changed_by_email: "owner@test.com" },
          ],
        }),
      });
    }
    if (url.includes("/organization/")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              organization: {
                change_order_terms_and_conditions: "Standard terms",
              },
            },
          }),
      });
    }
    if (url.includes("/projects")) {
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

describe("ChangeOrdersConsole", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders and fetches policy contract on mount", async () => {
    setupDefaultFetch();
    render(<ChangeOrdersConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/contracts/change-orders"),
        expect.anything(),
      );
    });
  });

  it("fetches project data when scoped to a project", async () => {
    setupDefaultFetch();
    render(<ChangeOrdersConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/projects/7/change-orders"),
        expect.anything(),
      );
    });
  });

  it("shows read-only hint when user lacks create capability", async () => {
    const { canDo } = await import("@/shared/session/rbac");
    (canDo as ReturnType<typeof vi.fn>).mockReturnValue(false);

    setupDefaultFetch();
    render(<ChangeOrdersConsole scopedProjectId={7} />);

    await waitFor(() =>
      expect(screen.getByText(/can view change orders but cannot create or update/i)).toBeTruthy(),
    );

    // Restore
    (canDo as ReturnType<typeof vi.fn>).mockImplementation(
      (_caps: unknown, resource: string) => resource === "change_orders",
    );
  });

  it("renders lifecycle section with project name", async () => {
    setupDefaultFetch({ projects: [makeProject({ id: 7, name: "Kitchen Remodel" })] });
    render(<ChangeOrdersConsole scopedProjectId={7} />);

    await waitFor(() =>
      expect(screen.getByText(/Change Orders for: Kitchen Remodel/)).toBeTruthy(),
    );
  });

  it("fetches cost codes", async () => {
    setupDefaultFetch();
    render(<ChangeOrdersConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/cost-codes"),
        expect.anything(),
      );
    });
  });

  it("shows empty state when no change orders exist for the origin estimate", async () => {
    setupDefaultFetch({ changeOrders: [] });
    render(<ChangeOrdersConsole scopedProjectId={7} />);

    await waitFor(() =>
      expect(
        screen.getByText(/No change orders have been created yet for this approved origin estimate/i),
      ).toBeTruthy(),
    );
  });
});
