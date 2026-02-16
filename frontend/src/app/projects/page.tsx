import { ProjectsConsole } from "@/features/projects";
import styles from "./page.module.css";

export default function ProjectsPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Projects</h1>
          <p>
            This route gives users control over the project shell and contract baseline values
            that define approved billable scope.
          </p>
          <p>
            It connects to the whole system: estimates and change orders roll into contract
            current, invoices/payments and vendor-bills/payments drive summary totals, and audit +
            sync/export views validate end-to-end financial integrity.
          </p>
        </header>
        <section className={styles.card}>
          <ProjectsConsole />
        </section>
      </main>
    </div>
  );
}
