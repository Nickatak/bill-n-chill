/**
 * Shared hook for status filter state management.
 *
 * Extracts the common pattern used by quotes, invoices, and vendor bills:
 * a set of active status filters that can be toggled, reset, or shown-all,
 * plus derived status counts from a list of items.
 */

import { type Dispatch, type SetStateAction, useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UseStatusFiltersConfig = {
  /** All available statuses (from policy contract or fallback). */
  allStatuses: string[];
  /** Default filter selection (used for reset). */
  defaultFilters: string[];
  /**
   * When true, toggling a filter on preserves the ordering from `allStatuses`
   * rather than appending to the end. Quotes uses this; others don't.
   */
  preserveOrder?: boolean;
};

export type UseStatusFiltersReturn = {
  /** Currently active filter values. */
  filters: string[];
  /** Raw setter for imperative filter updates (e.g. contract load reconciliation). */
  setFilters: Dispatch<SetStateAction<string[]>>;
  /** Toggle a single status filter on/off. */
  toggleFilter: (status: string) => void;
  /** Activate all statuses. */
  showAll: () => void;
  /** Reset to default filters. */
  resetFilters: () => void;
  /** Compute status counts from an array of items with a `status` field. */
  countByStatus: (items: { status: string }[]) => Record<string, number>;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useStatusFilters(config: UseStatusFiltersConfig): UseStatusFiltersReturn {
  const { allStatuses, defaultFilters, preserveOrder = false } = config;

  const [filters, setFilters] = useState<string[]>(defaultFilters);

  const toggleFilter = useCallback(
    (status: string) => {
      setFilters((current) => {
        if (current.includes(status)) {
          return current.filter((s) => s !== status);
        }
        if (preserveOrder) {
          return allStatuses.filter((s) => s === status || current.includes(s));
        }
        return [...current, status];
      });
    },
    [allStatuses, preserveOrder],
  );

  const showAll = useCallback(() => {
    setFilters([...allStatuses]);
  }, [allStatuses]);

  const resetFilters = useCallback(() => {
    setFilters(defaultFilters);
  }, [defaultFilters]);

  const countByStatus = useMemo(() => {
    return (items: { status: string }[]): Record<string, number> => {
      const counts: Record<string, number> = {};
      for (const status of allStatuses) {
        counts[status] = 0;
      }
      for (const item of items) {
        if (item.status in counts) {
          counts[item.status]++;
        }
      }
      return counts;
    };
  }, [allStatuses]);

  return { filters, setFilters, toggleFilter, showAll, resetFilters, countByStatus };
}
