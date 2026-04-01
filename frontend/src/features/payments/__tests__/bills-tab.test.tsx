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

import { BillsTab } from "../components/bills-tab";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeBill(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    project: 10,
    project_name: "Kitchen Remodel",
    vendor: 30,
    vendor_name: "Ace Lumber",
    bill_number: "BILL-001",
    status: "open",
    payment_status: "unpaid",
    received_date: "2026-03-01",
    issue_date: "2026-03-01",
    due_date: "2026-03-31",
    subtotal: "3000.00",
    tax_total: "0.00",
    shipping_total: "0.00",
    total: "3000.00",
    balance_due: "3000.00",
    allocations: [],
    line_items: [],
    notes: "",
    created_at: "2026-03-01T10:00:00Z",
    updated_at: "2026-03-01T10:00:00Z",
    ...overrides,
  };
}

function makeAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 200,
    payment: 50,
    applied_amount: "1500.00",
    payment_date: "2026-03-10",
    payment_method: "ach",
    payment_status: "settled",
    payment_reference: "ACH-5678",
    created_at: "2026-03-10T10:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupFetch(bills: unknown[] = [makeBill()]) {
  mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
    if (!opts?.method || opts.method === "GET") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: bills }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

function renderTab(props: Partial<React.ComponentProps<typeof BillsTab>> = {}) {
  return render(
    <BillsTab
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

describe("BillsTab", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows loading state then renders bills", async () => {
    setupFetch();
    renderTab();

    expect(screen.getByText("Loading bills...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText("Loading bills...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Ace Lumber")).toBeInTheDocument();
    expect(screen.getByText("#BILL-001")).toBeInTheDocument();
  });

  it("shows empty state when no bills match filters", async () => {
    setupFetch([]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("No vendor bills found.")).toBeInTheDocument();
    });
  });

  it("renders nested payment allocations under bill", async () => {
    setupFetch([
      makeBill({
        allocations: [makeAllocation({ id: 200, applied_amount: "1500.00", payment_reference: "ACH-5678" })],
      }),
    ]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("$1,500.00")).toBeInTheDocument();
    });

    expect(screen.getByText(/ACH-5678/)).toBeInTheDocument();
  });

  it("hides voided/closed bills by default, shows them when toggled", async () => {
    setupFetch([
      makeBill({ id: 1, status: "open", bill_number: "BILL-OPEN" }),
      makeBill({ id: 2, status: "void", bill_number: "BILL-VOID" }),
      makeBill({ id: 3, status: "closed", bill_number: "BILL-CLOSED" }),
    ]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("#BILL-OPEN")).toBeInTheDocument();
    });

    expect(screen.queryByText("#BILL-VOID")).not.toBeInTheDocument();
    expect(screen.queryByText("#BILL-CLOSED")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide closed" }));

    expect(screen.getByText("#BILL-VOID")).toBeInTheDocument();
    expect(screen.getByText("#BILL-CLOSED")).toBeInTheDocument();
  });

  it("filters to unpaid only by default, shows paid when toggled", async () => {
    setupFetch([
      makeBill({ id: 1, payment_status: "unpaid", bill_number: "BILL-UNPAID" }),
      makeBill({ id: 2, payment_status: "paid", bill_number: "BILL-PAID" }),
    ]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("#BILL-UNPAID")).toBeInTheDocument();
    });

    expect(screen.queryByText("#BILL-PAID")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unpaid only" }));

    expect(screen.getByText("#BILL-PAID")).toBeInTheDocument();
  });

  it("search filters by vendor name", async () => {
    setupFetch([
      makeBill({ id: 1, vendor_name: "Ace Lumber", bill_number: "BILL-001" }),
      makeBill({ id: 2, vendor_name: "Pro Electric", bill_number: "BILL-002" }),
    ]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("#BILL-001")).toBeInTheDocument();
      expect(screen.getByText("#BILL-002")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Search bills..."), {
      target: { value: "Electric" },
    });

    expect(screen.queryByText("#BILL-001")).not.toBeInTheDocument();
    expect(screen.getByText("#BILL-002")).toBeInTheDocument();
  });

  it("opens payment form on bill click and records outbound payment", async () => {
    setupFetch([makeBill({ balance_due: "3000.00" })]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("Ace Lumber")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Ace Lumber"));

    expect(screen.getByText("Record Payment", { selector: "h4" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("3000.00")).toBeInTheDocument();

    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { id: 55 } }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Record Payment" }));

    await waitFor(() => {
      expect(screen.queryByText("Record Payment", { selector: "h4" })).not.toBeInTheDocument();
    });

    // Verify POST body has outbound direction and vendor_bill target
    const postCall = mockFetch.mock.calls.find(
      (call: unknown[]) => (call[1] as RequestInit)?.method === "POST",
    );
    expect(postCall).toBeTruthy();
    const postBody = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(postBody.direction).toBe("outbound");
    expect(postBody.target_type).toBe("vendor_bill");
    expect(postBody.target_id).toBe(1);
  });

  it("validates amount is required before recording", async () => {
    setupFetch([makeBill({ balance_due: "3000.00" })]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("Ace Lumber")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Ace Lumber"));
    fireEvent.change(screen.getByDisplayValue("3000.00"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Payment" }));

    expect(screen.getByText("Enter a payment amount.")).toBeInTheDocument();
  });

  it("shows API error on payment create failure", async () => {
    setupFetch([makeBill({ balance_due: "3000.00" })]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("Ace Lumber")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Ace Lumber"));

    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: { message: "Bill is closed." } }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Record Payment" }));

    await waitFor(() => {
      expect(screen.getByText("Bill is closed.")).toBeInTheDocument();
    });
  });

  it("shows network error on payment create fetch rejection", async () => {
    setupFetch([makeBill({ balance_due: "3000.00" })]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("Ace Lumber")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Ace Lumber"));

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

  it("shows missing reference warning for payments without ref #", async () => {
    setupFetch([
      makeBill({
        allocations: [makeAllocation({ payment_method: "wire", payment_reference: "" })],
      }),
    ]);
    renderTab();

    await waitFor(() => {
      expect(screen.getAllByText("No ref #").length).toBeGreaterThanOrEqual(1);
    });
  });
});
