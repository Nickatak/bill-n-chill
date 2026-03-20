import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("@/shared/session/use-shared-session", () => ({
  useSharedSessionAuth: vi.fn(() => ({
    token: "test-token",
    email: "owner@test.com",
    authMessage: "Authenticated.",
    role: "owner",
    organization: null,
    capabilities: { invoices: ["view", "create", "send"] },
  })),
}));

vi.mock("@/shared/session/rbac", () => ({
  canDo: vi.fn((_caps: unknown, resource: string) => {
    if (resource === "invoices") return true;
    return false;
  }),
}));

vi.mock("@/shared/shell/printable-context", () => ({
  usePrintable: vi.fn(() => ({ isPrintable: false, setPrintable: vi.fn() })),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) => {
    const { href, ...rest } = props;
    return <a href={String(href ?? "")} {...rest}>{children as React.ReactNode}</a>;
  },
}));

vi.mock("@/features/payments", () => ({
  PaymentRecorder: () => <div data-testid="payment-recorder" />,
}));

vi.mock("@/shared/components/pagination-controls", () => ({
  PaginationControls: () => <div data-testid="pagination-controls" />,
}));

vi.mock("@/shared/document-creator", () => ({
  DocumentCreator: () => <div data-testid="document-creator" />,
  resolveOrganizationBranding: () => ({
    senderDisplayName: "",
    helpEmail: "",
    senderAddressLines: [],
    logoUrl: "",
  }),
}));

vi.stubGlobal("fetch", mockFetch);

import { InvoicesConsole } from "../components/invoices-console";
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
    ...overrides,
  };
}

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 20,
    project: 7,
    customer: 5,
    customer_display_name: "Jane Smith",
    invoice_number: "INV-0020",
    public_ref: "inv-abc-123",
    status: "draft",
    issue_date: "2026-02-01",
    due_date: "2026-03-03",
    sender_name: "Acme Construction",
    sender_email: "billing@acme.com",
    sender_address: "123 Main St",
    sender_logo_url: "",
    terms_text: "Net 30",
    footer_text: "",
    notes_text: "",
    subtotal: "3000.00",
    tax_percent: "8.25",
    tax_total: "247.50",
    total: "3247.50",
    balance_due: "3247.50",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDefaultFetch(overrides: {
  projects?: unknown[];
  invoices?: unknown[];
} = {}) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/contracts/invoices")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: policyContract }),
      });
    }
    if (url.includes("/projects/") && url.includes("/invoices")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: overrides.invoices ?? [makeInvoice()] }),
      });
    }
    if (url.includes("/organization/")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              organization: {
                default_invoice_due_delta: 30,
                invoice_terms_and_conditions: "Net 30",
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
    if (url.includes("/status-events")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InvoicesConsole", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders and fetches policy contract on mount", async () => {
    setupDefaultFetch();
    render(<InvoicesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/contracts/invoices"),
        expect.anything(),
      );
    });
  });

  it("fetches project list on mount", async () => {
    setupDefaultFetch();
    render(<InvoicesConsole scopedProjectId={7} />);

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
    render(<InvoicesConsole scopedProjectId={7} />);

    await waitFor(() =>
      expect(screen.getByText(/can view invoices but cannot create/i)).toBeTruthy(),
    );

    // Restore
    (canDo as ReturnType<typeof vi.fn>).mockImplementation(
      (_caps: unknown, resource: string) => resource === "invoices",
    );
  });

  it("renders status filter section", async () => {
    setupDefaultFetch();
    render(<InvoicesConsole scopedProjectId={7} />);

    // The status filter section renders pill buttons for each status from the contract.
    // After the contract loads, "Draft" should appear as a filter pill.
    await waitFor(() =>
      expect(screen.getByText("Draft")).toBeTruthy(),
    );
  });

  it("shows invoice search input", async () => {
    setupDefaultFetch();
    render(<InvoicesConsole scopedProjectId={7} />);

    await waitFor(() =>
      expect(screen.getByPlaceholderText("Search invoices...")).toBeTruthy(),
    );
  });

  it("fetches invoices for the scoped project on mount", async () => {
    setupDefaultFetch();
    render(<InvoicesConsole scopedProjectId={7} />);

    await waitFor(() => {
      const invoiceCalls = mockFetch.mock.calls.filter(
        (call) => String(call[0]).includes("/projects/7/invoices"),
      );
      expect(invoiceCalls.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 3000 });
  });
});
