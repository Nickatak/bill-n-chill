import type { Metadata } from "next";
import { BudgetAnalyticsConsole } from "@/features/budgets";
import Link from "next/link";
import { redirect } from "next/navigation";
import shell from "@/app/page-shell.module.css";
import { PageCard, PageShell } from "@/app/page-shell";
import { isNumericRouteId, resolveProjectParamTitle } from "@/app/route-metadata";

type ProjectBudgetAnalyticsPageProps = {
  params: Promise<{ projectId: string }>;
};

export async function generateMetadata({
  params,
}: ProjectBudgetAnalyticsPageProps): Promise<Metadata> {
  const { projectId } = await params;
  return {
    title: resolveProjectParamTitle(projectId, "Budget Analytics", "Project Budget Analytics"),
  };
}

export default async function ProjectBudgetAnalyticsPage({
  params,
}: ProjectBudgetAnalyticsPageProps) {
  const { projectId } = await params;
  if (!isNumericRouteId(projectId)) {
    redirect("/projects");
  }

  return (
    <PageShell>
      <header className={shell.hero}>
        <div className={shell.heroTop}>
          <p className={shell.eyebrow}>Projects</p>
          <h1 className={shell.title}>Budget Analytics</h1>
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
      <PageCard>
        <BudgetAnalyticsConsole initialProjectId={projectId} />
      </PageCard>
      <PageCard muted>
        <h2 className={shell.sectionTitle}>Workflow Context</h2>
        <p className={shell.sectionCopy}>
          Budgets are internal execution baselines derived from approved estimates. They are
          scoped per project to keep planned, committed, and actual cost tracking isolated by job.
        </p>
        <p className={shell.sectionCopy}>
          This is the internal cost-control layer, not the customer-facing estimate surface.
        </p>
      </PageCard>
    </PageShell>
  );
}
