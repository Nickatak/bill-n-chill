/**
 * Client-side cost code search and visibility filtering.
 *
 * Sorts cost codes alphabetically by code, then applies a text search
 * and an active/all visibility filter. Pure derived state — no API calls,
 * no effects.
 *
 * Consumer: CostCodesConsole (composed alongside useCostCodeForm).
 *
 * ## State (useState)
 *
 * - searchTerm       — live text input for filtering by code/name/id
 * - visibilityFilter — "active" | "all"; defaults to "active"
 *
 * ## Memos
 *
 * - orderedRows
 *     Deps: [costCodes]
 *     Alphabetical sort by code.
 *
 * - filteredRows
 *     Deps: [orderedRows, searchTerm, visibilityFilter]
 *     Applies visibility + text search on top of the sorted list.
 */

import { useMemo, useState } from "react";

import type { CostCode } from "../types";

type VisibilityFilter = "active" | "all";

export type { VisibilityFilter };

/**
 * Filter and sort cost codes by search text and visibility.
 *
 * @param costCodes - The full cost code list from the server (unsorted, unfiltered).
 * @returns Filter state, setters, sorted/filtered rows, and derived counts.
 */
export function useCostCodeFilters(costCodes: CostCode[]) {

  // --- State ---

  const [searchTerm, setSearchTerm] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("active");

  // --- Memos ---

  const orderedRows = useMemo(
    () => [...costCodes].sort((left, right) => left.code.localeCompare(right.code)),
    [costCodes],
  );

  const filteredRows = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return orderedRows.filter((row) => {
      if (visibilityFilter === "active" && !row.is_active) {
        return false;
      }
      if (!needle) {
        return true;
      }
      const haystack = `${row.code} ${row.name} ${row.id}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [orderedRows, searchTerm, visibilityFilter]);

  // --- Derived ---

  const activeCount = costCodes.filter((row) => row.is_active).length;
  const archivedCount = costCodes.length - activeCount;
  const includeArchived = visibilityFilter === "all";

  // --- Return bag ---

  return {
    // State
    searchTerm,
    visibilityFilter,
    filteredRows,
    activeCount,
    archivedCount,
    includeArchived,

    // Setters
    setSearchTerm,
    setVisibilityFilter,
  };
}
