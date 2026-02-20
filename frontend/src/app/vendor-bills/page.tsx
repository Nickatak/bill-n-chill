import { VendorBillsConsole } from "@/features/vendor-bills";
import { redirect } from "next/navigation";
import styles from "./page.module.css";

type VendorBillsPageProps = {
  searchParams: Promise<{ project?: string }>;
};

export default async function VendorBillsPage({ searchParams }: VendorBillsPageProps) {
  const { project } = await searchParams;
  if (!project || !/^\d+$/.test(project)) {
    redirect("/vendor-bills-placeholder");
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
        </header>
        <section className={styles.card}>
          <VendorBillsConsole />
        </section>
      </main>
    </div>
  );
}
