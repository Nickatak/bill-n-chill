import type { Metadata } from "next";
import { EstimatesConsole } from "@/features/estimates";
import { redirect } from "next/navigation";
import styles from "./page.module.css";
import { isNumericRouteId, resolveProjectParamTitle } from "@/app/route-metadata";

type ProjectEstimatesPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ estimate?: string }>;
};

export async function generateMetadata({ params }: ProjectEstimatesPageProps): Promise<Metadata> {
  const { projectId } = await params;
  return { title: resolveProjectParamTitle(projectId, "Estimates", "Project Estimates") };
}

export default async function ProjectEstimatesPage({
  params,
  searchParams,
}: ProjectEstimatesPageProps) {
  const { projectId } = await params;
  const { estimate } = await searchParams;
  if (!isNumericRouteId(projectId)) {
    redirect("/projects");
  }

  const estimateKey = isNumericRouteId(estimate) ? estimate : "all";

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
