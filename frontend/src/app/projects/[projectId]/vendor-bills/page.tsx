import { VendorBillsConsole } from "@/features/vendor-bills";
import Link from "next/link";
import { redirect } from "next/navigation";
import shell from "@/app/wip-shell.module.css";

type ProjectVendorBillsPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectVendorBillsPage({ params }: ProjectVendorBillsPageProps) {
  const { projectId } = await params;
  if (!/^\d+$/.test(projectId)) {
    redirect("/projects");
  }

  return (
    <div className={shell.page}>
      <main className={shell.main}>
        <header className={shell.hero}>
          <div className={shell.heroTop}>
            <p className={shell.eyebrow}>Projects / Billing</p>
            <h1 className={shell.title}>Vendor Bills (WIP)</h1>
            <p className={shell.copy}>
              Budget impact rule of thumb: <strong>planned/received/approved/scheduled</strong>{" "}
              bills represent <strong>committed</strong> cost, while <strong>paid</strong> bills
              represent <strong>actual</strong> cost.
            </p>
            <p className={shell.copy}>
              Allocation linkage tracks which budget lines each bill amount is applied to.
              Approved and paid bills require full allocation.
            </p>
          </div>
          <div className={shell.linkRow}>
            <Link className={shell.linkButton} href={`/projects?project=${projectId}`}>
              Back to Project Hub
            </Link>
            <Link
              className={shell.linkButton}
              href={`/financials-auditing?project=${projectId}`}
            >
              Next: Financials & Accounting
            </Link>
          </div>
        </header>
        <section className={shell.card}>
          <VendorBillsConsole scopedProjectId={Number(projectId)} />
        </section>
        <section className={`${shell.card} ${shell.cardMuted}`}>
          <h2 className={shell.sectionTitle}>Workflow Context</h2>
          <p className={shell.sectionCopy}>
            Vendor Bills are project-scoped AP records that track payables, budget allocation, and
            cost realization states from planned through paid.
          </p>
          <p className={shell.sectionCopy}>
            Use this route for contract/vendor obligations. For quick field purchases, use
            Expenses.
          </p>
        </section>
      </main>
    </div>
  );
}
