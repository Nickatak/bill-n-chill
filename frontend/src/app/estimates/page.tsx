import { EstimatesConsole } from "@/features/estimates";
import { redirect } from "next/navigation";
import styles from "./page.module.css";

type EstimatesPageProps = {
  searchParams: Promise<{ project?: string }>;
};

export default async function EstimatesPage({ searchParams }: EstimatesPageProps) {
  const { project } = await searchParams;
  if (!project || !/^\d+$/.test(project)) {
    redirect("/estimates-placeholder");
  }

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
        </header>
        <section className={styles.card}>
          <EstimatesConsole />
        </section>
        <section className={styles.card}>
          <h2>Workflow Context</h2>
          <p>
            Estimates are client-facing scope and pricing records. Each estimate stays project-scoped
            so revisions, approvals, and downstream conversion stay tied to one job.
          </p>
          <p>
            Approved estimates become the baseline input for internal budget truth.
          </p>
        </section>
      </main>
    </div>
  );
}
