import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "./page.module.css";

type PageProps = {
  searchParams: Promise<{
    project?: string;
    estimate?: string;
  }>;
};

export default async function EstimatePostCreatePage({ searchParams }: PageProps) {
  const { project, estimate } = await searchParams;
  if (!project || !estimate || !/^\d+$/.test(project) || !/^\d+$/.test(estimate)) {
    redirect("/projects");
  }

  const projectId = Number(project);
  const estimateId = Number(estimate);
  const projectEstimateHref = `/projects/${projectId}/estimates?estimate=${estimateId}`;
  const changeOrdersHref = `/projects/${projectId}/change-orders?origin_estimate=${estimateId}`;
  const budgetAnalyticsHref = `/projects/${projectId}/budgets/analytics`;
  const invoicesHref = `/projects/${projectId}/invoices`;
  const projectHomeHref = `/projects/${projectId}`;

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Post-Estimate Workflow</h1>
          <p>Estimate #{estimateId} in Project #{projectId} is now in handoff mode.</p>
        </header>

        <section className={styles.grid}>
          <article className={styles.card}>
            <h2>1. Validate Estimate Lifecycle</h2>
            <p>
              Confirm estimate status and revision history before moving to contract-change work.
            </p>
            <Link href={projectEstimateHref} className={styles.linkButton}>
              Open Project Estimates
            </Link>
          </article>

          <article className={styles.card}>
            <h2>2. Start Change Order From This Estimate</h2>
            <p>
              Launch project-scoped CO flow with this estimate preselected as the origin reference.
            </p>
            <Link href={changeOrdersHref} className={styles.linkButton}>
              Open Change Orders
            </Link>
          </article>

          <article className={styles.card}>
            <h2>3. Review Budget Impact</h2>
            <p>
              Inspect planned vs actual budget impact after estimate approval and ongoing scope deltas.
            </p>
            <Link href={budgetAnalyticsHref} className={styles.linkButton}>
              Open Budget Analytics
            </Link>
          </article>

          <article className={styles.card}>
            <h2>4. Continue Billing Workflow</h2>
            <p>After scope is validated, move into invoice operations for project cash flow.</p>
            <Link href={invoicesHref} className={styles.linkButton}>
              Open Invoices
            </Link>
          </article>
        </section>

        <footer className={styles.footerActions}>
          <Link href={projectHomeHref} className={styles.ghostButton}>
            Back to Project Home
          </Link>
          <Link href="/projects" className={styles.ghostButton}>
            Back to Projects Index
          </Link>
        </footer>
      </main>
    </div>
  );
}
