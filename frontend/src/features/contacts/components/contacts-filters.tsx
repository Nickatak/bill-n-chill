"use client";

import styles from "./contacts-console.module.css";

type ActivityFilter = "all" | "active";
type ProjectFilter = "all" | "with_project";

type ContactsFiltersProps = {
  query: string;
  onQueryChange: (value: string) => void;
  activityFilter: ActivityFilter;
  onActivityFilterChange: (value: ActivityFilter) => void;
  projectFilter: ProjectFilter;
  onProjectFilterChange: (value: ProjectFilter) => void;
};

export function ContactsFilters({
  query,
  onQueryChange,
  activityFilter,
  onActivityFilterChange,
  projectFilter,
  onProjectFilterChange,
}: ContactsFiltersProps) {
  const includeArchived = activityFilter === "all";
  const withProjectOnly = projectFilter === "with_project";

  return (
    <div className={styles.controlsRow}>
      <label className={styles.controlLabel}>
        Search
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Name, phone, email, or address"
        />
      </label>
      <div className={styles.filterSwitchCard}>
        <div className={styles.filterSwitchHeader}>
          <span className={styles.filterSwitchTitle}>Projects</span>
        </div>
        <label className={styles.filterSwitchRow}>
          <span
            className={`${styles.filterSwitchState} ${
              !withProjectOnly ? styles.filterSwitchStateSelected : ""
            }`}
          >
            All
          </span>
          <input
            className={styles.switchInput}
            type="checkbox"
            checked={withProjectOnly}
            onChange={(event) => onProjectFilterChange(event.target.checked ? "with_project" : "all")}
            aria-label="Toggle project filter between all customers and customers with projects only"
          />
          <span
            className={`${styles.filterSwitchState} ${
              withProjectOnly ? styles.filterSwitchStateSelected : ""
            }`}
          >
            With projects
          </span>
        </label>
        <p className={styles.filterSwitchSummary}>
          {withProjectOnly ? "Showing customers with projects only" : "Showing all customers"}
        </p>
      </div>
      <div className={styles.filterSwitchCard}>
        <div className={styles.filterSwitchHeader}>
          <span className={styles.filterSwitchTitle}>Customer visibility</span>
        </div>
        <label className={styles.filterSwitchRow}>
          <span
            className={`${styles.filterSwitchState} ${
              !includeArchived ? styles.filterSwitchStateSelected : ""
            }`}
          >
            Active only
          </span>
          <input
            className={styles.switchInput}
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => onActivityFilterChange(event.target.checked ? "all" : "active")}
            aria-label="Toggle customer visibility between active-only and including archived customers"
          />
          <span
            className={`${styles.filterSwitchState} ${
              includeArchived ? styles.filterSwitchStateSelected : ""
            }`}
          >
            Include archived
          </span>
        </label>
        <p className={styles.filterSwitchSummary}>
          {includeArchived
            ? "Showing active and archived customers"
            : "Showing active customers only"}
        </p>
      </div>
    </div>
  );
}
