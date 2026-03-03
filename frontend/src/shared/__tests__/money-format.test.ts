import { describe, expect, it } from "vitest";
import { parseAmount, formatDecimal, formatCurrency } from "../money-format";

describe("parseAmount", () => {
  it("parses a normal decimal string", () => {
    expect(parseAmount("1234.56")).toBe(1234.56);
  });

  it("returns 0 for undefined", () => {
    expect(parseAmount(undefined)).toBe(0);
  });

  it("returns 0 for empty string", () => {
    expect(parseAmount("")).toBe(0);
  });

  it("returns 0 for non-numeric string", () => {
    expect(parseAmount("abc")).toBe(0);
  });

  it("returns 0 for Infinity", () => {
    expect(parseAmount("Infinity")).toBe(0);
  });

  it("handles negative values", () => {
    expect(parseAmount("-50.25")).toBe(-50.25);
  });

  it("handles zero", () => {
    expect(parseAmount("0")).toBe(0);
  });
});

describe("formatDecimal", () => {
  it("formats a whole number with two decimal places", () => {
    expect(formatDecimal(100)).toBe("100.00");
  });

  it("rounds to two decimal places", () => {
    expect(formatDecimal(1.005)).toBe("1.00"); // IEEE 754 rounding
    expect(formatDecimal(1.006)).toBe("1.01");
  });

  it("preserves negative sign", () => {
    expect(formatDecimal(-42.5)).toBe("-42.50");
  });

  it("formats zero", () => {
    expect(formatDecimal(0)).toBe("0.00");
  });
});

describe("formatCurrency", () => {
  it("formats with dollar sign and commas", () => {
    expect(formatCurrency(1234.56)).toBe("$1,234.56");
  });

  it("formats zero as $0.00", () => {
    expect(formatCurrency(0)).toBe("$0.00");
  });

  it("formats large numbers with proper grouping", () => {
    expect(formatCurrency(1000000)).toBe("$1,000,000.00");
  });

  it("formats negative values", () => {
    expect(formatCurrency(-250.5)).toBe("-$250.50");
  });
});
