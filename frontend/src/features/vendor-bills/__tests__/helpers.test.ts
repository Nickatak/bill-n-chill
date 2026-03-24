import { describe, expect, it } from "vitest";
import {
  createEmptyVendorBillLineRow,
  defaultBillStatusFilters,
  formatMoney,
  projectStatusLabel,
} from "../helpers";

// ---------------------------------------------------------------------------
// createEmptyVendorBillLineRow
// ---------------------------------------------------------------------------

describe("createEmptyVendorBillLineRow", () => {
  it("returns a blank line item row with default quantity", () => {
    const row = createEmptyVendorBillLineRow();
    expect(row).toEqual({
      description: "",
      quantity: "1",
      unit_price: "",
    });
  });

  it("returns a fresh object on each call", () => {
    const a = createEmptyVendorBillLineRow();
    const b = createEmptyVendorBillLineRow();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// defaultBillStatusFilters
// ---------------------------------------------------------------------------

describe("defaultBillStatusFilters", () => {
  it("excludes terminal statuses (closed, void)", () => {
    const statuses = ["open", "disputed", "closed", "void"];
    const result = defaultBillStatusFilters(statuses);
    expect(result).toEqual(["open", "disputed"]);
  });

  it("returns all statuses when none are terminal", () => {
    const statuses = ["open", "disputed"];
    expect(defaultBillStatusFilters(statuses)).toEqual(statuses);
  });

  it("returns all statuses when all are terminal", () => {
    const statuses = ["closed", "void"];
    expect(defaultBillStatusFilters(statuses)).toEqual(statuses);
  });

  it("returns empty array for empty input", () => {
    expect(defaultBillStatusFilters([])).toEqual([]);
  });

  it("handles single non-terminal status", () => {
    expect(defaultBillStatusFilters(["open"])).toEqual(["open"]);
  });

  it("handles single terminal status", () => {
    expect(defaultBillStatusFilters(["closed"])).toEqual(["closed"]);
  });
});

// ---------------------------------------------------------------------------
// projectStatusLabel
// ---------------------------------------------------------------------------

describe("projectStatusLabel", () => {
  it("replaces first underscore with space", () => {
    expect(projectStatusLabel("on_hold")).toBe("on hold");
  });

  it("returns single-word status unchanged", () => {
    expect(projectStatusLabel("active")).toBe("active");
  });

  it("replaces only first underscore", () => {
    expect(projectStatusLabel("a_b_c")).toBe("a b_c");
  });

  it("returns empty string for empty input", () => {
    expect(projectStatusLabel("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// formatMoney
// ---------------------------------------------------------------------------

describe("formatMoney", () => {
  it("formats a whole number string to two decimals", () => {
    expect(formatMoney("100")).toBe("100.00");
  });

  it("formats a decimal string to two decimals", () => {
    expect(formatMoney("99.9")).toBe("99.90");
  });

  it("preserves two-decimal input", () => {
    expect(formatMoney("3247.50")).toBe("3247.50");
  });

  it("rounds excess decimals", () => {
    expect(formatMoney("1.999")).toBe("2.00");
  });

  it("returns '0.00' for undefined", () => {
    expect(formatMoney(undefined)).toBe("0.00");
  });

  it("returns '0.00' for empty string", () => {
    expect(formatMoney("")).toBe("0.00");
  });

  it("returns '0.00' for non-numeric string", () => {
    expect(formatMoney("abc")).toBe("0.00");
  });

  it("handles zero", () => {
    expect(formatMoney("0")).toBe("0.00");
  });

  it("handles negative values", () => {
    expect(formatMoney("-50.5")).toBe("-50.50");
  });
});
