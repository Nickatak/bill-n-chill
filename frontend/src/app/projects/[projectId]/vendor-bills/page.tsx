import { VendorBillsConsole } from "@/features/vendor-bills";
import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "../../../vendor-bills/page.module.css";

type ProjectVendorBillsPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectVendorBillsPage({ params }: ProjectVendorBillsPageProps) {
  const { projectId } = await params;
  if (!/^\d+$/.test(projectId)) {
    redirect("/projects");
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Vendor Bills</h1>
          <p>
            Budget impact rule of thumb: <strong>planned/received/approved/scheduled</strong> bills
            represent <strong>committed</strong> cost, while <strong>paid</strong> bills represent{" "}
            <strong>actual</strong> cost.
          </p>
          <p>
            Allocation linkage tracks which budget lines each bill amount is applied to. Approved
            and paid bills require full allocation.
          </p>
          <p>
            Vendor Bills are intentionally modeled as a B2B contract/AP workflow. For quick field
            receipt intake, use the project-scoped <strong>Expenses</strong> flow.
          </p>
          <p>
            <Link href={`/projects?project=${projectId}`}>Back to Project Hub</Link> |{" "}
            <Link href={`/financials-auditing?project=${projectId}`}>
              Next: Financials & Accounting (Payments)
            </Link>
          </p>
        </header>
        <section className={styles.card}>
          <VendorBillsConsole scopedProjectId={Number(projectId)} />
        </section>
        <section className={styles.card}>
          <h2>Workflow Context</h2>
          <p>
            Vendor Bills are project-scoped AP records that track payables, budget allocation, and
            cost realization states from planned through paid.
          </p>
          <p>
            Use this route for contract/vendor obligations; use Expenses for quick field purchase
            intake.
          </p>
        </section>
      </main>
    </div>
  );
}
