/**
 * Project list panel with search, status filters, and card grid.
 *
 * Used as a sidebar/panel component on pages that need project selection
 * (e.g. projects, invoices, bills). The parent page owns all data-fetching
 * and filter state; this component is a pure presentation layer that renders
 * the search field, status filter buttons, and a scrollable card grid.
 */

"use client";

import styles from "./project-list-viewer.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProjectListStatusValue = "prospect" | "active" | "on_hold" | "completed" | "cancelled";

export type ProjectListEntry = {
  id: number;
  name: string;
  customer_display_name: string;
  status: string;
};

type ProjectListViewerProps = {
  title?: string;
  expandedHint?: string;
  showSearchAndFilters: boolean;
  contextHint?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  statusValues: ProjectListStatusValue[];
  statusFilters: ProjectListStatusValue[];
  statusCounts?: Partial<Record<ProjectListStatusValue, number>>;
  onToggleStatusFilter: (status: ProjectListStatusValue) => void;
  onShowAllStatuses: () => void;
  onResetStatuses: () => void;
  projects: ProjectListEntry[];
  selectedProjectId: string;
  onSelectProject: (project: ProjectListEntry) => void;
  statusLabel: (status: string) => string;
  emptyMessage?: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Render a project list with search, status filters, and card grid.
 *
 * The panel displays a search input, status filter toggle buttons
 * with per-status counts, and a scrollable grid of project cards.
 */
export function ProjectListViewer({
  title = "Project List",
  expandedHint = "",
  showSearchAndFilters,
  contextHint = "",
  searchValue,
  onSearchChange,
  statusValues,
  statusFilters,
  statusCounts,
  onToggleStatusFilter,
  onShowAllStatuses,
  onResetStatuses,
  projects,
  selectedProjectId,
  onSelectProject,
  statusLabel,
  emptyMessage = "No projects match your filters.",
}: ProjectListViewerProps) {
  /**
   * Map a project status value to its CSS module tone class for the
   * inline status badge (e.g. "active" -> styles.projectStatusActive).
   */
  function statusToneClass(statusValue: string): string {
    const key = `projectStatus${statusValue
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("")}`;
    return styles[key] ?? "";
  }

  /**
   * Map a status value to its CSS module tone class for the filter buttons.
   */
  function statusFilterToneClass(statusValue: ProjectListStatusValue): string {
    switch (statusValue) {
      case "prospect":
        return styles.projectFilterToneProspect;
      case "active":
        return styles.projectFilterToneActive;
      case "on_hold":
        return styles.projectFilterToneOnHold;
      case "completed":
        return styles.projectFilterToneCompleted;
      case "cancelled":
        return styles.projectFilterToneCancelled;
      default:
        return "";
    }
  }

  return (
    <section className={styles.controlBar}>
      <div className={styles.projectSelector}>
        <div className={styles.panelHeader}>
          <h3>{title}</h3>
        </div>

            {expandedHint ? <p className={styles.inlineHint}>{expandedHint}</p> : null}
            {showSearchAndFilters ? (
              <>
                <label className={styles.searchField}>
                  <span>Search projects</span>
                  <input
                    value={searchValue}
                    onChange={(event) => onSearchChange(event.target.value)}
                    placeholder="Search by id, name, customer, or status"
                  />
                </label>

                <div className={styles.projectFilters}>
                  <span className={styles.projectFiltersLabel}>Project status filter</span>
                  <div className={styles.projectFilterButtons}>
                    {statusValues.map((statusValue) => {
                      const active = statusFilters.includes(statusValue);
                      return (
                        <button
                          key={statusValue}
                          type="button"
                          className={`${styles.projectFilterButton} ${
                            active ? styles.projectFilterButtonActive : styles.projectFilterButtonInactive
                          } ${statusFilterToneClass(statusValue)}`}
                          data-active={active ? "true" : "false"}
                          aria-pressed={active}
                          onClick={() => onToggleStatusFilter(statusValue)}
                        >
                          {statusLabel(statusValue)}
                          <span className={styles.projectFilterCount}>
                            {statusCounts?.[statusValue] ?? 0}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className={styles.projectFilterActions}>
                    <button
                      type="button"
                      className={styles.projectFilterActionButton}
                      onClick={onShowAllStatuses}
                    >
                      Show all projects
                    </button>
                    <button
                      type="button"
                      className={styles.projectFilterActionButton}
                      onClick={onResetStatuses}
                    >
                      Reset filters
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p className={styles.inlineHint}>{contextHint}</p>
            )}

            <div className={styles.projectCardGrid}>
              {projects.length > 0 ? (
                projects.map((project) => {
                  const isActive = String(project.id) === selectedProjectId;
                  return (
                    <div
                      key={project.id}
                      className={`${styles.projectCard} ${isActive ? styles.projectCardActive : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectProject(project)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelectProject(project);
                        }
                      }}
                    >
                      <span className={styles.projectCardTitle}>
                        #{project.id} {project.name}
                      </span>
                      <span className={styles.projectCardMeta}>
                        <span className={styles.projectCardCustomer}>
                          {project.customer_display_name}
                        </span>
                        {project.status ? (
                          <span className={`${styles.projectStatus} ${statusToneClass(project.status)}`}>
                            {statusLabel(project.status)}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  );
                })
              ) : (
                <span className={styles.projectEmptyMessage}>{emptyMessage}</span>
              )}
            </div>
      </div>
    </section>
  );
}
