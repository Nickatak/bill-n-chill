import type { Metadata } from "next";
import { ChangeOrdersConsole } from "@/features/change-orders";
import { redirect } from "next/navigation";
import styles from "../../../change-orders/page.module.css";

type ProjectChangeOrdersPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ origin_estimate?: string }>;
};

export async function generateMetadata({ params }: ProjectChangeOrdersPageProps): Promise<Metadata> {
  const { projectId } = await params;
  if (/^\d+$/.test(projectId)) {
    return { title: `Project #${projectId} Change Orders` };
  }
  return { title: "Project Change Orders" };
}

export default async function ProjectChangeOrdersPage({
  params,
  searchParams,
}: ProjectChangeOrdersPageProps) {
  const { projectId } = await params;
  const { origin_estimate: originEstimate } = await searchParams;
  if (!/^\d+$/.test(projectId)) {
    redirect("/change-orders");
  }
  const initialOriginEstimateId =
    originEstimate && /^\d+$/.test(originEstimate) ? Number(originEstimate) : null;

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
