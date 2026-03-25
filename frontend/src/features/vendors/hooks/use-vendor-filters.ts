/**
 * Client-side vendor search filtering.
 *
 * Sorts vendors alphabetically by name, then applies a text search.
 * Pure derived state — no API calls, no effects.
 *
 * Consumer: VendorsConsole (composed alongside useVendorForm
 * and useVendorCsvImport).
 */

import { useMemo, useState } from "react";

import type { VendorRecord } from "../types";

/**
 * Filter and sort vendors by search text.
 *
 * @param vendors - The full vendor list from the server (unsorted, unfiltered).
 * @returns Filter state, setters, and sorted/filtered rows.
 */
export function useVendorFilters(vendors: VendorRecord[]) {

  // --- State ---

  const [searchTerm, setSearchTerm] = useState("");

  // --- Memos ---

  const orderedRows = useMemo(
    () =>
      [...vendors].sort((left, right) => {
        if (left.name !== right.name) {
          return left.name.localeCompare(right.name);
        }
        return left.id - right.id;
      }),
    [vendors],
  );

  const filteredRows = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return orderedRows;
    return orderedRows.filter((row) => {
      const haystack = `${row.id} ${row.name} ${row.email} ${row.phone} ${row.tax_id_last4}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [orderedRows, searchTerm]);

  // --- Return bag ---

  return {
    searchTerm,
    filteredRows,
    setSearchTerm,
  };
}
