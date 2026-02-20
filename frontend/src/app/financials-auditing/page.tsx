import { FinancialsAuditingConsole } from "@/features/financials-auditing";
import styles from "../vendors/page.module.css";

export default function FinancialsAuditingPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Financials & Auditing</h1>
          <p>
            This non-workflow route centralizes finance controls: summary extraction, immutable
            audit visibility, and accounting sync event operations.
          </p>
          <p>
            It is intentionally operations-focused and acts as the staging area for exports and
            downstream accounting integrations.
          </p>
        </header>
        <section className={styles.card}>
          <h2>Temporary Working Notes (Remove Later)</h2>
          <p>
            Internal planning notes to align workflow sequencing and audit boundaries while we
            finish operator-facing flows.
          </p>

          <h3>Operational Workflow Object Order</h3>
          <ol>
            <li>`LeadContact` (intake/qualification)</li>
            <li>`Customer` + `Project` (conversion to active job shell)</li>
            <li>`Estimate` (+ `EstimateLineItem`, `EstimateStatusEvent`)</li>
            <li>`Budget` (+ `BudgetLine`) auto-created from approved estimate</li>
            <li>`ChangeOrder` (approved deltas update project contract current)</li>
            <li>`Invoice` (+ `InvoiceLine`) for AR billing</li>
            <li>`VendorBill` (+ `VendorBillAllocation`) for AP commitments/actuals</li>
            <li>`Payment` (+ `PaymentAllocation`) for AR/AP cash application</li>
            <li>`AccountingSyncEvent` for external accounting sync lifecycle</li>
          </ol>

          <h3>Hard Audit / Fiscal Truth Objects</h3>
          <ol>
            <li>`Budget` and `BudgetLine` (internal approved baseline and working budget)</li>
            <li>`ChangeOrder` (approved scope/value deltas)</li>
            <li>`Invoice` and `InvoiceLine` (AR obligations)</li>
            <li>`VendorBill` and `VendorBillAllocation` (AP obligations and budget attribution)</li>
            <li>`Payment` and `PaymentAllocation` (cash movement and settlement)</li>
            <li>`FinancialAuditEvent` (immutable lifecycle trail)</li>
            <li>`AccountingSyncEvent` (external ledger sync accountability)</li>
          </ol>
        </section>
        <section className={styles.card}>
          <FinancialsAuditingConsole />
        </section>
      </main>
    </div>
  );
}
