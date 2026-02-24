import { BudgetAnalyticsConsole } from "@/features/budgets";
import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "./page.module.css";

type ProjectBudgetAnalyticsPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectBudgetAnalyticsPage({
  params,
}: ProjectBudgetAnalyticsPageProps) {
  const { projectId } = await params;
  if (!/^\d+$/.test(projectId)) {
    redirect("/projects");
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Budget Analytics (WIP)</h1>
          <p>
            Read-only analytics surface for budget truth on this project. Use this view to monitor
            baseline, working totals, and variance without mutating budget records.
          </p>
          <p>
            <Link href={`/projects?project=${projectId}`}>Back to Project Hub</Link> |{" "}
            <Link href={`/projects/${projectId}/change-orders`}>Next: Review change orders</Link>
          </p>
        </header>
        <section className={styles.card}>
          <BudgetAnalyticsConsole initialProjectId={projectId} />
        </section>
        <section className={styles.card}>
          <h2>Workflow Context</h2>
          <p>
            Budgets are internal execution baselines derived from approved estimates. They are
            scoped per project to keep planned, committed, and actual cost tracking isolated by job.
          </p>
          <p>This is the internal cost-control layer, not the customer-facing estimate surface.</p>
        </section>
      </main>
    </div>
  );
}
