/**
 * Client-side customer list filtering.
 *
 * Applies activity (active vs archived) and project-ownership filters
 * on top of the server-fetched customer list. Pure derived state — no API calls,
 * no effects.
 *
 * Consumer: CustomersConsole (composed alongside useCustomerListFetch).
 *
 * ## State (useState)
 *
 * - activityFilter — "all" | "active"; defaults to "active" (hides archived)
 * - projectFilter  — "all" | "with_project"; defaults to "all"
 *
 * ## Memos
 *
 * - filteredRows
 *     Deps: [activityFilter, projectFilter, customerRows]
 *     Applies both filters to produce the display-ready subset.
 */

import { useMemo, useState } from "react";

import type { CustomerRow } from "../types";

type ActivityFilter = "all" | "active";
type ProjectFilter = "all" | "with_project";

export type { ActivityFilter, ProjectFilter };

/**
 * Filter customer rows by activity status and project ownership.
 *
 * @param customerRows - The full customer list from the server (unfiltered).
 * @returns Filter state, setters, and the derived `filteredRows`.
 */
export function useCustomerFilters(customerRows: CustomerRow[]) {

  // --- State ---

  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("active");
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");

  // --- Memos ---

  const filteredRows = useMemo(() => {
    return customerRows.filter((row) => {
      const inactive = Boolean(row.is_archived);
      const hasProject = row.has_project ?? (row.projects_count ?? 0) > 0;

      const activityMatch =
        activityFilter === "all" || (activityFilter === "active" && !inactive);

      const projectMatch =
        projectFilter === "all" || (projectFilter === "with_project" && hasProject);

      return activityMatch && projectMatch;
    });
  }, [activityFilter, projectFilter, customerRows]);

  // --- Return bag ---

  return {
    // State
    activityFilter,
    projectFilter,
    filteredRows,

    // Setters
    setActivityFilter,
    setProjectFilter,
  };
}
