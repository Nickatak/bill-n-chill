import type { Metadata } from "next";
import { FinancialsAuditingConsole } from "@/features/financials-auditing";
import { PaymentsConsole } from "@/features/payments";
import shell from "@/shared/shell/page-shell.module.css";
import { PageCard, PageShell } from "@/shared/shell";

export const metadata: Metadata = {
  title: "Financials and Accounting",
};

export default function FinancialsAuditingPage() {
  return (
    <PageShell>
      <header className={shell.hero}>
        <div className={shell.heroTop}>
          <p className={shell.eyebrow}>Accounting</p>
          <h1 className={shell.title}>Financials & Accounting</h1>
          <p className={shell.copy}>
            Payments, audit trail exports, and accounting sync management.
          </p>
        </div>
        <div className={shell.heroMetaRow}>
          <span className={shell.metaPill}>Payments</span>
          <span className={shell.metaPill}>Audit export</span>
          <span className={shell.metaPill}>Accounting sync</span>
        </div>
      </header>
      <PageCard>
        <h2 className={shell.sectionTitle}>Payments</h2>
        <p className={shell.sectionCopy}>
          AR receipts and AP disbursements — record payments and allocate to invoices or vendor bills.
        </p>
        <PaymentsConsole />
      </PageCard>
      <PageCard muted>
        <FinancialsAuditingConsole />
      </PageCard>
    </PageShell>
  );
}
