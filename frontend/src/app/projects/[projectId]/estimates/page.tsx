import { EstimatesConsole } from "@/features/estimates";
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

  const estimateKey = estimate && /^\d+$/.test(estimate) ? estimate : "all";

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.card}>
          <EstimatesConsole scopedProjectId={Number(projectId)} key={`${projectId}-${estimateKey}`} />
        </section>
      </main>
    </div>
  );
}
