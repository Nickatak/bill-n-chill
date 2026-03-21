import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useCostCodeFilters } from "../hooks/use-cost-code-filters";
import type { CostCode } from "../types";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeCostCode(overrides: Partial<CostCode> = {}): CostCode {
  return {
    id: 1,
    code: "01-100",
    name: "General Conditions",
    is_active: true,
    ...overrides,
  };
}

const activeCodes: CostCode[] = [
  makeCostCode({ id: 1, code: "03-300", name: "Concrete" }),
  makeCostCode({ id: 2, code: "01-100", name: "General Conditions" }),
  makeCostCode({ id: 3, code: "09-250", name: "Drywall" }),
];

const mixedCodes: CostCode[] = [
  ...activeCodes,
  makeCostCode({ id: 4, code: "02-200", name: "Demolition", is_active: false }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useCostCodeFilters", () => {
  it("sorts rows alphabetically by code", () => {
    const { result } = renderHook(() => useCostCodeFilters(activeCodes));

    const codes = result.current.filteredRows.map((r) => r.code);
    expect(codes).toEqual(["01-100", "03-300", "09-250"]);
  });

  it("defaults to active-only visibility", () => {
    const { result } = renderHook(() => useCostCodeFilters(mixedCodes));

    expect(result.current.visibilityFilter).toBe("active");
    expect(result.current.filteredRows).toHaveLength(3);
    expect(result.current.filteredRows.every((r) => r.is_active)).toBe(true);
  });

  it("shows all rows when visibility is set to 'all'", () => {
    const { result } = renderHook(() => useCostCodeFilters(mixedCodes));

    act(() => {
      result.current.setVisibilityFilter("all");
    });

    expect(result.current.filteredRows).toHaveLength(4);
    expect(result.current.includeArchived).toBe(true);
  });

  it("filters by search term across code and name", () => {
    const { result } = renderHook(() => useCostCodeFilters(activeCodes));

    act(() => {
      result.current.setSearchTerm("concrete");
    });

    expect(result.current.filteredRows).toHaveLength(1);
    expect(result.current.filteredRows[0].code).toBe("03-300");
  });

  it("search is case-insensitive", () => {
    const { result } = renderHook(() => useCostCodeFilters(activeCodes));

    act(() => {
      result.current.setSearchTerm("DRYWALL");
    });

    expect(result.current.filteredRows).toHaveLength(1);
    expect(result.current.filteredRows[0].name).toBe("Drywall");
  });

  it("combines visibility and search filters", () => {
    const { result } = renderHook(() => useCostCodeFilters(mixedCodes));

    // Default active-only — searching for "demo" finds nothing (it's archived)
    act(() => {
      result.current.setSearchTerm("demo");
    });
    expect(result.current.filteredRows).toHaveLength(0);

    // Switch to "all" — now the archived demolition row appears
    act(() => {
      result.current.setVisibilityFilter("all");
    });
    expect(result.current.filteredRows).toHaveLength(1);
    expect(result.current.filteredRows[0].name).toBe("Demolition");
  });

  it("computes active and archived counts from the full list", () => {
    const { result } = renderHook(() => useCostCodeFilters(mixedCodes));

    expect(result.current.activeCount).toBe(3);
    expect(result.current.archivedCount).toBe(1);
  });

  it("returns all rows when search is empty whitespace", () => {
    const { result } = renderHook(() => useCostCodeFilters(activeCodes));

    act(() => {
      result.current.setSearchTerm("   ");
    });

    expect(result.current.filteredRows).toHaveLength(3);
  });
});
