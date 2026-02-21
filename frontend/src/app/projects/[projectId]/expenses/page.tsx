import { redirect } from "next/navigation";
import Link from "next/link";
import styles from "../../../expenses/page.module.css";

type ProjectExpensesPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectExpensesPage({ params }: ProjectExpensesPageProps) {
  const { projectId } = await params;
  if (!/^\d+$/.test(projectId)) {
    redirect("/projects");
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Expenses</h1>
          <p>
            Quick-add intake version of Vendor Bills for field purchases, retail receipts, and
            other on-the-fly spend that still needs budget-line attribution.
          </p>
          <p>
            This route is project-scoped by design so expense intake maps directly to one job’s
            budget and reporting context.
          </p>
          <p>
            <Link href={`/projects?project=${projectId}`}>Back to Project Hub</Link> |{" "}
            <Link href={`/projects/${projectId}/vendor-bills`}>Next: Vendor Bills</Link>
          </p>
        </header>
        <section className={styles.card}>
          <h2>Expense Entry</h2>
          <p>Expense quick-add workflow is now scaffolded and ready for implementation.</p>
          <p>
            Next step will add lightweight receipt intake with budget-line splits, optimized for
            same-day field purchases, with room to layer in receipt scanning later.
          </p>
        </section>
        <section className={styles.card}>
          <h2>Workflow Context</h2>
          <p>
            Expenses are project-scoped quick-capture spend records for field/retail purchases
            that still require budget attribution and downstream AP traceability.
          </p>
          <p>
            This route complements Vendor Bills by covering ad hoc spend rather than formal vendor
            contract billing.
          </p>
        </section>
      </main>
    </div>
  );
}
