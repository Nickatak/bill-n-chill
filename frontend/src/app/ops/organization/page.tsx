"use client";

import { useSharedSessionAuth } from "@/features/session/use-shared-session";
import shell from "@/app/wip-shell.module.css";
import styles from "./page.module.css";

export default function OrganizationWipPage() {
  const { organization, role } = useSharedSessionAuth();

  return (
    <div className={shell.page}>
      <main className={`${shell.main} ${shell.mainNarrow}`}>
        <header className={shell.hero}>
          <div className={shell.heroTop}>
            <p className={shell.eyebrow}>Ops / Meta</p>
            <h1 className={shell.title}>Organization (WIP)</h1>
            <p className={shell.copy}>
              Read-only scaffold for organization identity and membership controls. We are keeping
              this stable while the org-first workflow settles.
            </p>
          </div>
          <div className={shell.heroMetaRow}>
            <span className={shell.metaPill}>RBAC-backed</span>
            <span className={shell.metaPill}>Session-aware</span>
            <span className={shell.metaPill}>Management UI pending</span>
          </div>
        </header>

        <section className={shell.card}>
          <span className={styles.badge}>Current Session Snapshot</span>
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

        <section className={`${shell.card} ${shell.cardMuted}`}>
          <h2 className={shell.sectionTitle}>Planned Build Steps</h2>
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
