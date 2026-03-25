import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useVendorFilters } from "../hooks/use-vendor-filters";
import type { VendorRecord } from "../types";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeVendor(overrides: Partial<VendorRecord> = {}): VendorRecord {
  return {
    id: 1,
    name: "Acme Electric",
    email: "info@acme.com",
    phone: "555-0100",
    tax_id_last4: "1234",
    notes: "",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const sampleVendors: VendorRecord[] = [
  makeVendor({ id: 1, name: "Zephyr Plumbing", email: "zephyr@test.com" }),
  makeVendor({ id: 2, name: "Acme Electric", email: "acme@test.com" }),
  makeVendor({ id: 3, name: "Mountain Drywall", email: "mountain@test.com" }),
  makeVendor({ id: 4, name: "Home Depot", email: "" }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useVendorFilters", () => {
  it("sorts rows alphabetically by name", () => {
    const { result } = renderHook(() => useVendorFilters(sampleVendors));

    const names = result.current.filteredRows.map((r) => r.name);
    expect(names).toEqual(["Acme Electric", "Home Depot", "Mountain Drywall", "Zephyr Plumbing"]);
  });

  it("breaks alphabetical ties by id", () => {
    const tiedVendors: VendorRecord[] = [
      makeVendor({ id: 5, name: "Same Name" }),
      makeVendor({ id: 2, name: "Same Name" }),
    ];
    const { result } = renderHook(() => useVendorFilters(tiedVendors));

    const ids = result.current.filteredRows.map((r) => r.id);
    expect(ids).toEqual([2, 5]);
  });

  it("shows all rows when no search term", () => {
    const { result } = renderHook(() => useVendorFilters(sampleVendors));
    expect(result.current.filteredRows).toHaveLength(4);
  });

  it("filters by search term across name, email, phone, and tax ID", () => {
    const { result } = renderHook(() => useVendorFilters(sampleVendors));

    act(() => {
      result.current.setSearchTerm("acme");
    });
    expect(result.current.filteredRows).toHaveLength(1);
    expect(result.current.filteredRows[0].name).toBe("Acme Electric");
  });

  it("search matches on email", () => {
    const vendors = [makeVendor({ id: 1, name: "Test", email: "unique@vendor.com" })];
    const { result } = renderHook(() => useVendorFilters(vendors));

    act(() => {
      result.current.setSearchTerm("unique@vendor");
    });
    expect(result.current.filteredRows).toHaveLength(1);
  });

  it("search matches on tax_id_last4", () => {
    const vendors = [makeVendor({ id: 1, name: "Test", tax_id_last4: "9876" })];
    const { result } = renderHook(() => useVendorFilters(vendors));

    act(() => {
      result.current.setSearchTerm("9876");
    });
    expect(result.current.filteredRows).toHaveLength(1);
  });

  it("returns empty when search has no matches", () => {
    const { result } = renderHook(() => useVendorFilters(sampleVendors));

    act(() => {
      result.current.setSearchTerm("nonexistent");
    });
    expect(result.current.filteredRows).toHaveLength(0);
  });
});
