import { redirect } from "next/navigation";
import Link from "next/link";
import shell from "@/app/wip-shell.module.css";

type ProjectExpensesPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectExpensesPage({ params }: ProjectExpensesPageProps) {
  const { projectId } = await params;
  if (!/^\d+$/.test(projectId)) {
    redirect("/projects");
  }

  return (
    <div className={shell.page}>
      <main className={`${shell.main} ${shell.mainNarrow}`}>
        <header className={shell.hero}>
          <div className={shell.heroTop}>
            <p className={shell.eyebrow}>Projects</p>
            <h1 className={shell.title}>Expenses (WIP)</h1>
            <p className={shell.copy}>
              Project-scoped quick-capture spend for field purchases and receipts that still need
              budget attribution.
            </p>
          </div>
          <div className={shell.linkRow}>
            <Link className={shell.linkButton} href={`/projects?project=${projectId}`}>
              Back to Project Hub
            </Link>
            <Link className={shell.linkButton} href={`/projects/${projectId}/vendor-bills`}>
              Next: Vendor Bills
            </Link>
          </div>
        </header>
        <section className={shell.card}>
          <h2 className={shell.sectionTitle}>Expense Entry</h2>
          <p className={shell.sectionCopy}>
            Expense quick-add workflow is scaffolded and ready for implementation.
          </p>
          <p className={shell.sectionCopy}>
            Next step will add lightweight receipt intake with budget-line splits, optimized for
            same-day field purchases, with room to layer in receipt scanning later.
          </p>
        </section>
        <section className={`${shell.card} ${shell.cardMuted}`}>
          <h2 className={shell.sectionTitle}>Workflow Context</h2>
          <p className={shell.sectionCopy}>
            Expenses are project-scoped quick-capture spend records for field/retail purchases
            that still require budget attribution and downstream AP traceability.
          </p>
          <p className={shell.sectionCopy}>
            This route complements Vendor Bills by covering ad hoc spend rather than formal vendor
            contract billing.
          </p>
        </section>
      </main>
    </div>
  );
}
