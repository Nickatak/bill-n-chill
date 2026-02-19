import Link from "next/link";
import styles from "./page.module.css";

export default function EstimatesPlaceholderPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Estimates</h1>
          <p>
            Estimates now run as a per-project workflow only. This keeps estimate history, revisions,
            and status transitions scoped to a single job.
          </p>
        </header>
        <section className={styles.card}>
          <h2>How to open estimates</h2>
          <p>
            Start from <strong>Projects</strong>, select a project, then choose{" "}
            <strong>Open Estimates</strong>.
          </p>
          <Link className={styles.linkButton} href="/projects">
            Go to Projects
          </Link>
        </section>
      </main>
    </div>
  );
}
