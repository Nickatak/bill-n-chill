import { describe, expect, it } from "vitest";
import {
  coLabel,
  defaultChangeOrderTitle,
  emptyLine,
  isFiniteNumericInput,
  publicChangeOrderHref,
  readChangeOrderApiError,
  validateLineItems,
} from "../helpers";
import type { ChangeOrderLineInput } from "../types";

// ---------------------------------------------------------------------------
// isFiniteNumericInput
// ---------------------------------------------------------------------------

describe("isFiniteNumericInput", () => {
  it("returns true for a valid integer string", () => {
    expect(isFiniteNumericInput("42")).toBe(true);
  });

  it("returns true for a valid decimal string", () => {
    expect(isFiniteNumericInput("3.14")).toBe(true);
  });

  it("returns true for a negative number", () => {
    expect(isFiniteNumericInput("-100.50")).toBe(true);
  });

  it("returns true for a string with whitespace padding", () => {
    expect(isFiniteNumericInput("  7  ")).toBe(true);
  });

  it("returns false for an empty string", () => {
    expect(isFiniteNumericInput("")).toBe(false);
  });

  it("returns false for whitespace-only", () => {
    expect(isFiniteNumericInput("   ")).toBe(false);
  });

  it("returns false for non-numeric text", () => {
    expect(isFiniteNumericInput("abc")).toBe(false);
  });

  it("returns false for Infinity", () => {
    expect(isFiniteNumericInput("Infinity")).toBe(false);
  });

  it("returns false for NaN string", () => {
    expect(isFiniteNumericInput("NaN")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateLineItems
// ---------------------------------------------------------------------------

describe("validateLineItems", () => {
  function line(overrides: Partial<ChangeOrderLineInput> = {}): ChangeOrderLineInput {
    return {
      localId: 1,
      lineType: "scope",
      adjustmentReason: "",
      budgetLineId: "10",
      description: "Test",
      amountDelta: "500.00",
      daysDelta: "5",
      ...overrides,
    };
  }

  it("returns no issues for a valid line", () => {
    const result = validateLineItems([line()]);
    expect(result.issues).toHaveLength(0);
    expect(result.issuesByLocalId.size).toBe(0);
  });

  it("flags missing budget line", () => {
    const result = validateLineItems([line({ budgetLineId: "" })]);
    expect(result.issues.some((i) => i.message === "Select a budget line.")).toBe(true);
  });

  it("allows duplicate budget lines", () => {
    const result = validateLineItems([
      line({ localId: 1, budgetLineId: "10" }),
      line({ localId: 2, budgetLineId: "10" }),
    ]);
    expect(result.issues.some((i) => i.message.includes("duplicated"))).toBe(false);
    expect(result.issues.length).toBe(0);
  });

  it("flags adjustment line without reason", () => {
    const result = validateLineItems([line({ lineType: "adjustment", adjustmentReason: "" })]);
    expect(result.issues.some((i) => i.message.includes("reason"))).toBe(true);
  });

  it("does not flag scope line without reason", () => {
    const result = validateLineItems([line({ lineType: "scope", adjustmentReason: "" })]);
    expect(result.issues).toHaveLength(0);
  });

  it("flags non-numeric amount delta", () => {
    const result = validateLineItems([line({ amountDelta: "abc" })]);
    expect(result.issues.some((i) => i.message.includes("Amount delta"))).toBe(true);
  });

  it("flags non-integer days delta", () => {
    const result = validateLineItems([line({ daysDelta: "2.5" })]);
    expect(result.issues.some((i) => i.message.includes("Days delta"))).toBe(true);
  });

  it("flags non-numeric days delta", () => {
    const result = validateLineItems([line({ daysDelta: "xyz" })]);
    expect(result.issues.some((i) => i.message.includes("Days delta"))).toBe(true);
  });

  it("collects multiple issues per line", () => {
    const result = validateLineItems([
      line({ budgetLineId: "", amountDelta: "bad", daysDelta: "bad" }),
    ]);
    expect(result.issues.length).toBeGreaterThanOrEqual(3);
  });

  it("includes correct row numbers", () => {
    const result = validateLineItems([
      line({ localId: 1 }),
      line({ localId: 2, budgetLineId: "" }),
    ]);
    const issue = result.issues.find((i) => i.localId === 2);
    expect(issue?.rowNumber).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// emptyLine
// ---------------------------------------------------------------------------

describe("emptyLine", () => {
  it("creates a line with the given localId", () => {
    const result = emptyLine(3);
    expect(result.localId).toBe(3);
    expect(result.lineType).toBe("scope");
    expect(result.adjustmentReason).toBe("");
    expect(result.budgetLineId).toBe("");
    expect(result.description).toBe("");
    expect(result.amountDelta).toBe("0.00");
    expect(result.daysDelta).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// defaultChangeOrderTitle
// ---------------------------------------------------------------------------

describe("defaultChangeOrderTitle", () => {
  it("returns generic title when no project name", () => {
    expect(defaultChangeOrderTitle()).toBe("Change Order");
  });

  it("returns generic title for empty string", () => {
    expect(defaultChangeOrderTitle("")).toBe("Change Order");
  });

  it("returns generic title for whitespace-only", () => {
    expect(defaultChangeOrderTitle("   ")).toBe("Change Order");
  });

  it("includes the project name", () => {
    expect(defaultChangeOrderTitle("Kitchen Remodel")).toBe("Change Order: Kitchen Remodel");
  });

  it("trims the project name", () => {
    expect(defaultChangeOrderTitle("  Bathroom  ")).toBe("Change Order: Bathroom");
  });
});

// ---------------------------------------------------------------------------
// coLabel
// ---------------------------------------------------------------------------

describe("coLabel", () => {
  it("formats family_key and revision_number", () => {
    expect(coLabel({ family_key: "3", revision_number: 2 })).toBe("CO-3 v2");
  });

  it("handles first revision", () => {
    expect(coLabel({ family_key: "1", revision_number: 1 })).toBe("CO-1 v1");
  });
});

// ---------------------------------------------------------------------------
// publicChangeOrderHref
// ---------------------------------------------------------------------------

describe("publicChangeOrderHref", () => {
  it("returns path with public ref", () => {
    expect(publicChangeOrderHref("abc-123")).toBe("/change-order/abc-123");
  });

  it("returns empty string for undefined", () => {
    expect(publicChangeOrderHref(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(publicChangeOrderHref("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// readChangeOrderApiError
// ---------------------------------------------------------------------------

describe("readChangeOrderApiError", () => {
  it("returns the API error message when present", () => {
    const payload = { error: { message: "Something went wrong" } };
    expect(readChangeOrderApiError(payload, "Fallback")).toBe("Something went wrong");
  });

  it("returns fallback when no error message", () => {
    expect(readChangeOrderApiError(undefined, "Fallback")).toBe("Fallback");
  });

  it("appends refresh hint for status transition errors", () => {
    const payload = { error: { message: "Invalid status transition from draft to approved" } };
    const result = readChangeOrderApiError(payload, "Fallback");
    expect(result).toContain("Invalid status transition");
    expect(result).toContain("Refresh to load the latest status");
  });

  it("does not append refresh hint if message already mentions refresh", () => {
    const payload = { error: { message: "Invalid status transition. Please refresh." } };
    const result = readChangeOrderApiError(payload, "Fallback");
    expect(result).not.toContain("Refresh to load the latest status");
  });

  it("does not append refresh hint for non-transition errors", () => {
    const payload = { error: { message: "Permission denied" } };
    expect(readChangeOrderApiError(payload, "Fallback")).toBe("Permission denied");
  });
});
