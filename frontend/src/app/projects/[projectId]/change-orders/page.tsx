import { ChangeOrdersConsole } from "@/features/change-orders";
import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "../../../change-orders/page.module.css";

type ProjectChangeOrdersPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ origin_estimate?: string }>;
};

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
        <header className={styles.header}>
          <h1>Change Orders</h1>
          <p>Manage revisions for this project and keep scope history traceable.</p>
          <p>
            <Link href={`/projects?project=${projectId}`}>Back to Project Hub</Link> |{" "}
            <Link href={`/invoices?project=${projectId}`}>Next: Invoice from approved scope</Link>
          </p>
        </header>
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
