import type { Metadata } from "next";
import { CostCodesConsole } from "@/features/cost-codes";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Cost Codes",
};

export default function CostCodesPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.card}>
          <CostCodesConsole />
        </section>
      </main>
    </div>
  );
}
