import { InvoicesConsole } from "@/features/invoices";
import shell from "@/app/wip-shell.module.css";

export default function InvoicesPage() {
  return (
    <div className={shell.page}>
      <main className={shell.main}>
        <section className={shell.card}>
          <InvoicesConsole />
        </section>
      </main>
    </div>
  );
}
