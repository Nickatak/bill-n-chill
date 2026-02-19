import { VendorBillsConsole } from "@/features/vendor-bills";
import { VendorsConsole } from "@/features/vendors";
import styles from "./page.module.css";

export default function VendorBillsPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Vendor Bills</h1>
          <p>
            This route gives users AP liability capture tied to project + vendor with lifecycle
            controls from draft through paid.
          </p>
          <p>
            It works with Vendors as the source of payee identity and with outbound Payments as
            the settlement mechanism that clears AP balances in financial summaries.
          </p>
        </header>
        <section className={styles.card}>
          <h2>Vendors</h2>
          <p>
            Maintain your vendor directory here first so AP entries tie to canonical payees with
            duplicate safeguards.
          </p>
          <VendorsConsole />
        </section>
        <section className={styles.card}>
          <h2>Vendor Bills</h2>
          <p>
            Capture expense transactions and lifecycle status so AP liabilities can be settled and
            reported accurately.
          </p>
          <VendorBillsConsole />
        </section>
      </main>
    </div>
  );
}
