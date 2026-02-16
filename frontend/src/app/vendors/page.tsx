import { VendorsConsole } from "@/features/vendors";
import styles from "./page.module.css";

export default function VendorsPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Vendors</h1>
          <p>
            This route gives users a canonical vendor directory with duplicate safeguards so AP
            records are attached to stable payee entities.
          </p>
          <p>
            Vendor records are prerequisites for vendor-bill intake and outbound payment
            allocation, so quality here prevents downstream AP fragmentation.
          </p>
        </header>
        <section className={styles.card}>
          <VendorsConsole />
        </section>
      </main>
    </div>
  );
}
