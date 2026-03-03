import { describe, expect, it } from "vitest";
import {
  financialBaselineStatus,
  formatFinancialBaselineStatus,
} from "../financial-baseline";

// ---------------------------------------------------------------------------
// financialBaselineStatus
// ---------------------------------------------------------------------------

describe("financialBaselineStatus", () => {
  it("returns 'none' for null", () => {
    expect(financialBaselineStatus(null)).toBe("none");
  });

  it("returns 'none' for undefined", () => {
    expect(financialBaselineStatus(undefined)).toBe("none");
  });

  it("returns 'active' when is_active_financial_baseline is true", () => {
    expect(financialBaselineStatus({ is_active_financial_baseline: true })).toBe("active");
  });

  it("returns 'active' from financial_baseline_status field", () => {
    expect(
      financialBaselineStatus({
        is_active_financial_baseline: false,
        financial_baseline_status: "active",
      }),
    ).toBe("active");
  });

  it("returns 'superseded' from financial_baseline_status field", () => {
    expect(
      financialBaselineStatus({
        is_active_financial_baseline: false,
        financial_baseline_status: "superseded",
      }),
    ).toBe("superseded");
  });

  it("returns 'none' when no baseline flags are set", () => {
    expect(
      financialBaselineStatus({ is_active_financial_baseline: false }),
    ).toBe("none");
  });

  it("prioritizes is_active_financial_baseline over financial_baseline_status", () => {
    expect(
      financialBaselineStatus({
        is_active_financial_baseline: true,
        financial_baseline_status: "superseded",
      }),
    ).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// formatFinancialBaselineStatus
// ---------------------------------------------------------------------------

describe("formatFinancialBaselineStatus", () => {
  it("returns 'Active Estimate' for active", () => {
    expect(formatFinancialBaselineStatus("active")).toBe("Active Estimate");
  });

  it("returns 'Superseded Estimate' for superseded", () => {
    expect(formatFinancialBaselineStatus("superseded")).toBe("Superseded Estimate");
  });

  it("returns empty string for none", () => {
    expect(formatFinancialBaselineStatus("none")).toBe("");
  });
});
