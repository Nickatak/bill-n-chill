import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("@/shared/session/use-shared-session", () => ({
  useSharedSessionAuth: vi.fn(() => ({
    token: "test-token",
    email: "nick@test.com",
    authMessage: "Using shared session for nick@test.com (owner).",
    role: "owner",
    organization: null,
    capabilities: { payments: ["view", "create", "edit", "allocate"] },
  })),
}));

vi.mock("@/shared/date-format", async () => {
  const actual = await vi.importActual<typeof import("@/shared/date-format")>("@/shared/date-format");
  return {
    ...actual,
    todayDateInput: () => "2026-03-09",
  };
});

vi.stubGlobal("fetch", mockFetch);

import { PaymentRecorder } from "../components/payment-recorder";
import type { AllocationTarget } from "../types";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    project: 10,
    project_name: "Kitchen Remodel",
    direction: "inbound",
    method: "ach",
    status: "settled",
    amount: "5000.00",
    payment_date: "2026-03-01",
    reference_number: "REF-001",
    notes: "",
    allocated_total: "3000.00",
    unapplied_amount: "2000.00",
    allocations: [],
    created_at: "2026-03-01T10:00:00Z",
    updated_at: "2026-03-01T10:00:00Z",
    ...overrides,
  };
}

const defaultTargets: AllocationTarget[] = [
  { id: 100, label: "Invoice #100", balanceDue: "5000.00" },
  { id: 101, label: "Invoice #101", balanceDue: "2500.00" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupPaymentFetch(overrides: { payments?: unknown[]; policy?: boolean } = {}) {
  mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
    // Policy contract endpoint
    if (url.includes("/contracts/payments/")) {
      if (overrides.policy === false) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: { message: "Not found" } }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          data: {
            policy_version: "1.0",
            status_labels: { pending: "Pending", settled: "Settled", void: "Void" },
            statuses: ["pending", "settled", "void"],
            directions: ["inbound", "outbound"],
            methods: ["ach", "card", "check", "wire", "cash", "other"],
            default_create_status: "settled",
            default_create_direction: "inbound",
            default_create_method: "ach",
            allowed_status_transitions: { pending: ["settled", "void"], settled: ["void"], void: [] },
            terminal_statuses: ["void"],
            allocation_target_by_direction: { inbound: "invoice", outbound: "vendor_bill" },
          },
        }),
      });
    }
    // Payments list endpoint
    if (url.includes("/payments/") && (!opts?.method || opts.method === "GET")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          data: overrides.payments ?? [makePayment()],
        }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

function renderRecorder(props: Partial<React.ComponentProps<typeof PaymentRecorder>> = {}) {
  return render(
    <PaymentRecorder
      projectId={10}
      direction="inbound"
      allocationTargets={defaultTargets}
      {...props}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PaymentRecorder", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders heading and direction-specific copy", async () => {
    setupPaymentFetch({ payments: [] });
    renderRecorder();

    await waitFor(() => {
      expect(screen.getByText("Inbound Payments")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Record payments received from customers and allocate them to invoices."),
    ).toBeInTheDocument();
  });

  it("renders outbound copy when direction is outbound", async () => {
    setupPaymentFetch({ payments: [] });
    renderRecorder({ direction: "outbound", allocationTargets: [] });

    await waitFor(() => {
      expect(screen.getByText("Outbound Payments")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Record payments made to vendors and allocate them to bills."),
    ).toBeInTheDocument();
  });

  it("shows empty state when no payments exist", async () => {
    setupPaymentFetch({ payments: [] });
    renderRecorder();

    await waitFor(() => {
      expect(screen.getByText(/No inbound payments yet/)).toBeInTheDocument();
    });
  });

  it("loads and displays payments from API", async () => {
    setupPaymentFetch({
      payments: [
        makePayment({ id: 1, amount: "5000.00", reference_number: "REF-001" }),
        makePayment({ id: 2, amount: "2500.00", reference_number: "REF-002" }),
      ],
    });
    renderRecorder();

    await waitFor(() => {
      // Amount appears in both list row and detail card for selected payment
      expect(screen.getAllByText("$5000.00").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText("$2500.00").length).toBeGreaterThanOrEqual(1);
    // Reference numbers appear in list row and detail card — use getAllByText
    expect(screen.getAllByText("#REF-001").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("#REF-002").length).toBeGreaterThanOrEqual(1);
  });

  it("shows detail card for selected payment", async () => {
    setupPaymentFetch({
      payments: [makePayment({
        id: 1,
        amount: "5000.00",
        allocated_total: "3000.00",
        unapplied_amount: "2000.00",
      })],
    });
    renderRecorder();

    await waitFor(() => {
      expect(screen.getByText("Payment #1")).toBeInTheDocument();
    });

    // Amounts appear in both list and detail card — use getAllByText
    expect(screen.getAllByText("$5000.00").length).toBeGreaterThanOrEqual(1);
    // Detail card metrics: Allocated and Unapplied
    expect(screen.getByText("Allocated")).toBeInTheDocument();
    expect(screen.getByText("Unapplied")).toBeInTheDocument();
    expect(screen.getAllByText("$3000.00").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("$2000.00").length).toBeGreaterThanOrEqual(1);
  });

  it("creates a new payment via POST", async () => {
    setupPaymentFetch({ payments: [] });
    renderRecorder();

    await waitFor(() => {
      // "Record Payment" appears as h3 title AND submit button — use role query for the button
      expect(screen.getByRole("button", { name: "Record Payment" })).toBeInTheDocument();
    });

    // Workspace should be in create mode
    expect(screen.getByText("New")).toBeInTheDocument();

    // Set up the POST response
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "POST" && url.includes("/payments/")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: makePayment({ id: 42, amount: "1200.00" }),
          }),
        });
      }
      if (url.includes("/contracts/payments/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Record Payment" }));

    await waitFor(() => {
      expect(screen.getByText(/Created payment #42/)).toBeInTheDocument();
    });
  });

  it("saves an edited payment via PATCH", async () => {
    setupPaymentFetch();
    renderRecorder();

    await waitFor(() => {
      expect(screen.getByText("Payment #1")).toBeInTheDocument();
    });

    // Should auto-select and hydrate first payment → workspace in edit mode
    expect(screen.getByText("Edit")).toBeInTheDocument();

    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: makePayment({ id: 1, notes: "Updated" }),
          }),
        });
      }
      if (url.includes("/contracts/payments/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [makePayment()] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(screen.getByText(/Saved payment #1/)).toBeInTheDocument();
    });
  });

  it("switches to create mode with Record New Payment button", async () => {
    setupPaymentFetch();
    renderRecorder();

    await waitFor(() => {
      expect(screen.getByText("Payment #1")).toBeInTheDocument();
    });

    expect(screen.getByText("Edit")).toBeInTheDocument();

    fireEvent.click(screen.getByText("+ Record New Payment"));

    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("shows quick status actions for non-terminal payments", async () => {
    setupPaymentFetch({
      payments: [makePayment({ status: "pending" })],
    });
    renderRecorder();

    await waitFor(() => {
      expect(screen.getByText("Payment #1")).toBeInTheDocument();
    });

    // pending → settled and void are allowed transitions
    expect(screen.getByRole("button", { name: "Settled" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Void" })).toBeInTheDocument();
  });

  it("shows existing allocations on detail card", async () => {
    setupPaymentFetch({
      payments: [makePayment({
        allocations: [
          { id: 1, payment: 1, target_type: "invoice", target_id: 100, applied_amount: "3000.00" },
        ],
      })],
    });
    renderRecorder();

    await waitFor(() => {
      expect(screen.getByText("Allocations")).toBeInTheDocument();
    });

    expect(screen.getByText("Invoice #100")).toBeInTheDocument();
    // $3000.00 appears as both detail metric and allocation row amount
    expect(screen.getAllByText("$3000.00").length).toBeGreaterThanOrEqual(2);
  });

  it("shows allocation form for settled payments with unapplied balance", async () => {
    setupPaymentFetch({
      payments: [makePayment({
        status: "settled",
        unapplied_amount: "2000.00",
      })],
    });
    renderRecorder();

    await waitFor(() => {
      expect(screen.getByText("Allocate to Invoice")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Allocate" })).toBeInTheDocument();
  });

  it("shows read-only notice for viewers without create/edit", async () => {
    const { useSharedSessionAuth } = await import("@/shared/session/use-shared-session");
    vi.mocked(useSharedSessionAuth).mockReturnValueOnce({
      token: "test-token",
      email: "viewer@test.com",
      authMessage: "",
      role: "viewer",
      organization: null,
      capabilities: { payments: ["view"] },
      isSuperuser: false,
      isImpersonating: false,
      impersonation: undefined,
    });

    setupPaymentFetch({ payments: [] });
    renderRecorder();

    await waitFor(() => {
      expect(screen.getByText(/can view payments but cannot create, edit, or allocate/)).toBeInTheDocument();
    });
  });

  it("shows inline allocation option on create when targets available", async () => {
    setupPaymentFetch({ payments: [] });
    renderRecorder();

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "None" })).toBeInTheDocument();
    });
  });

  it("hides heading and copy when hideHeader is true", async () => {
    setupPaymentFetch({ payments: [] });
    renderRecorder({ hideHeader: true });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Record Payment" })).toBeInTheDocument();
    });

    expect(screen.queryByText("Inbound Payments")).not.toBeInTheDocument();
    expect(screen.queryByText(/Record payments received/)).not.toBeInTheDocument();
  });

  it("hides payment list and shows only create form when createOnly is true", async () => {
    setupPaymentFetch({
      payments: [makePayment({ id: 1, amount: "5000.00", reference_number: "REF-001" })],
    });
    renderRecorder({ createOnly: true });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Record Payment" })).toBeInTheDocument();
    });

    // Payment list should not render even though data exists
    expect(screen.queryByText("Payment #1")).not.toBeInTheDocument();
    expect(screen.queryByText("#REF-001")).not.toBeInTheDocument();
    // No mode badge or "Record New Payment" toggle in createOnly mode
    expect(screen.queryByText("+ Record New Payment")).not.toBeInTheDocument();
  });

  it("executes quick status transition via PATCH", async () => {
    setupPaymentFetch({
      payments: [makePayment({ status: "pending" })],
    });
    renderRecorder();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Settled" })).toBeInTheDocument();
    });

    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: makePayment({ id: 1, status: "settled" }),
          }),
        });
      }
      if (url.includes("/contracts/payments/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Settled" }));

    await waitFor(() => {
      expect(screen.getByText(/Payment #1 → Settled/)).toBeInTheDocument();
    });
  });

  it("hides quick status actions for void (terminal) payments", async () => {
    setupPaymentFetch({
      payments: [makePayment({ status: "void" })],
    });
    renderRecorder();

    await waitFor(() => {
      expect(screen.getByText("Payment #1")).toBeInTheDocument();
    });

    // Void is terminal — no transitions available
    expect(screen.queryByRole("button", { name: "Settled" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Void" })).not.toBeInTheDocument();
  });

  it("shows network error when create fetch rejects", async () => {
    setupPaymentFetch({ payments: [] });
    renderRecorder();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Record Payment" })).toBeInTheDocument();
    });

    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.reject(new Error("Network error"));
      }
      if (url.includes("/contracts/payments/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    const form = screen.getByRole("button", { name: "Record Payment" }).closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("Could not reach payment create endpoint.")).toBeInTheDocument();
    });
  });

  it("shows API error on create failure", async () => {
    setupPaymentFetch({ payments: [] });
    renderRecorder();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Record Payment" })).toBeInTheDocument();
    });

    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: { message: "Amount must be positive." } }),
        });
      }
      if (url.includes("/contracts/payments/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    // Click the submit button — it has type="submit" and the form has onSubmit
    const submitButton = screen.getByRole("button", { name: "Record Payment" });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText("Amount must be positive.")).toBeInTheDocument();
    });
  });
});
