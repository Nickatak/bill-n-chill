import { ContactsConsole } from "@/features/contacts";
import styles from "../vendors/page.module.css";

export default function ContactsPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Contacts: View + Edit</h1>
          <p>
            This non-workflow route gives operations users a dedicated place to inspect and
            correct captured contact records.
          </p>
          <p>
            It supports debugging and data hygiene by letting you search and patch lead fields
            without running through the full intake flow again.
          </p>
        </header>
        <section className={styles.card}>
          <ContactsConsole />
        </section>
      </main>
    </div>
  );
}
