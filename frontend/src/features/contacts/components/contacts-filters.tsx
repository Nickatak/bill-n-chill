"use client";

import styles from "./contacts-console.module.css";

type ActivityFilter = "all" | "active" | "inactive";
type ProjectFilter = "all" | "with_project" | "without_project";

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
      <label className={styles.controlLabel}>
        Activity
        <select
          value={activityFilter}
          onChange={(event) => onActivityFilterChange(event.target.value as ActivityFilter)}
        >
          <option value="all">all</option>
          <option value="active">active</option>
          <option value="inactive">inactive</option>
        </select>
      </label>
      <label className={styles.controlLabel}>
        Project
        <select
          value={projectFilter}
          onChange={(event) => onProjectFilterChange(event.target.value as ProjectFilter)}
        >
          <option value="all">all</option>
          <option value="with_project">with project</option>
          <option value="without_project">without project</option>
        </select>
      </label>
    </div>
  );
}
