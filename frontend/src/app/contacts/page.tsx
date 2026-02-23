import { ContactsConsole } from "@/features/contacts";
import styles from "./page.module.css";

export default function ContactsPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Customers Workspace</h1>
          <p>
            This route is the dedicated operations surface for customer data quality.
          </p>
          <p>
            Search and update canonical customer/contact records without rerunning the full intake
            workflow.
          </p>
        </header>
        <section className={styles.card}>
          <ContactsConsole />
        </section>
      </main>
    </div>
  );
}
