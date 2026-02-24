import { ContactsConsole } from "@/features/contacts";
import styles from "./page.module.css";

export default function CustomersPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.card}>
          <ContactsConsole />
        </section>
      </main>
    </div>
  );
}
