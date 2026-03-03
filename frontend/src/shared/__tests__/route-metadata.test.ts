import { describe, expect, it } from "vitest";
import {
  isNumericRouteId,
  resolveProjectParamTitle,
  resolveProjectQueryTitle,
} from "../shell/route-metadata";

// ---------------------------------------------------------------------------
// isNumericRouteId
// ---------------------------------------------------------------------------

describe("isNumericRouteId", () => {
  it("returns true for digit-only string", () => {
    expect(isNumericRouteId("42")).toBe(true);
  });

  it("returns true for single digit", () => {
    expect(isNumericRouteId("7")).toBe(true);
  });

  it("returns true for zero-padded id", () => {
    expect(isNumericRouteId("001")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isNumericRouteId("")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isNumericRouteId(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isNumericRouteId(undefined)).toBe(false);
  });

  it("returns false for string with letters", () => {
    expect(isNumericRouteId("abc")).toBe(false);
  });

  it("returns false for negative number string", () => {
    expect(isNumericRouteId("-5")).toBe(false);
  });

  it("returns false for decimal string", () => {
    expect(isNumericRouteId("3.14")).toBe(false);
  });

  it("returns false for string with spaces", () => {
    expect(isNumericRouteId(" 42 ")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveProjectQueryTitle
// ---------------------------------------------------------------------------

describe("resolveProjectQueryTitle", () => {
  it("appends project id for valid numeric query", () => {
    expect(resolveProjectQueryTitle("Invoices", "17")).toBe(
      "Invoices - Project #17",
    );
  });

  it("returns base title for non-numeric query", () => {
    expect(resolveProjectQueryTitle("Invoices", "abc")).toBe("Invoices");
  });

  it("returns base title for undefined query", () => {
    expect(resolveProjectQueryTitle("Invoices", undefined)).toBe("Invoices");
  });
});

// ---------------------------------------------------------------------------
// resolveProjectParamTitle
// ---------------------------------------------------------------------------

describe("resolveProjectParamTitle", () => {
  it("builds scoped title for valid project id", () => {
    expect(resolveProjectParamTitle("17", "Estimates", "Project Estimates")).toBe(
      "Project #17 Estimates",
    );
  });

  it("returns fallback for non-numeric id", () => {
    expect(resolveProjectParamTitle("abc", "Estimates", "Project Estimates")).toBe(
      "Project Estimates",
    );
  });

  it("returns fallback for empty id", () => {
    expect(resolveProjectParamTitle("", "Estimates", "Project Estimates")).toBe(
      "Project Estimates",
    );
  });
});
