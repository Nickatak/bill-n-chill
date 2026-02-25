import { FinancialsAuditingConsole } from "@/features/financials-auditing";
import { PaymentsConsole } from "@/features/payments";
import shell from "@/app/wip-shell.module.css";

export default function FinancialsAuditingPage() {
  return (
    <div className={shell.page}>
      <main className={shell.main}>
        <header className={shell.hero}>
          <div className={shell.heroTop}>
            <p className={shell.eyebrow}>Financials</p>
            <h1 className={shell.title}>Financials & Accounting (WIP)</h1>
            <p className={shell.copy}>
              Operations workspace for project-level financial truth, immutable audit events, and
              accounting sync visibility.
            </p>
          </div>
          <div className={shell.heroMetaRow}>
            <span className={shell.metaPill}>AR + AP visibility</span>
            <span className={shell.metaPill}>Audit + sync traceability</span>
            <span className={shell.metaPill}>Accounting export staging</span>
          </div>
        </header>
        <section className={shell.card}>
          <FinancialsAuditingConsole />
        </section>
        <section className={`${shell.card} ${shell.cardMuted}`}>
          <h2 className={shell.sectionTitle}>Payments</h2>
          <p className={shell.sectionCopy}>
            AR receipts and AP disbursements live here as part of the accounting surface for
            allocation, reconciliation, and downstream sync.
          </p>
          <PaymentsConsole />
        </section>
      </main>
    </div>
  );
}
