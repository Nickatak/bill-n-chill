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

import { ReceiptsTab } from "../components/receipts-tab";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeReceipt(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    project: 10,
    project_name: "Kitchen Remodel",
    store: 40,
    store_name: "Home Depot",
    amount: "250.00",
    balance_due: "250.00",
    allocations: [],
    receipt_date: "2026-03-05",
    notes: "",
    created_at: "2026-03-05T10:00:00Z",
    updated_at: "2026-03-05T10:00:00Z",
    ...overrides,
  };
}

function makeAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 300,
    applied_amount: "100.00",
    payment_date: "2026-03-10",
    payment_method: "card",
    payment_status: "settled",
    payment_reference: "TXN-9999",
    created_at: "2026-03-10T10:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupFetch(receipts: unknown[] = [makeReceipt()]) {
  mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
    if (!opts?.method || opts.method === "GET") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: receipts }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

function renderTab(props: Partial<React.ComponentProps<typeof ReceiptsTab>> = {}) {
  return render(
    <ReceiptsTab
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

describe("ReceiptsTab", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows loading state then renders receipts", async () => {
    setupFetch();
    renderTab();

    expect(screen.getByText("Loading receipts...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText("Loading receipts...")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Home Depot")).toBeInTheDocument();
    expect(screen.getByText("Kitchen Remodel")).toBeInTheDocument();
  });

  it("shows empty state when no receipts match filters", async () => {
    setupFetch([]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("No receipts found.")).toBeInTheDocument();
    });
  });

  it("renders nested payment allocations under receipt", async () => {
    setupFetch([
      makeReceipt({
        allocations: [makeAllocation({ id: 300, applied_amount: "100.00", payment_reference: "TXN-9999" })],
      }),
    ]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("$100.00")).toBeInTheDocument();
    });

    expect(screen.getByText(/TXN-9999/)).toBeInTheDocument();
  });

  it("filters to unpaid only when toggled (off by default)", async () => {
    setupFetch([
      makeReceipt({ id: 1, store_name: "Home Depot", balance_due: "250.00" }),
      makeReceipt({ id: 2, store_name: "Lowes", balance_due: "0.00" }),
    ]);
    renderTab();

    await waitFor(() => {
      // Both visible by default (filterUnpaid defaults to false)
      expect(screen.getByText("Home Depot")).toBeInTheDocument();
      expect(screen.getByText("Lowes")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Unpaid only" }));

    expect(screen.getByText("Home Depot")).toBeInTheDocument();
    expect(screen.queryByText("Lowes")).not.toBeInTheDocument();
  });

  it("search filters by store name", async () => {
    setupFetch([
      makeReceipt({ id: 1, store_name: "Home Depot" }),
      makeReceipt({ id: 2, store_name: "Lowes" }),
    ]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("Home Depot")).toBeInTheDocument();
      expect(screen.getByText("Lowes")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Search receipts..."), {
      target: { value: "Lowes" },
    });

    expect(screen.queryByText("Home Depot")).not.toBeInTheDocument();
    expect(screen.getByText("Lowes")).toBeInTheDocument();
  });

  it("opens payment form on receipt click and records outbound payment", async () => {
    setupFetch([makeReceipt({ balance_due: "250.00" })]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("Home Depot")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Home Depot"));

    expect(screen.getByText("Record Payment", { selector: "h4" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("250.00")).toBeInTheDocument();

    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { id: 77 } }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Record Payment" }));

    await waitFor(() => {
      expect(screen.queryByText("Record Payment", { selector: "h4" })).not.toBeInTheDocument();
    });

    const postCall = mockFetch.mock.calls.find(
      (call: unknown[]) => (call[1] as RequestInit)?.method === "POST",
    );
    expect(postCall).toBeTruthy();
    const postBody = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(postBody.direction).toBe("outbound");
    expect(postBody.target_type).toBe("receipt");
    expect(postBody.target_id).toBe(1);
  });

  it("validates amount is required before recording", async () => {
    setupFetch([makeReceipt({ balance_due: "250.00" })]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("Home Depot")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Home Depot"));
    fireEvent.change(screen.getByDisplayValue("250.00"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Payment" }));

    expect(screen.getByText("Enter a payment amount.")).toBeInTheDocument();
  });

  it("shows API error on payment create failure", async () => {
    setupFetch([makeReceipt({ balance_due: "250.00" })]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("Home Depot")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Home Depot"));

    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: { message: "Receipt already paid." } }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Record Payment" }));

    await waitFor(() => {
      expect(screen.getByText("Receipt already paid.")).toBeInTheDocument();
    });
  });

  it("shows network error on payment create fetch rejection", async () => {
    setupFetch([makeReceipt({ balance_due: "250.00" })]);
    renderTab();

    await waitFor(() => {
      expect(screen.getByText("Home Depot")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Home Depot"));

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
});
