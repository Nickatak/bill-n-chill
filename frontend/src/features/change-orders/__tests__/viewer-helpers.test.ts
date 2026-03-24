/**
 * Tests for pure viewer helper functions exported from
 * use-change-order-viewer.ts.
 *
 * These functions compute derived state (sorted lists, financial totals)
 * from raw change-order data without React hooks.
 */

import { describe, expect, it } from "vitest";
import {
  sortChangeOrdersForViewer,
  computeWorkingTotals,
} from "../hooks/use-change-order-viewer";
import type { ChangeOrderRecord } from "../types";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeCO(overrides: Partial<ChangeOrderRecord> = {}): ChangeOrderRecord {
  return {
    id: 1,
    project: 7,
    family_key: "1",
    title: "Test CO",
    status: "draft",
    amount_delta: "1000.00",
    days_delta: 3,
    reason: "Testing",
    terms_text: "",
    sender_name: "",
    sender_address: "",
    sender_logo_url: "",
    origin_estimate: 42,
    requested_by: 1,
    requested_by_email: "test@example.com",
    approved_by: null,
    approved_by_email: null,
    approved_at: null,
    line_items: [],
    line_total_delta: "1000.00",
    created_at: "2026-03-01T10:00:00Z",
    updated_at: "2026-03-01T10:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// sortChangeOrdersForViewer
// ---------------------------------------------------------------------------

describe("sortChangeOrdersForViewer", () => {
  it("sorts by created_at ascending", () => {
    const rows = [
      makeCO({ id: 2, created_at: "2026-03-02T10:00:00Z" }),
      makeCO({ id: 1, created_at: "2026-03-01T10:00:00Z" }),
      makeCO({ id: 3, created_at: "2026-03-03T10:00:00Z" }),
    ];
    const sorted = sortChangeOrdersForViewer(rows);
    expect(sorted.map((co) => co.id)).toEqual([1, 2, 3]);
  });

  it("breaks created_at ties by family_key", () => {
    const sameTime = "2026-03-01T10:00:00Z";
    const rows = [
      makeCO({ id: 2, family_key: "3", created_at: sameTime }),
      makeCO({ id: 1, family_key: "1", created_at: sameTime }),
      makeCO({ id: 3, family_key: "2", created_at: sameTime }),
    ];
    const sorted = sortChangeOrdersForViewer(rows);
    expect(sorted.map((co) => co.id)).toEqual([1, 3, 2]);
  });

  it("breaks family_key ties by id", () => {
    const sameTime = "2026-03-01T10:00:00Z";
    const rows = [
      makeCO({ id: 3, family_key: "1", created_at: sameTime }),
      makeCO({ id: 1, family_key: "1", created_at: sameTime }),
      makeCO({ id: 2, family_key: "1", created_at: sameTime }),
    ];
    const sorted = sortChangeOrdersForViewer(rows);
    expect(sorted.map((co) => co.id)).toEqual([1, 2, 3]);
  });

  it("does not mutate the input array", () => {
    const rows = [
      makeCO({ id: 2, created_at: "2026-03-02T10:00:00Z" }),
      makeCO({ id: 1, created_at: "2026-03-01T10:00:00Z" }),
    ];
    const originalFirstId = rows[0].id;
    sortChangeOrdersForViewer(rows);
    expect(rows[0].id).toBe(originalFirstId);
  });

  it("returns empty array for empty input", () => {
    expect(sortChangeOrdersForViewer([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeWorkingTotals
// ---------------------------------------------------------------------------

describe("computeWorkingTotals", () => {
  const originTotals: Record<number, number> = { 42: 50000 };

  it("returns zeros when no estimate is selected", () => {
    const result = computeWorkingTotals([], null, 1, 0, false, originTotals);
    expect(result).toEqual({ preApproval: "0.00", postApproval: "0.00" });
  });

  it("returns zeros when no CO is selected", () => {
    const result = computeWorkingTotals([], 42, null, 0, false, originTotals);
    expect(result).toEqual({ preApproval: "0.00", postApproval: "0.00" });
  });

  it("computes totals for a non-approved CO (no prior approved COs)", () => {
    const cos = [makeCO({ id: 10, status: "draft", amount_delta: "5000.00" })];
    const result = computeWorkingTotals(cos, 42, 10, 5000, false, originTotals);
    // preApproval = originalBudget (50000) + approvedRolling (0) = 50000
    // postApproval = preApproval + selectedDelta (5000) = 55000
    expect(result.preApproval).toBe("50000.00");
    expect(result.postApproval).toBe("55000.00");
  });

  it("computes totals with existing approved COs", () => {
    const cos = [
      makeCO({ id: 5, status: "approved", amount_delta: "3000.00", origin_estimate: 42 }),
      makeCO({ id: 10, status: "draft", amount_delta: "2000.00", origin_estimate: 42 }),
    ];
    const result = computeWorkingTotals(cos, 42, 10, 2000, false, originTotals);
    // approvedRolling = 3000 (CO#5 is approved)
    // preApproval = 50000 + 3000 = 53000
    // postApproval = 53000 + 2000 = 55000
    expect(result.preApproval).toBe("53000.00");
    expect(result.postApproval).toBe("55000.00");
  });

  it("subtracts selected CO delta from pre-approval when CO is approved", () => {
    const cos = [
      makeCO({ id: 5, status: "approved", amount_delta: "3000.00", origin_estimate: 42 }),
      makeCO({ id: 10, status: "approved", amount_delta: "2000.00", origin_estimate: 42 }),
    ];
    const result = computeWorkingTotals(cos, 42, 10, 2000, true, originTotals);
    // approvedRolling = 3000 + 2000 = 5000
    // currentApproved = 50000 + 5000 = 55000
    // preApproval = 55000 - 2000 = 53000 (subtracts selected because it IS approved)
    // postApproval = 53000 + 2000 = 55000
    expect(result.preApproval).toBe("53000.00");
    expect(result.postApproval).toBe("55000.00");
  });

  it("ignores COs for different estimates", () => {
    const cos = [
      makeCO({ id: 5, status: "approved", amount_delta: "3000.00", origin_estimate: 99 }),
      makeCO({ id: 10, status: "draft", amount_delta: "1000.00", origin_estimate: 42 }),
    ];
    const result = computeWorkingTotals(cos, 42, 10, 1000, false, originTotals);
    // CO#5 is for estimate 99, not 42, so approvedRolling = 0
    expect(result.preApproval).toBe("50000.00");
    expect(result.postApproval).toBe("51000.00");
  });

  it("handles negative deltas", () => {
    const cos = [
      makeCO({ id: 10, status: "draft", amount_delta: "-2000.00", origin_estimate: 42 }),
    ];
    const result = computeWorkingTotals(cos, 42, 10, -2000, false, originTotals);
    expect(result.preApproval).toBe("50000.00");
    expect(result.postApproval).toBe("48000.00");
  });

  it("handles missing estimate in totals map", () => {
    const cos = [makeCO({ id: 10, status: "draft", amount_delta: "1000.00", origin_estimate: 99 })];
    const result = computeWorkingTotals(cos, 99, 10, 1000, false, originTotals);
    // originTotals[99] is undefined → 0
    expect(result.preApproval).toBe("0.00");
    expect(result.postApproval).toBe("1000.00");
  });
});
