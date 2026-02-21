import { EstimatesConsole } from "@/features/estimates";
import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "../../../estimates/page.module.css";

type ProjectEstimatesPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ estimate?: string }>;
};

export default async function ProjectEstimatesPage({
  params,
  searchParams,
}: ProjectEstimatesPageProps) {
  const { projectId } = await params;
  const { estimate } = await searchParams;
  if (!/^\d+$/.test(projectId)) {
    redirect("/projects");
  }

  const estimateQuery = estimate && /^\d+$/.test(estimate) ? `?estimate=${estimate}` : "";

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Estimates</h1>
          <p>
            This route gives users the client-facing pricing lifecycle: author scope lines, revise
            versions, and move statuses through approval decisions.
          </p>
          <p>
            Approved estimates become budget baselines, so accuracy here protects downstream
            planning and billing.
          </p>
          <p>
            <Link href={`/projects/${projectId}/budgets/analytics`} prefetch={false}>
              Open Budget Analytics
            </Link>
          </p>
        </header>
        <section className={styles.card}>
          <EstimatesConsole scopedProjectId={Number(projectId)} key={`${projectId}-${estimateQuery}`} />
        </section>
        <section className={styles.card}>
          <h2>Workflow Context</h2>
          <p>
            Estimates are client-facing scope and pricing records. Each estimate stays project-scoped
            so revisions, approvals, and downstream conversion stay tied to one job.
          </p>
          <p>Approved estimates become the baseline input for internal budget truth.</p>
        </section>
      </main>
    </div>
  );
}
