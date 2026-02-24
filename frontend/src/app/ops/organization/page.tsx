"use client";

import { useSharedSessionAuth } from "@/features/session/use-shared-session";
import styles from "./page.module.css";

export default function OrganizationWipPage() {
  const { organization, role } = useSharedSessionAuth();

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Organization (WIP)</h1>
          <p>
            Placeholder route for upcoming organization management. This is intentionally read-only
            so we can iterate UI and workflow first.
          </p>
        </header>

        <section className={styles.card}>
          <span className={styles.badge}>Roadmap Placeholder</span>
          <div className={styles.metaGrid}>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Display Name</span>
              <span className={styles.metaValue}>
                <code>{organization?.displayName ?? "No organization in session"}</code>
              </span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Slug</span>
              <span className={styles.metaValue}>
                <code>{organization?.slug ?? "n/a"}</code>
              </span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Organization ID</span>
              <span className={styles.metaValue}>
                <code>{organization?.id ? String(organization.id) : "n/a"}</code>
              </span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Session Role</span>
              <span className={styles.metaValue}>
                <code>{role}</code>
              </span>
            </div>
          </div>
        </section>

        <section className={styles.card}>
          <h2>Planned Build Steps</h2>
          <ul className={styles.todoList}>
            <li>Read-only org profile card (display name, slug, created timestamp).</li>
            <li>Member list with role/status chips.</li>
            <li>Owner/PM-only org settings edits.</li>
            <li>Membership invite / remove / role-change workflows.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
