import { BudgetsConsole } from "@/features/budgets";
import { redirect } from "next/navigation";
import styles from "./page.module.css";

type BudgetsPageProps = {
  searchParams: Promise<{ project?: string }>;
};

export default async function BudgetsPage({ searchParams }: BudgetsPageProps) {
  const { project } = await searchParams;
  if (!project || !/^\d+$/.test(project)) {
    redirect("/budgets-placeholder");
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Budgets</h1>
          <p>This is the internal “are we still making money on this job?” screen.</p>
          <p>
            This route gives users the internal execution baseline by converting approved estimate
            scope into immutable snapshot + editable working budget lines.
          </p>
          <p>
            It anchors downstream change-order financial propagation and cost tracking, keeping the
            internal money plan aligned with approved client scope decisions.
          </p>
        </header>
        <section className={styles.card}>
          <BudgetsConsole scopedProjectId={project} />
        </section>
        <section className={styles.card}>
          <h2>Workflow Context</h2>
          <p>
            Budgets are internal execution baselines derived from approved estimates. They are
            scoped per project to keep planned, committed, and actual cost tracking isolated by job.
          </p>
          <p>
            This is the internal cost-control layer, not the client-facing estimate surface.
          </p>
        </section>
      </main>
    </div>
  );
}
