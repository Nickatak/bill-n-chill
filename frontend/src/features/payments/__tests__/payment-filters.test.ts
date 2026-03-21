import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { usePaymentFilters } from "../hooks/use-payment-filters";
import type { PaymentRecord } from "../types";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makePayment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: 1,
    organization: 1,
    customer: 1,
    customer_name: "Acme Corp",
    project: 1,
    project_name: "Kitchen Remodel",
    direction: "inbound",
    method: "check",
    status: "settled",
    amount: "1000.00",
    payment_date: "2026-03-01",
    reference_number: "1234",
    notes: "",
    allocated_total: "0.00",
    unapplied_amount: "1000.00",
    allocations: [],
    created_at: "2026-03-01T00:00:00Z",
    updated_at: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

const mixedPayments: PaymentRecord[] = [
  makePayment({ id: 1, status: "pending", amount: "500.00", customer_name: "Alpha LLC" }),
  makePayment({ id: 2, status: "settled", amount: "1000.00", customer_name: "Beta Inc" }),
  makePayment({ id: 3, status: "settled", amount: "750.00", reference_number: "CHK-9999" }),
  makePayment({ id: 4, status: "void", amount: "200.00" }),
  makePayment({ id: 5, direction: "outbound", status: "settled", amount: "300.00" }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("usePaymentFilters", () => {
  it("filters to inbound payments only", () => {
    const { result } = renderHook(() => usePaymentFilters(mixedPayments));

    expect(result.current.inboundPayments).toHaveLength(4);
    expect(result.current.inboundPayments.every((p) => p.direction === "inbound")).toBe(true);
  });

  it("defaults to pending + settled status filters", () => {
    const { result } = renderHook(() => usePaymentFilters(mixedPayments));

    expect(result.current.paymentStatusFilters).toEqual(["pending", "settled"]);
  });

  it("applies status filters to inbound payments", () => {
    const { result } = renderHook(() => usePaymentFilters(mixedPayments));

    // Default: pending + settled = 3 inbound payments
    expect(result.current.searchedPayments).toHaveLength(3);

    // Toggle off pending — only settled remain (2)
    act(() => {
      result.current.togglePaymentStatusFilter("pending");
    });
    expect(result.current.searchedPayments).toHaveLength(2);
    expect(result.current.searchedPayments.every((p) => p.status === "settled")).toBe(true);
  });

  it("returns empty array when no status filters are active", () => {
    const { result } = renderHook(() => usePaymentFilters(mixedPayments));

    act(() => {
      result.current.togglePaymentStatusFilter("pending");
      result.current.togglePaymentStatusFilter("settled");
    });
    expect(result.current.searchedPayments).toHaveLength(0);
  });

  it("toggles a status filter on when it is off", () => {
    const { result } = renderHook(() => usePaymentFilters(mixedPayments));

    // void is not in the default set — toggle it on
    act(() => {
      result.current.togglePaymentStatusFilter("void");
    });
    expect(result.current.paymentStatusFilters).toContain("void");
    // Now includes pending(1) + settled(2) + void(1) = 4
    expect(result.current.searchedPayments).toHaveLength(4);
  });

  it("computes status totals from inbound payments", () => {
    const { result } = renderHook(() => usePaymentFilters(mixedPayments));

    expect(result.current.paymentStatusTotals.get("pending")).toBe(1);
    expect(result.current.paymentStatusTotals.get("settled")).toBe(2);
    expect(result.current.paymentStatusTotals.get("void")).toBe(1);
  });

  it("searches across multiple fields", () => {
    const { result } = renderHook(() => usePaymentFilters(mixedPayments));

    // Search by customer name
    act(() => {
      result.current.setPaymentSearch("Alpha");
    });
    expect(result.current.searchedPayments).toHaveLength(1);
    expect(result.current.searchedPayments[0].customer_name).toBe("Alpha LLC");
  });

  it("searches by reference number", () => {
    const { result } = renderHook(() => usePaymentFilters(mixedPayments));

    act(() => {
      result.current.setPaymentSearch("CHK-9999");
    });
    expect(result.current.searchedPayments).toHaveLength(1);
    expect(result.current.searchedPayments[0].id).toBe(3);
  });

  it("search is case-insensitive", () => {
    const { result } = renderHook(() => usePaymentFilters(mixedPayments));

    act(() => {
      result.current.setPaymentSearch("beta inc");
    });
    expect(result.current.searchedPayments).toHaveLength(1);
    expect(result.current.searchedPayments[0].id).toBe(2);
  });

  it("combines status filters and search", () => {
    const { result } = renderHook(() => usePaymentFilters(mixedPayments));

    // Search for "Acme" — matches id 3 and 4 (default customer_name)
    // but id 4 is void, which is not in default filters
    act(() => {
      result.current.setPaymentSearch("Acme Corp");
    });
    // Only id 3 is settled + matches "Acme Corp"
    expect(result.current.searchedPayments).toHaveLength(1);
    expect(result.current.searchedPayments[0].id).toBe(3);
  });

  it("returns all status-filtered payments when search is empty", () => {
    const { result } = renderHook(() => usePaymentFilters(mixedPayments));

    act(() => {
      result.current.setPaymentSearch("   ");
    });
    // Whitespace-only search is treated as empty
    expect(result.current.searchedPayments).toHaveLength(3);
  });

  it("exposes the normalized search needle", () => {
    const { result } = renderHook(() => usePaymentFilters(mixedPayments));

    act(() => {
      result.current.setPaymentSearch("  HELLO  ");
    });
    expect(result.current.paymentNeedle).toBe("hello");
  });
});
