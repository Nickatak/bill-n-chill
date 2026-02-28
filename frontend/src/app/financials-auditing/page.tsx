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
          <p className={shell.eyebrow}>Financials</p>
          <h1 className={shell.title}>Financials & Accounting</h1>
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
      <PageCard>
        <FinancialsAuditingConsole />
      </PageCard>
      <PageCard muted>
        <h2 className={shell.sectionTitle}>Payments</h2>
        <p className={shell.sectionCopy}>
          AR receipts and AP disbursements live here as part of the accounting surface for
          allocation, reconciliation, and downstream sync.
        </p>
        <PaymentsConsole />
      </PageCard>
    </PageShell>
  );
}
