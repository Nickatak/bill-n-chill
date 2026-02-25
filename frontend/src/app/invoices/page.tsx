import { InvoicesConsole } from "@/features/invoices";
import shell from "@/app/wip-shell.module.css";

export default function InvoicesPage() {
  return (
    <div className={shell.page}>
      <main className={shell.main}>
        <header className={shell.hero}>
          <div className={shell.heroTop}>
            <p className={shell.eyebrow}>Billing</p>
            <h1 className={shell.title}>Invoice Workspace (WIP)</h1>
            <p className={shell.copy}>
              Project-scoped invoice drafting, status movement, and AR collection visibility.
            </p>
          </div>
        </header>
        <section className={shell.card}>
          <InvoicesConsole />
        </section>
      </main>
    </div>
  );
}
