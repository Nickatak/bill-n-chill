"use client";

import { useState } from "react";
import Link from "next/link";

import type { ProjectRecord } from "@/features/projects/types";

import { CustomerRow } from "../types";
import styles from "./contacts-console.module.css";

type ContactsListProps = {
  rows: CustomerRow[];
  filteredRows: CustomerRow[];
  query: string;
  projectsByCustomer: Record<number, ProjectRecord[]>;
  onEdit: (id: string) => void;
  onCreateProject: (customer: CustomerRow) => void;
};

const PROJECT_STATUS_ORDER = ["prospect", "active", "on_hold", "completed", "cancelled"] as const;
type ProjectStatusKey = (typeof PROJECT_STATUS_ORDER)[number];
type ProjectStatusFilterState = Record<ProjectStatusKey, boolean>;

const ALL_PROJECT_STATUS_FILTERS: ProjectStatusFilterState = {
  prospect: true,
  active: true,
  on_hold: true,
  completed: true,
  cancelled: true,
};

function projectStatusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

function projectStatusSummaryLabel(status: ProjectStatusKey, count: number): string {
  return `${count} ${projectStatusLabel(status)}`;
}

function projectStatusClass(status: string): string {
  if (status === "prospect") {
    return styles.projectStatusProspect;
  }
  if (status === "active") {
    return styles.projectStatusActive;
  }
  if (status === "on_hold") {
    return styles.projectStatusOnHold;
  }
  if (status === "completed") {
    return styles.projectStatusCompleted;
  }
  if (status === "cancelled") {
    return styles.projectStatusCancelled;
  }
  return "";
}

export function ContactsList({
  rows,
  filteredRows,
  query,
  projectsByCustomer,
  onEdit,
  onCreateProject,
}: ContactsListProps) {
  const [openCustomerId, setOpenCustomerId] = useState<number | null>(null);
  const [projectStatusFiltersByCustomer, setProjectStatusFiltersByCustomer] = useState<
    Record<number, ProjectStatusFilterState>
  >({});
  const visibleOpenCustomerId = filteredRows.some((row) => row.id === openCustomerId)
    ? openCustomerId
    : null;

  return (
    <section className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Customer</th>
            <th>Phone / Email</th>
            <th>Projects</th>
          </tr>
        </thead>
        <tbody>
          {filteredRows.map((row) => {
            const projects = projectsByCustomer[row.id] ?? [];
            const isInactive = Boolean(row.is_archived);
            const isExpanded = visibleOpenCustomerId === row.id;
            const projectCountsByStatus = PROJECT_STATUS_ORDER.reduce(
              (acc, status) => {
                acc[status] = projects.filter((project) => project.status === status).length;
                return acc;
              },
              {
                prospect: 0,
                active: 0,
                on_hold: 0,
                completed: 0,
                cancelled: 0,
              } as Record<ProjectStatusKey, number>,
            );
            const summaryStatuses = PROJECT_STATUS_ORDER.filter(
              (status) => projectCountsByStatus[status] > 0,
            );
            const customerStatusFilters = projectStatusFiltersByCustomer[row.id] ?? ALL_PROJECT_STATUS_FILTERS;
            const visibleProjects = projects.filter(
              (project) => customerStatusFilters[project.status as ProjectStatusKey] ?? true,
            );
            const groupedProjects = PROJECT_STATUS_ORDER.map((status: ProjectStatusKey) => ({
              status,
              projects: visibleProjects.filter((project) => project.status === status),
            })).filter((group) => group.projects.length > 0);
            const hasAnyFilteredOutStatus = PROJECT_STATUS_ORDER.some(
              (status) => !customerStatusFilters[status],
            );
            return (
              <tr key={row.id} className={isInactive ? styles.tableRowInactive : ""}>
                <td>
                  <p className={styles.rowPrimary}>{row.display_name}</p>
                  <p className={styles.rowSecondary}>{row.billing_address || "no billing address"}</p>
                  <div className={styles.customerActionsInline}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => onEdit(String(row.id))}
                    >
                      Edit
                    </button>
                  </div>
                </td>
                <td>
                  <p className={styles.rowPrimary}>{row.phone || row.email || "no phone/email"}</p>
                  {row.phone && row.email ? <p className={styles.rowSecondary}>{row.email}</p> : null}
                </td>
                <td>
                  <div className={styles.projectCellHeader}>
                    <button
                      type="button"
                      className={styles.projectAccordionToggle}
                      aria-expanded={isExpanded}
                      aria-controls={`customer-projects-${row.id}`}
                      onClick={() =>
                        setOpenCustomerId((current) => (current === row.id ? null : row.id))
                      }
                    >
                      <span className={styles.projectAccordionStatusList}>
                        {summaryStatuses.map((status) => (
                          <span
                            key={`${row.id}-${status}-summary`}
                            className={`${styles.projectStatusPill} ${projectStatusClass(status)}`}
                            title={`${projectStatusSummaryLabel(status, projectCountsByStatus[status])} project${
                              projectCountsByStatus[status] === 1 ? "" : "s"
                            }`}
                          >
                            {projectStatusSummaryLabel(status, projectCountsByStatus[status])}
                          </span>
                        ))}
                      </span>
                      <span className={styles.projectAccordionCaret}>
                        {isExpanded ? "Hide projects" : "Show projects"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label={`Create project for ${row.display_name}`}
                      onClick={() => onCreateProject(row)}
                    >
                      +
                    </button>
                  </div>
                  {isExpanded ? (
                    <div id={`customer-projects-${row.id}`} className={styles.projectAccordionBody}>
                      <div className={styles.projectFilterBar}>
                        {PROJECT_STATUS_ORDER.map((status) => {
                          const count = projectCountsByStatus[status];
                          const enabled = customerStatusFilters[status];
                          return (
                            <button
                              key={`${row.id}-${status}`}
                              type="button"
                              className={`${styles.projectFilterChip} ${
                                enabled ? styles.projectFilterChipEnabled : styles.projectFilterChipDisabled
                              } ${enabled ? projectStatusClass(status) : ""}`}
                              aria-pressed={enabled}
                              onClick={() =>
                                setProjectStatusFiltersByCustomer((current) => ({
                                  ...current,
                                  [row.id]: {
                                    ...(current[row.id] ?? ALL_PROJECT_STATUS_FILTERS),
                                    [status]: !((current[row.id] ?? ALL_PROJECT_STATUS_FILTERS)[status]),
                                  },
                                }))
                              }
                            >
                              {projectStatusLabel(status)} ({count})
                            </button>
                          );
                        })}
                        {hasAnyFilteredOutStatus ? (
                          <button
                            type="button"
                            className={styles.projectFilterReset}
                            onClick={() =>
                              setProjectStatusFiltersByCustomer((current) => ({
                                ...current,
                                [row.id]: ALL_PROJECT_STATUS_FILTERS,
                              }))
                            }
                          >
                            Show all
                          </button>
                        ) : null}
                      </div>
                      {visibleProjects.length > 0 ? (
                        <div className={styles.projectStatusGroups}>
                          {groupedProjects.map((group) => (
                            <section key={group.status} className={styles.projectStatusGroup}>
                              <header className={styles.projectStatusGroupHeader}>
                                <span
                                  className={`${styles.projectStatusHeader} ${projectStatusClass(group.status)}`}
                                >
                                  {projectStatusLabel(group.status)}
                                </span>
                                <span className={styles.rowSecondary}>
                                  {group.projects.length} project{group.projects.length === 1 ? "" : "s"}
                                </span>
                              </header>
                              <div className={styles.projectLinks}>
                                {group.projects.map((project) => (
                                  <Link
                                    key={project.id}
                                    href={`/projects?project=${project.id}`}
                                    className={styles.projectAccordionLink}
                                  >
                                    <span className={styles.projectLinkLabel}>
                                      #{project.id} {project.name}
                                    </span>
                                  </Link>
                                ))}
                              </div>
                            </section>
                          ))}
                        </div>
                      ) : (
                        <span className={styles.rowSecondary}>
                          {projects.length > 0 ? "No visible projects for current filters" : "No projects yet"}
                        </span>
                      )}
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {filteredRows.length === 0 ? (
        <p className={styles.emptyState}>
          {rows.length > 0
            ? "No customers match the current filters."
            : query
              ? "No customers matched your search."
              : "No customers yet."}
        </p>
      ) : null}
    </section>
  );
}
