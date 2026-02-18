import Link from "next/link";
import styles from "./page.module.css";

type PageProps = {
  searchParams?: {
    estimate?: string;
  };
};

export default function EstimatePostCreatePage({ searchParams }: PageProps) {
  const estimateId = searchParams?.estimate ?? "";

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Estimate Created</h1>
          <p>
            {estimateId
              ? `Estimate #${estimateId} is ready. We'll build out the full post-estimate workflow next.`
              : "Estimate is ready. We'll build out the full post-estimate workflow next."}
          </p>
        </header>
        <section className={styles.card}>
          <h2>Next Steps (Placeholder)</h2>
          <p>Planned: send to customer, download PDF, collect approvals, and convert to budget.</p>
          <div className={styles.actions}>
            <Link href="/projects" className={styles.linkButton}>
              Back to Projects
            </Link>
            <Link href="/projects" className={styles.ghostButton}>
              Go to Projects
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
