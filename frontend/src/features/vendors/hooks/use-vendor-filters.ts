/**
 * Client-side vendor search and activity filtering.
 *
 * Sorts vendors alphabetically by name, then applies a text search
 * and an active/all activity filter. Pure derived state — no API calls,
 * no effects.
 *
 * Consumer: VendorsConsole (composed alongside useVendorForm
 * and useVendorCsvImport).
 *
 * ## State (useState)
 *
 * - searchTerm      — live text input for filtering by name/email/phone/taxId
 * - activityFilter  — "active" | "all"; defaults to "active"
 *
 * ## Memos
 *
 * - orderedRows
 *     Deps: [vendors]
 *     Alphabetical sort by name, tiebreak by id.
 *
 * - filteredRows
 *     Deps: [activityFilter, orderedRows, searchTerm]
 *     Applies activity + text search on top of the sorted list.
 */

import { useMemo, useState } from "react";

import type { VendorRecord } from "../types";

type ActivityFilter = "active" | "all";

export type { ActivityFilter };

/**
 * Filter and sort vendors by search text and activity status.
 *
 * @param vendors - The full vendor list from the server (unsorted, unfiltered).
 * @returns Filter state, setters, sorted/filtered rows, and derived counts.
 */
export function useVendorFilters(vendors: VendorRecord[]) {

  // --- State ---

  const [searchTerm, setSearchTerm] = useState("");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("active");

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
    return orderedRows.filter((row) => {
      if (activityFilter === "active" && !row.is_active) {
        return false;
      }
      if (!needle) {
        return true;
      }
      const haystack = `${row.id} ${row.name} ${row.email} ${row.phone} ${row.tax_id_last4}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [activityFilter, orderedRows, searchTerm]);

  // --- Derived ---

  const activeCount = useMemo(() => vendors.filter((row) => row.is_active).length, [vendors]);
  const inactiveCount = vendors.length - activeCount;

  // --- Return bag ---

  return {
    // State
    searchTerm,
    activityFilter,
    filteredRows,
    activeCount,
    inactiveCount,

    // Setters
    setSearchTerm,
    setActivityFilter,
  };
}
