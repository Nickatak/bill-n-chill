import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("@/shared/date-format", async () => {
  const actual = await vi.importActual<typeof import("@/shared/date-format")>("@/shared/date-format");
  return {
    ...actual,
    todayDateInput: () => "2026-03-21",
  };
});

vi.stubGlobal("fetch", mockFetch);

import { InvoicesTab } from "../components/invoices-tab";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    project: 10,
    project_name: "Kitchen Remodel",
    customer: 20,
    customer_display_name: "Jane Doe",
    invoice_number: "INV-001",
    status: "sent",
    issue_date: "2026-03-01",
    due_date: "2026-03-31",
    total: "5000.00",
    balance_due: "5000.00",
    allocations: [],
    ...overrides,
  };
}

function makeAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    applied_amount: "2000.00",
    payment_date: "2026-03-10",
    payment_method: "check",
    payment_status: "settled",
    payment_reference: "CHK-1234",
    created_at: "2026-03-10T10:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupFetch(invoices: unknown[] = [makeInvoice()]) {
  mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
    if (!opts?.method || opts.method === "GET") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: invoices }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

function renderTab(props: Partial<React.ComponentProps<typeof InvoicesTab>> = {}) {
  return render(
    <InvoicesTab
      authToken="test-token"
      baseUrl="http://localhost:8000/api/v1"
      isMobile={false}
      {...props}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InvoicesTab", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  // -------------------------------------------------------------------------
  // Loading & rendering
  // -------------------------------------------------------------------------

  it("shows loading state then renders invoices", async () => {
    setupFetch();
    renderTab();

    expect(screen.getByText("Loading invoices...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText("Loading invoices...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("#INV-001")).toBeInTheDocument();
  });

  it("shows empty state when no invoices match filters", async () => {
    setupFetch([]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("No invoices found.")).toBeInTheDocument();
    });
  });

  it("excludes draft invoices from the list", async () => {
    setupFetch([
      makeInvoice({ id: 1, status: "draft", invoice_number: "INV-DRAFT" }),
      makeInvoice({ id: 2, status: "sent", invoice_number: "INV-SENT" }),
    ]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("#INV-SENT")).toBeInTheDocument();
    });

    expect(screen.queryByText("#INV-DRAFT")).not.toBeInTheDocument();
  });

  it("renders nested payment allocations under invoice", async () => {
    setupFetch([
      makeInvoice({
        allocations: [
          makeAllocation({ id: 100, applied_amount: "2000.00", payment_reference: "CHK-1234" }),
        ],
      }),
    ]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("$2,000.00")).toBeInTheDocument();
    });

    expect(screen.getByText(/CHK-1234/)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Filters
  // -------------------------------------------------------------------------

  it("hides voided invoices by default, shows them when toggled", async () => {
    setupFetch([
      makeInvoice({ id: 1, status: "sent", invoice_number: "INV-SENT" }),
      makeInvoice({ id: 2, status: "void", invoice_number: "INV-VOID" }),
    ]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("#INV-SENT")).toBeInTheDocument();
    });

    // Voided hidden by default
    expect(screen.queryByText("#INV-VOID")).not.toBeInTheDocument();

    // Toggle "Hide voided" off
    fireEvent.click(screen.getByRole("button", { name: "Hide voided" }));

    expect(screen.getByText("#INV-VOID")).toBeInTheDocument();
  });

  it("filters to unpaid only by default, shows paid when toggled", async () => {
    setupFetch([
      makeInvoice({ id: 1, status: "sent", invoice_number: "INV-UNPAID", balance_due: "5000.00" }),
      makeInvoice({ id: 2, status: "paid", invoice_number: "INV-PAID", balance_due: "0.00" }),
    ]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("#INV-UNPAID")).toBeInTheDocument();
    });

    // Paid hidden by default
    expect(screen.queryByText("#INV-PAID")).not.toBeInTheDocument();

    // Toggle "Unpaid only" off
    fireEvent.click(screen.getByRole("button", { name: "Unpaid only" }));

    expect(screen.getByText("#INV-PAID")).toBeInTheDocument();
  });

  it("search filters by customer name", async () => {
    setupFetch([
      makeInvoice({ id: 1, customer_display_name: "Jane Doe", invoice_number: "INV-001" }),
      makeInvoice({ id: 2, customer_display_name: "Bob Smith", invoice_number: "INV-002" }),
    ]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("#INV-001")).toBeInTheDocument();
      expect(screen.getByText("#INV-002")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Search invoices..."), {
      target: { value: "Bob" },
    });

    expect(screen.queryByText("#INV-001")).not.toBeInTheDocument();
    expect(screen.getByText("#INV-002")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Payment recording (create)
  // -------------------------------------------------------------------------

  it("opens payment form when invoice is clicked and records payment", async () => {
    setupFetch([makeInvoice({ balance_due: "5000.00" })]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    // Click the invoice row to select it
    fireEvent.click(screen.getByText("Jane Doe"));

    // Form should appear with heading and pre-filled amount
    expect(screen.getByText("Record Payment", { selector: "h4" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("5000.00")).toBeInTheDocument();

    // Mock POST
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { id: 42 } }),
        });
      }
      // Reload after create returns empty
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Record Payment" }));

    // After success, the form closes (selection cleared) and data reloads.
    // The mock reload returns empty, so the form heading should be gone.
    await waitFor(() => {
      expect(screen.queryByText("Record Payment", { selector: "h4" })).not.toBeInTheDocument();
    });

    // Verify the POST was called
    const postCall = mockFetch.mock.calls.find(
      (call: unknown[]) => (call[1] as RequestInit)?.method === "POST",
    );
    expect(postCall).toBeTruthy();
    const postBody = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(postBody.direction).toBe("inbound");
    expect(postBody.target_type).toBe("invoice");
    expect(postBody.target_id).toBe(1);
  });

  it("validates amount is required before recording", async () => {
    setupFetch([makeInvoice({ balance_due: "5000.00" })]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Jane Doe"));

    // Clear the amount
    fireEvent.change(screen.getByDisplayValue("5000.00"), {
      target: { value: "" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Record Payment" }));

    expect(screen.getByText("Enter a payment amount.")).toBeInTheDocument();
  });

  it("validates amount does not exceed balance due", async () => {
    setupFetch([makeInvoice({ balance_due: "100.00" })]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Jane Doe"));

    fireEvent.change(screen.getByDisplayValue("100.00"), {
      target: { value: "500" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Record Payment" }));

    expect(screen.getByText(/exceeds balance due/)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Payment editing
  // -------------------------------------------------------------------------

  it("opens edit form when payment allocation is clicked", async () => {
    setupFetch([
      makeInvoice({
        allocations: [makeAllocation({ id: 100, applied_amount: "2000.00" })],
      }),
    ]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("Check")).toBeInTheDocument();
    });

    // Click the payment card (identified by its method label which is unique to payment cards)
    const paymentCard = screen.getByText("Check").closest("[role='button']")!;
    fireEvent.click(paymentCard);

    expect(screen.getByText("Edit Payment")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Void Payment" })).toBeInTheDocument();
  });

  it("saves payment edit via PATCH", async () => {
    setupFetch([
      makeInvoice({
        allocations: [makeAllocation({ id: 100 })],
      }),
    ]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("Check")).toBeInTheDocument();
    });

    const paymentCard = screen.getByText("Check").closest("[role='button']")!;
    fireEvent.click(paymentCard);

    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { id: 100 } }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    // After success, the form closes (selection cleared) and data reloads
    await waitFor(() => {
      expect(screen.queryByText("Edit Payment")).not.toBeInTheDocument();
    });

    // Verify the PATCH was called
    const patchCall = mockFetch.mock.calls.find(
      (call: unknown[]) => (call[1] as RequestInit)?.method === "PATCH",
    );
    expect(patchCall).toBeTruthy();
  });

  it("voids payment via PATCH", async () => {
    setupFetch([
      makeInvoice({
        allocations: [makeAllocation({ id: 100 })],
      }),
    ]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("Check")).toBeInTheDocument();
    });

    const paymentCard = screen.getByText("Check").closest("[role='button']")!;
    fireEvent.click(paymentCard);

    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { id: 100, status: "void" } }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Void Payment" }));

    // After success, the form closes and data reloads
    await waitFor(() => {
      expect(screen.queryByText("Void Payment")).not.toBeInTheDocument();
    });

    // Verify the PATCH was called with status: void
    const patchCall = mockFetch.mock.calls.find(
      (call: unknown[]) => {
        const opts = call[1] as RequestInit | undefined;
        return opts?.method === "PATCH" && opts.body && JSON.parse(opts.body as string).status === "void";
      },
    );
    expect(patchCall).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it("shows API error on payment create failure", async () => {
    setupFetch([makeInvoice({ balance_due: "5000.00" })]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Jane Doe"));

    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: { message: "Duplicate payment." } }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Record Payment" }));

    await waitFor(() => {
      expect(screen.getByText("Duplicate payment.")).toBeInTheDocument();
    });
  });

  it("shows network error on payment create fetch rejection", async () => {
    setupFetch([makeInvoice({ balance_due: "5000.00" })]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Jane Doe"));

    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Record Payment" }));

    await waitFor(() => {
      expect(screen.getByText("Network error — could not record payment.")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Missing reference warning
  // -------------------------------------------------------------------------

  it("shows missing reference warning for check payments without ref #", async () => {
    setupFetch([
      makeInvoice({
        allocations: [
          makeAllocation({ payment_method: "check", payment_reference: "" }),
        ],
      }),
    ]);
    renderTab();

    await waitFor(() => {
      expect(screen.getAllByText("No ref #").length).toBeGreaterThanOrEqual(1);
    });
  });
});
