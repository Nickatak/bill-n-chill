import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn());
const mockSearchParams = vi.hoisted(() => new URLSearchParams());

vi.mock("@/shared/session/use-shared-session", () => ({
  useSharedSessionAuth: vi.fn(() => ({
    token: "test-token",
    email: "owner@test.com",
    authMessage: "Authenticated.",
    role: "owner",
    organization: null,
    capabilities: { vendor_bills: ["view", "create", "approve", "pay"] },
  })),
}));

vi.mock("@/shared/session/rbac", () => ({
  canDo: vi.fn((_caps: unknown, resource: string) => {
    if (resource === "vendor_bills") return true;
    return false;
  }),
}));

vi.mock("@/shared/shell/printable-context", () => ({
  usePrintable: vi.fn(() => ({ isPrintable: false, setPrintable: vi.fn() })),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() })),
  useSearchParams: vi.fn(() => mockSearchParams),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) => {
    const { href, ...rest } = props;
    return <a href={String(href ?? "")} {...rest}>{children as React.ReactNode}</a>;
  },
}));

vi.mock("@/shared/project-list-viewer", () => ({
  collapseToggleButtonStyles: { collapseButton: "collapseButton" },
  ProjectListViewer: (props: Record<string, unknown>) => (
    <div data-testid="project-list-viewer">{String(props.contextHint ?? "")}</div>
  ),
}));

vi.mock("@/features/payments", () => ({
  PaymentRecorder: () => <div data-testid="payment-recorder" />,
}));

vi.stubGlobal("fetch", mockFetch);

// jsdom doesn't implement HTMLDialogElement methods
HTMLDialogElement.prototype.showModal = HTMLDialogElement.prototype.showModal || vi.fn();
HTMLDialogElement.prototype.close = HTMLDialogElement.prototype.close || vi.fn();

import { VendorBillsConsole } from "../components/vendor-bills-console";
import type { VendorBillPolicyContract } from "../types";

// ---------------------------------------------------------------------------
// Inline policy contract fixture
// ---------------------------------------------------------------------------

const policyContract: VendorBillPolicyContract = {
  policy_version: "1",
  statuses: ["received", "approved", "disputed", "closed", "void"],
  status_labels: {
    received: "Received",
    approved: "Approved",
    disputed: "Disputed",
    closed: "Closed",
    void: "Void",
  },
  default_create_status: "received",
  allowed_status_transitions: {
    received: ["approved", "void"],
    approved: ["disputed", "closed", "void"],
    disputed: ["approved", "closed", "void"],
    closed: [],
    void: [],
  },
  terminal_statuses: ["closed", "void"],
  kinds: ["bill", "receipt"],
  kind_labels: { bill: "Bill", receipt: "Receipt" },
};

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    name: "Kitchen Remodel",
    customer_display_name: "Jane Smith",
    status: "active",
    ...overrides,
  };
}

function makeVendorBill(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    project: 7,
    project_name: "Kitchen Remodel",
    vendor: 1,
    vendor_name: "Acme Lumber",
    bill_number: "INV-001",
    status: "received",
    payment_status: "unpaid",
    received_date: "2026-03-01",
    issue_date: "2026-03-01",
    due_date: "2026-04-01",
    subtotal: "5000.00",
    tax_amount: "0.00",
    shipping_amount: "0.00",
    total: "5000.00",
    balance_due: "5000.00",
    line_items: [],
    notes: "",
    created_at: "2026-03-01T10:00:00Z",
    updated_at: "2026-03-01T10:00:00Z",
    ...overrides,
  };
}

function makeVendor(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Acme Lumber",
    vendor_type: "trade",
    is_canonical: false,
    email: "acme@example.com",
    is_active: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDefaultFetch(overrides: {
  projects?: unknown[];
  vendorBills?: unknown[];
  vendors?: unknown[];
  costCodes?: unknown[];
} = {}) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/contracts/vendor-bills")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: policyContract }),
      });
    }
    if (url.includes("/projects/") && url.includes("/vendor-bills")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: overrides.vendorBills ?? [makeVendorBill()] }),
      });
    }
    if (url.includes("/vendors")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: overrides.vendors ?? [makeVendor()] }),
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

describe("VendorBillsConsole", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders and fetches policy contract on mount", async () => {
    setupDefaultFetch();
    render(<VendorBillsConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/contracts/vendor-bills"),
        expect.anything(),
      );
    });
  });

  it("fetches project list on mount", async () => {
    setupDefaultFetch();
    render(<VendorBillsConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/projects/"),
        expect.anything(),
      );
    });
  });

  it("shows read-only notice when user lacks create capability", async () => {
    const { canDo } = await import("@/shared/session/rbac");
    (canDo as ReturnType<typeof vi.fn>).mockReturnValue(false);

    setupDefaultFetch();
    render(<VendorBillsConsole scopedProjectId={7} />);

    await waitFor(() =>
      expect(screen.getByText(/can view bills but cannot create or update/i)).toBeTruthy(),
    );

    // Restore
    (canDo as ReturnType<typeof vi.fn>).mockImplementation(
      (_caps: unknown, resource: string) => resource === "vendor_bills",
    );
  });

  it("renders vendor bills header when project is selected", async () => {
    setupDefaultFetch({ projects: [makeProject({ id: 7, name: "Kitchen Remodel" })] });
    render(<VendorBillsConsole scopedProjectId={7} />);

    await waitFor(() =>
      expect(screen.getByText(/Bills for: Kitchen Remodel/)).toBeTruthy(),
    );
  });

  it("fetches vendor bills when project is selected", async () => {
    setupDefaultFetch();
    render(<VendorBillsConsole scopedProjectId={7} />);

    await waitFor(() => {
      const billCalls = mockFetch.mock.calls.filter(
        (call) => String(call[0]).includes("/projects/7/vendor-bills"),
      );
      expect(billCalls.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 3000 });
  });
});
