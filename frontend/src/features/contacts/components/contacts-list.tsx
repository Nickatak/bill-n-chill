"use client";

import { ContactRecord } from "../types";
import styles from "./contacts-console.module.css";

type ContactsListProps = {
  rows: ContactRecord[];
  filteredRows: ContactRecord[];
  selectedId: string;
  query: string;
  onSelect: (id: string) => void;
};

export function ContactsList({
  rows,
  filteredRows,
  selectedId,
  query,
  onSelect,
}: ContactsListProps) {
  return (
    <aside className={styles.panel}>
      <header className={styles.panelHeader}>
        <h3 className={styles.panelTitle}>Customers</h3>
        <p className={styles.panelSubtle}>Select a record to review and edit.</p>
      </header>

      {filteredRows.length > 0 ? (
        <ul className={styles.list}>
          {filteredRows.map((row) => {
            const isActive = selectedId === String(row.id);
            const isInactive = Boolean(row.is_archived);
            const hasProject = row.has_project ?? Boolean(row.converted_project);
            return (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onSelect(String(row.id))}
                  className={`${styles.listButton} ${isActive ? styles.listButtonActive : ""}`}
                >
                  <p className={styles.rowPrimary}>
                    #{row.id} - {row.full_name}
                  </p>
                  <p className={styles.rowSecondary}>{row.phone || row.email || "no contact"}</p>
                  <p className={styles.rowSecondary}>
                    <span
                      className={`${styles.statusBadge} ${
                        isInactive ? styles.statusBadgeInactive : ""
                      }`}
                    >
                      {isInactive ? "inactive" : "active"}
                    </span>
                    {" "}
                    <span
                      className={`${styles.projectBadge} ${
                        hasProject ? styles.projectBadgeYes : ""
                      }`}
                    >
                      {hasProject ? "project linked" : "no project"}
                    </span>
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      ) : rows.length > 0 ? (
        <p className={styles.emptyState}>No customers match the selected activity filter.</p>
      ) : query ? (
        <p className={styles.emptyState}>No customers matched your search.</p>
      ) : (
        <p className={styles.emptyState}>No customers yet.</p>
      )}
    </aside>
  );
}
