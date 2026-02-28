import type { Metadata } from "next";
import { ChangeOrdersConsole } from "@/features/change-orders";
import { redirect } from "next/navigation";
import styles from "../../../change-orders/page.module.css";
import { isNumericRouteId, resolveProjectParamTitle } from "@/app/route-metadata";

type ProjectChangeOrdersPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ origin_estimate?: string }>;
};

export async function generateMetadata({ params }: ProjectChangeOrdersPageProps): Promise<Metadata> {
  const { projectId } = await params;
  return { title: resolveProjectParamTitle(projectId, "Change Orders", "Project Change Orders") };
}

export default async function ProjectChangeOrdersPage({
  params,
  searchParams,
}: ProjectChangeOrdersPageProps) {
  const { projectId } = await params;
  const { origin_estimate: originEstimate } = await searchParams;
  if (!isNumericRouteId(projectId)) {
    redirect("/projects");
  }
  const initialOriginEstimateId =
    isNumericRouteId(originEstimate) ? Number(originEstimate) : null;

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.card}>
          <ChangeOrdersConsole
            scopedProjectId={Number(projectId)}
            initialOriginEstimateId={initialOriginEstimateId}
          />
        </section>
      </main>
    </div>
  );
}
