import { VendorBillsConsole } from "@/features/vendor-bills";
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
          <VendorBillsConsole />
        </section>
      </main>
    </div>
  );
}
