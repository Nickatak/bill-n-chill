import { describe, expect, it } from "vitest";
import {
  createEmptyAllocationRow,
  defaultBillStatusFilters,
  formatMoney,
  projectStatusLabel,
} from "../helpers";

// ---------------------------------------------------------------------------
// createEmptyAllocationRow
// ---------------------------------------------------------------------------

describe("createEmptyAllocationRow", () => {
  it("returns a blank allocation row with zero budget_line", () => {
    const row = createEmptyAllocationRow();
    expect(row).toEqual({
      budget_line: 0,
      amount: "",
      note: "",
      ui_line_key: "",
      ui_target_budget_id: undefined,
    });
  });

  it("returns a fresh object on each call", () => {
    const a = createEmptyAllocationRow();
    const b = createEmptyAllocationRow();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// defaultBillStatusFilters
// ---------------------------------------------------------------------------

describe("defaultBillStatusFilters", () => {
  it("excludes terminal statuses (paid, void)", () => {
    const statuses = ["planned", "received", "approved", "scheduled", "paid", "void"];
    const result = defaultBillStatusFilters(statuses);
    expect(result).toEqual(["planned", "received", "approved", "scheduled"]);
  });

  it("returns all statuses when none are terminal", () => {
    const statuses = ["planned", "received", "approved"];
    expect(defaultBillStatusFilters(statuses)).toEqual(statuses);
  });

  it("returns all statuses when all are terminal", () => {
    const statuses = ["paid", "void"];
    expect(defaultBillStatusFilters(statuses)).toEqual(statuses);
  });

  it("returns empty array for empty input", () => {
    expect(defaultBillStatusFilters([])).toEqual([]);
  });

  it("handles single non-terminal status", () => {
    expect(defaultBillStatusFilters(["planned"])).toEqual(["planned"]);
  });

  it("handles single terminal status", () => {
    expect(defaultBillStatusFilters(["paid"])).toEqual(["paid"]);
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
