import { EstimateApprovalPreview } from "@/features/estimates/components/estimate-approval-preview";
import { notFound } from "next/navigation";
import styles from "./page.module.css";

type EstimateReviewPageProps = {
  params: Promise<{ publicRef: string }>;
};

function parsePublicToken(publicRef: string): string | null {
  const match = publicRef.match(/--([A-Za-z0-9]{8,24})$/);
  return match ? match[1] : null;
}

export default async function EstimateReviewPage({ params }: EstimateReviewPageProps) {
  const { publicRef } = await params;
  const publicToken = parsePublicToken(publicRef);
  if (!publicToken) {
    notFound();
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Estimate Review (WIP)</h1>
          <p>Customer-facing preview while approval/denial UX and language are being finalized.</p>
        </header>
        <section className={styles.card}>
          <EstimateApprovalPreview publicToken={publicToken} />
        </section>
      </main>
    </div>
  );
}
