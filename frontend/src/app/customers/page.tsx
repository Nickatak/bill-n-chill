import type { Metadata } from "next";
import { ContactsConsole } from "@/features/contacts";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Customers",
};

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
