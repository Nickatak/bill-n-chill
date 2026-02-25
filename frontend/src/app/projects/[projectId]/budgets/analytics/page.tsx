import { BudgetAnalyticsConsole } from "@/features/budgets";
import Link from "next/link";
import { redirect } from "next/navigation";
import shell from "@/app/wip-shell.module.css";

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
    <div className={shell.page}>
      <main className={shell.main}>
        <header className={shell.hero}>
          <div className={shell.heroTop}>
            <p className={shell.eyebrow}>Projects</p>
            <h1 className={shell.title}>Budget Analytics (WIP)</h1>
            <p className={shell.copy}>
              Read-only budget truth for this project: baseline, committed, and variance metrics
              without mutating budget records.
            </p>
          </div>
          <div className={shell.linkRow}>
            <Link className={shell.linkButton} href={`/projects?project=${projectId}`}>
              Back to Project Hub
            </Link>
            <Link className={shell.linkButton} href={`/projects/${projectId}/change-orders`}>
              Next: Change Orders
            </Link>
          </div>
        </header>
        <section className={shell.card}>
          <BudgetAnalyticsConsole initialProjectId={projectId} />
        </section>
        <section className={`${shell.card} ${shell.cardMuted}`}>
          <h2 className={shell.sectionTitle}>Workflow Context</h2>
          <p className={shell.sectionCopy}>
            Budgets are internal execution baselines derived from approved estimates. They are
            scoped per project to keep planned, committed, and actual cost tracking isolated by job.
          </p>
          <p className={shell.sectionCopy}>
            This is the internal cost-control layer, not the customer-facing estimate surface.
          </p>
        </section>
      </main>
    </div>
  );
}
