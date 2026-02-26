import type { Metadata } from "next";
import { VendorsConsole } from "@/features/vendors";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Vendors",
};

export default function VendorsPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.card}>
          <VendorsConsole />
        </section>
      </main>
    </div>
  );
}
