"use client";

import styles from "@/features/invoices/components/invoices-console.module.css";

export type ProjectListStatusValue = "prospect" | "active" | "on_hold" | "completed" | "cancelled";

export type ProjectListEntry = {
  id: number;
  name: string;
  customer_display_name: string;
  status: string;
};

type ProjectListViewerProps = {
  title?: string;
  projectsTotal: number;
  filteredProjectsTotal: number;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  expandedHint?: string;
  collapsedHint?: string;
  showSearchAndFilters: boolean;
  contextHint?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  statusValues: ProjectListStatusValue[];
  statusFilters: ProjectListStatusValue[];
  onToggleStatusFilter: (status: ProjectListStatusValue) => void;
  onShowAllStatuses: () => void;
  onResetStatuses: () => void;
  pagedProjects: ProjectListEntry[];
  selectedProjectId: string;
  onSelectProject: (project: ProjectListEntry) => void;
  statusLabel: (status: string) => string;
  statusToneClass: (status: string) => string;
  showPagination: boolean;
  currentPage: number;
  totalPages: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  emptyMessage?: string;
};

export function ProjectListViewer({
  title = "Project List",
  projectsTotal,
  filteredProjectsTotal,
  isExpanded,
  onToggleExpanded,
  expandedHint = "",
  collapsedHint = "Project list collapsed. Expand to search, filter, or select a project.",
  showSearchAndFilters,
  contextHint = "",
  searchValue,
  onSearchChange,
  statusValues,
  statusFilters,
  onToggleStatusFilter,
  onShowAllStatuses,
  onResetStatuses,
  pagedProjects,
  selectedProjectId,
  onSelectProject,
  statusLabel,
  statusToneClass,
  showPagination,
  currentPage,
  totalPages,
  onPrevPage,
  onNextPage,
  emptyMessage = "No projects match your filters.",
}: ProjectListViewerProps) {
  return (
    <section className={styles.controlBar}>
      <div className={styles.projectSelector}>
        <div className={styles.panelHeader}>
          <h3>{title}</h3>
          <div className={styles.panelHeaderActions}>
            <span className={styles.countBadge}>
              {filteredProjectsTotal}/{projectsTotal}
            </span>
            <button
              type="button"
              className={styles.panelToggleButton}
              onClick={onToggleExpanded}
              aria-expanded={isExpanded}
            >
              {isExpanded ? "Collapse" : "Expand"}
            </button>
          </div>
        </div>

        {isExpanded ? (
          <>
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
                            active
                              ? `${styles.projectFilterButtonActive} ${statusToneClass(statusValue)}`
                              : styles.projectFilterButtonInactive
                          }`}
                          aria-pressed={active}
                          onClick={() => onToggleStatusFilter(statusValue)}
                        >
                          {statusLabel(statusValue)}
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
                      Reset default
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p className={styles.inlineHint}>{contextHint}</p>
            )}

            <div className={styles.projectTableWrap}>
              <table className={styles.projectTable}>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Customer</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedProjects.length ? (
                    pagedProjects.map((project) => {
                      const isActive = String(project.id) === selectedProjectId;
                      return (
                        <tr
                          key={project.id}
                          className={`${styles.projectRow} ${isActive ? styles.projectRowActive : ""}`}
                          onClick={() => onSelectProject(project)}
                        >
                          <td className={styles.projectCellTitle}>
                            <strong>#{project.id}</strong> {project.name}
                          </td>
                          <td>{project.customer_display_name}</td>
                          <td>
                            {project.status ? (
                              <span className={`${styles.projectStatus} ${statusToneClass(project.status)}`}>
                                {statusLabel(project.status)}
                              </span>
                            ) : (
                              <span className={styles.projectStatus}>Unknown</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={3} className={styles.projectEmptyCell}>
                        {emptyMessage}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {showPagination ? (
                <div className={styles.projectPagination}>
                  <button
                    type="button"
                    className={styles.projectFilterActionButton}
                    onClick={onPrevPage}
                    disabled={currentPage <= 1}
                  >
                    Prev
                  </button>
                  <span>
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    className={styles.projectFilterActionButton}
                    onClick={onNextPage}
                    disabled={currentPage >= totalPages}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <p className={styles.inlineHint}>{collapsedHint}</p>
        )}
      </div>
    </section>
  );
}
