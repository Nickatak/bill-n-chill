import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import shell from "@/app/wip-shell.module.css";

type ProjectExpensesPageProps = {
  params: Promise<{ projectId: string }>;
};

export async function generateMetadata({ params }: ProjectExpensesPageProps): Promise<Metadata> {
  const { projectId } = await params;
  if (/^\d+$/.test(projectId)) {
    return { title: `Project #${projectId} Expenses` };
  }
  return { title: "Project Expenses" };
}

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
            <Link className={shell.linkButton} href={`/bills?project=${projectId}`}>
              Next: Bills
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
            This route complements Bills by covering ad hoc spend rather than formal vendor
            contract billing.
          </p>
        </section>
      </main>
    </div>
  );
}
