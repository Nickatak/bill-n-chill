import { redirect } from "next/navigation";
import styles from "./page.module.css";

type ExpensesPageProps = {
  searchParams: Promise<{ project?: string }>;
};

export default async function ExpensesPage({ searchParams }: ExpensesPageProps) {
  const { project } = await searchParams;
  if (!project || !/^\d+$/.test(project)) {
    redirect("/expenses-placeholder");
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
        </header>
        <section className={styles.card}>
          <h2>Expense Entry</h2>
          <p>Expense quick-add workflow is now scaffolded and ready for implementation.</p>
          <p>
            Next step will add lightweight receipt intake with budget-line splits, optimized for
            same-day field purchases, with room to layer in receipt scanning later.
          </p>
        </section>
      </main>
    </div>
  );
}
