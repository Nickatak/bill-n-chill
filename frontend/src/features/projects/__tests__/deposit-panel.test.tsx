import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", mockFetch);

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

import { DepositPanel } from "../components/deposit-panel";
import type { ApprovedEstimate } from "../types";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeEstimate(overrides: Partial<ApprovedEstimate> = {}): ApprovedEstimate {
  return {
    id: 10,
    title: "Kitchen Remodel",
    grand_total: "25000.00",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DepositPanel", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows empty message when no approved estimates exist", () => {
    render(
      <DepositPanel
        projectId={1}
        approvedEstimates={[]}
        linkedEstimateIds={new Set()}
        onInvoiceCreated={vi.fn()}
      />,
    );

    expect(screen.getByText(/no approved estimates/i)).toBeInTheDocument();
  });

  it("shows empty message when all estimates already have linked invoices", () => {
    const est = makeEstimate({ id: 10 });
    render(
      <DepositPanel
        projectId={1}
        approvedEstimates={[est]}
        linkedEstimateIds={new Set([10])}
        onInvoiceCreated={vi.fn()}
      />,
    );

    expect(screen.getByText(/already have a linked invoice/i)).toBeInTheDocument();
  });

  it("pre-selects the only available estimate", () => {
    const est = makeEstimate({ id: 10, title: "Kitchen Remodel" });
    render(
      <DepositPanel
        projectId={1}
        approvedEstimates={[est]}
        linkedEstimateIds={new Set()}
        onInvoiceCreated={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("10");
  });

  it("renders multiple estimates in the selector", () => {
    const estimates = [
      makeEstimate({ id: 10, title: "Kitchen" }),
      makeEstimate({ id: 11, title: "Bathroom" }),
    ];
    render(
      <DepositPanel
        projectId={1}
        approvedEstimates={estimates}
        linkedEstimateIds={new Set()}
        onInvoiceCreated={vi.fn()}
      />,
    );

    const options = screen.getAllByRole("option");
    // placeholder + 2 estimates
    expect(options.length).toBe(3);
  });

  it("filters out estimates that already have linked invoices", () => {
    const estimates = [
      makeEstimate({ id: 10, title: "Kitchen" }),
      makeEstimate({ id: 11, title: "Bathroom" }),
    ];
    render(
      <DepositPanel
        projectId={1}
        approvedEstimates={estimates}
        linkedEstimateIds={new Set([10])}
        onInvoiceCreated={vi.fn()}
      />,
    );

    const options = screen.getAllByRole("option");
    // placeholder + 1 available estimate (Bathroom)
    expect(options.length).toBe(2);
    expect(screen.getByText(/Bathroom/)).toBeInTheDocument();
  });

  it("calls onInvoiceCreated with the new invoice on success", async () => {
    const onCreated = vi.fn();
    const est = makeEstimate({ id: 10 });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            id: 99,
            invoice_number: "INV-0001",
            balance_due: "1000.00",
            status: "sent",
          },
        }),
    });

    render(
      <DepositPanel
        projectId={1}
        approvedEstimates={[est]}
        linkedEstimateIds={new Set()}
        onInvoiceCreated={onCreated}
      />,
    );

    const amountInput = screen.getByPlaceholderText("0.00");
    fireEvent.change(amountInput, { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: /create & send/i }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith({
        id: 99,
        invoice_number: "INV-0001",
        balance_due: "1000.00",
        status: "sent",
      });
    });

    // Verify the POST payload
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("/projects/1/invoices/");
    const body = JSON.parse(options.body);
    expect(body.related_estimate).toBe(10);
    expect(body.initial_status).toBe("sent");
    expect(body.line_items[0].description).toBe("Deposit for Kitchen Remodel");
    expect(body.line_items[0].unit_price).toBe("1000.00");
  });

  it("shows error message on API failure", async () => {
    const est = makeEstimate({ id: 10 });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          error: {
            code: "conflict",
            message: "An invoice already exists for this estimate.",
          },
        }),
    });

    render(
      <DepositPanel
        projectId={1}
        approvedEstimates={[est]}
        linkedEstimateIds={new Set()}
        onInvoiceCreated={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "500" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create & send/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/an invoice already exists for this estimate/i),
      ).toBeInTheDocument();
    });
  });

  it("shows estimate total hint when an estimate is selected", () => {
    const est = makeEstimate({ id: 10, grand_total: "25000.00" });
    render(
      <DepositPanel
        projectId={1}
        approvedEstimates={[est]}
        linkedEstimateIds={new Set()}
        onInvoiceCreated={vi.fn()}
      />,
    );

    expect(screen.getByText(/estimate total/i)).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Field-level validation
  // -----------------------------------------------------------------------

  it("shows field error when submitting without selecting an estimate", () => {
    const estimates = [
      makeEstimate({ id: 10, title: "Kitchen" }),
      makeEstimate({ id: 11, title: "Bathroom" }),
    ];
    render(
      <DepositPanel
        projectId={1}
        approvedEstimates={estimates}
        linkedEstimateIds={new Set()}
        onInvoiceCreated={vi.fn()}
      />,
    );

    // Amount filled but no estimate selected (multiple estimates, no pre-select)
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "500" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /create & send/i }).closest("form")!);

    expect(screen.getByText(/select an estimate/i)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows field error when submitting with empty amount", () => {
    const est = makeEstimate({ id: 10 });
    render(
      <DepositPanel
        projectId={1}
        approvedEstimates={[est]}
        linkedEstimateIds={new Set()}
        onInvoiceCreated={vi.fn()}
      />,
    );

    // Estimate pre-selected but amount left blank
    fireEvent.submit(screen.getByRole("button", { name: /create & send/i }).closest("form")!);

    expect(screen.getByText(/enter a deposit amount/i)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows field error when amount is negative", () => {
    const est = makeEstimate({ id: 10 });
    render(
      <DepositPanel
        projectId={1}
        approvedEstimates={[est]}
        linkedEstimateIds={new Set()}
        onInvoiceCreated={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "-5" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /create & send/i }).closest("form")!);

    expect(screen.getByText(/must be greater than zero/i)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows both field errors when submitting with nothing filled", () => {
    const estimates = [
      makeEstimate({ id: 10, title: "Kitchen" }),
      makeEstimate({ id: 11, title: "Bathroom" }),
    ];
    render(
      <DepositPanel
        projectId={1}
        approvedEstimates={estimates}
        linkedEstimateIds={new Set()}
        onInvoiceCreated={vi.fn()}
      />,
    );

    fireEvent.submit(screen.getByRole("button", { name: /create & send/i }).closest("form")!);

    expect(screen.getByText(/select an estimate/i)).toBeInTheDocument();
    expect(screen.getByText(/enter a deposit amount/i)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("clears estimate field error when user selects an estimate", () => {
    const estimates = [
      makeEstimate({ id: 10, title: "Kitchen" }),
      makeEstimate({ id: 11, title: "Bathroom" }),
    ];
    render(
      <DepositPanel
        projectId={1}
        approvedEstimates={estimates}
        linkedEstimateIds={new Set()}
        onInvoiceCreated={vi.fn()}
      />,
    );

    // Trigger error
    fireEvent.submit(screen.getByRole("button", { name: /create & send/i }).closest("form")!);
    expect(screen.getByText(/select an estimate/i)).toBeInTheDocument();

    // Select an estimate — error should clear
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "10" } });
    expect(screen.queryByText(/select an estimate/i)).not.toBeInTheDocument();
  });

  it("clears amount field error when user types an amount", () => {
    const est = makeEstimate({ id: 10 });
    render(
      <DepositPanel
        projectId={1}
        approvedEstimates={[est]}
        linkedEstimateIds={new Set()}
        onInvoiceCreated={vi.fn()}
      />,
    );

    // Trigger error
    fireEvent.submit(screen.getByRole("button", { name: /create & send/i }).closest("form")!);
    expect(screen.getByText(/enter a deposit amount/i)).toBeInTheDocument();

    // Type an amount — error should clear
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "100" },
    });
    expect(screen.queryByText(/enter a deposit amount/i)).not.toBeInTheDocument();
  });
});
