"use client";

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
};

function projectStatusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

export function ContactsList({
  rows,
  filteredRows,
  query,
  projectsByCustomer,
  onEdit,
}: ContactsListProps) {
  return (
    <section className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Customer</th>
            <th>Phone / Email</th>
            <th>Projects</th>
            <th>State</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredRows.map((row) => {
            const projects = projectsByCustomer[row.id] ?? [];
            const firstProject = projects[0] ?? null;
            const isInactive = Boolean(row.is_archived);
            return (
              <tr key={row.id} className={isInactive ? styles.tableRowInactive : ""}>
                <td>
                  <p className={styles.rowPrimary}>#{row.id} - {row.display_name}</p>
                  <p className={styles.rowSecondary}>{row.billing_address || "no billing address"}</p>
                </td>
                <td>
                  <p className={styles.rowPrimary}>{row.phone || row.email || "no phone/email"}</p>
                  {row.phone && row.email ? <p className={styles.rowSecondary}>{row.email}</p> : null}
                </td>
                <td>
                  {projects.length > 0 ? (
                    <div className={styles.projectLinks}>
                      {projects.slice(0, 4).map((project) => (
                        <Link
                          key={project.id}
                          href={`/projects?project=${project.id}`}
                          className={styles.projectLink}
                        >
                          #{project.id} {project.name} ({projectStatusLabel(project.status)})
                        </Link>
                      ))}
                      {projects.length > 4 ? (
                        <span className={styles.rowSecondary}>+{projects.length - 4} more</span>
                      ) : null}
                    </div>
                  ) : (
                    <span className={styles.rowSecondary}>No non-prospect projects</span>
                  )}
                </td>
                <td>
                  <span
                    className={`${styles.stateChip} ${
                      isInactive ? styles.stateChipInactive : styles.stateChipActive
                    }`}
                  >
                    {isInactive ? "inactive" : "active"}
                  </span>
                </td>
                <td>
                  <div className={styles.actionsInline}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => onEdit(String(row.id))}
                    >
                      Edit
                    </button>
                    <Link href={firstProject ? `/projects?project=${firstProject.id}` : "/projects"}>
                      Open Projects
                    </Link>
                  </div>
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
