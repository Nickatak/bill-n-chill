"use client";

/**
 * Compact filter bar for the customer list: free-text search and inline
 * segmented controls for activity and project ownership filtering.
 *
 * Parent: CustomersConsole
 */

import segmented from "../../../shared/styles/segmented.module.css";
import styles from "./customers-console.module.css";

type ActivityFilter = "all" | "active";
type ProjectFilter = "all" | "with_project";

type CustomersFiltersProps = {
  query: string;
  onQueryChange: (value: string) => void;
  activityFilter: ActivityFilter;
  onActivityFilterChange: (value: ActivityFilter) => void;
  projectFilter: ProjectFilter;
  onProjectFilterChange: (value: ProjectFilter) => void;
};

/** Renders search input and inline segmented controls for activity/project filters. */
export function CustomersFilters({
  query,
  onQueryChange,
  activityFilter,
  onActivityFilterChange,
  projectFilter,
  onProjectFilterChange,
}: CustomersFiltersProps) {
  return (
    <div className={styles.controlsRow}>
      <input
        className={styles.searchInput}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Search by name, phone, email, or address"
      />
      <div className={styles.filterControls}>
        <div className={segmented.group}>
          <button
            type="button"
            className={`${segmented.option} ${activityFilter === "active" ? segmented.optionActive : ""}`}
            onClick={() => onActivityFilterChange("active")}
          >
            Active
          </button>
          <button
            type="button"
            className={`${segmented.option} ${activityFilter === "all" ? segmented.optionActive : ""}`}
            onClick={() => onActivityFilterChange("all")}
          >
            All
          </button>
        </div>
        <div className={segmented.group}>
          <button
            type="button"
            className={`${segmented.option} ${projectFilter === "all" ? segmented.optionActive : ""}`}
            onClick={() => onProjectFilterChange("all")}
          >
            All
          </button>
          <button
            type="button"
            className={`${segmented.option} ${projectFilter === "with_project" ? segmented.optionActive : ""}`}
            onClick={() => onProjectFilterChange("with_project")}
          >
            With Projects
          </button>
        </div>
      </div>
    </div>
  );
}
