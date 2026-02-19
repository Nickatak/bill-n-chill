import Link from "next/link";
import styles from "./page.module.css";

export default function BudgetsPlaceholderPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Budgets</h1>
          <p>
            Budgets run as a per-project workflow. This keeps internal baseline tracking and
            working budget updates scoped to a single job.
          </p>
        </header>
        <section className={styles.card}>
          <h2>How to open budgets</h2>
          <p>
            Start from <strong>Projects</strong>, select a project, then choose{" "}
            <strong>Budgets</strong> from that project context.
          </p>
          <Link className={styles.linkButton} href="/projects">
            Go to Projects
          </Link>
        </section>
      </main>
    </div>
  );
}
