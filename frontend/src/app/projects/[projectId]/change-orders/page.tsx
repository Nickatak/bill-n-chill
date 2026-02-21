import { ChangeOrdersConsole } from "@/features/change-orders";
import { redirect } from "next/navigation";
import styles from "../../../change-orders/page.module.css";

type ProjectChangeOrdersPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectChangeOrdersPage({ params }: ProjectChangeOrdersPageProps) {
  const { projectId } = await params;
  if (!/^\d+$/.test(projectId)) {
    redirect("/change-orders");
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Change Orders</h1>
          <p>
            Project-scoped change governance with revision history and estimate-origin traceability.
          </p>
          <p>
            Approved deltas update contract current and budget aggregates; revisions preserve family
            history without losing origin context.
          </p>
        </header>
        <section className={styles.card}>
          <ChangeOrdersConsole scopedProjectId={Number(projectId)} />
        </section>
      </main>
    </div>
  );
}
