import styles from "./page.module.css";
import { opsMetaMemoryLog } from "./memory-log";

function Term({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <a href={href} className={styles.termLink}>
      <code>{label}</code>
    </a>
  );
}

export default function OpsMetaNotesPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.card}>
          <h2>Project Meta</h2>
          <p>
            Shared reference for structural sequencing and implementation constraints. This section
            is the v2 behavior contract for how our primary models relate, what each one owns, and
            which rules are hard requirements.
          </p>
          <h3>Behavior Contract (v2)</h3>
          <details className={styles.accordion} open>
            <summary className={styles.accordionSummary}>1) Intake and Conversion Layer</summary>
            <ul className={styles.bulletList}>
              <li>
                <Term href="#term-customer-intake" label="CustomerIntake" /> is pre-project signal
                capture
                only (interest, basic needs, fit).
              </li>
              <li>
                <Term href="#term-customer" label="Customer" /> is the canonical business party once
                qualified.
              </li>
              <li>
                <Term href="#term-project" label="Project" /> is the operational container where all
                executable financial/workflow artifacts live.
              </li>
              <li>
                Conversion is the semantic boundary from potential work to tracked work. Nothing
                fiscal should originate from{" "}
                <Term href="#term-customer-intake" label="CustomerIntake" />.
              </li>
            </ul>
          </details>
          <details className={styles.accordion}>
            <summary className={styles.accordionSummary}>2) Estimating Layer</summary>
            <ul className={styles.bulletList}>
              <li>
                <Term href="#term-estimate" label="Estimate" /> is project-level and supports
                customer-facing scope/price proposal behavior.
              </li>
              <li>
                <Term href="#term-estimate" label="Estimate" /> has two histories: status lifecycle
                (draft/submitted/approved/rejected/voided) and semantic revision lineage (what
                replaced what and why).
              </li>
              <li>
                Approved estimate defines initial commercial intent, not final fiscal truth.
              </li>
            </ul>
          </details>
          <details className={styles.accordion}>
            <summary className={styles.accordionSummary}>3) Budget and Baseline Cost Layer</summary>
            <ul className={styles.bulletList}>
              <li>
                <Term href="#term-budget" label="Budget" /> +{" "}
                <Term href="#term-budget-line" label="BudgetLine" /> is the internal financial
                baseline for delivery.
              </li>
              <li>
                <Term href="#term-budget-line" label="BudgetLine" /> are attribution units for
                labor/material/sub and all AP/spend attribution should land on them.
              </li>
              <li>
                Once estimate intent is accepted, budget becomes execution truth for internal
                tracking.
              </li>
            </ul>
          </details>
          <details className={styles.accordion}>
            <summary className={styles.accordionSummary}>4) Change Order Layer</summary>
            <ul className={styles.bulletList}>
              <li>
                <Term href="#term-change-order" label="ChangeOrder" /> is project-level, not
                estimate-level, and represents contract delta behavior.
              </li>
              <li>
                Every chain starts from <code>origin_estimate</code> (where change intent began).
              </li>
              <li>
                Revisions use <code>supersedes_change_order</code> lineage semantics, and only the
                latest revision in chain should be editable.
              </li>
              <li>
                Approved COs update current contractual/fiscal posture.
              </li>
            </ul>
          </details>
          <details className={styles.accordion}>
            <summary className={styles.accordionSummary}>5) Billing, Spend, and Cash Layers</summary>
            <ul className={styles.bulletList}>
              <li>
                <Term href="#term-invoice" label="Invoice" /> +{" "}
                <Term href="#term-invoice-line" label="InvoiceLine" /> capture AR obligations (what
                the customer owes).
              </li>
              <li>
                <Term href="#term-vendor-bill" label="VendorBill" /> + allocations capture AP
                obligations with budget-line attribution.
              </li>
              <li>
                <Term href="#term-vendor-bill" label="VendorBill" /> in <code>approved</code>,{" "}
                <code>scheduled</code>, or <code>paid</code> status must be fully allocated to
                budget lines.
              </li>
              <li>
                <Term href="#term-expense" label="Expense" /> captures direct spend and should
                remain budget-attributed.
              </li>
              <li>
                <Term href="#term-payment" label="Payment" /> + allocations capture
                settlement/cash application across AR/AP records.
              </li>
            </ul>
          </details>
          <details className={styles.accordion}>
            <summary className={styles.accordionSummary}>6) Audit and Sync Layer</summary>
            <ul className={styles.bulletList}>
              <li>
                <Term href="#term-financial-audit-event" label="FinancialAuditEvent" /> is
                immutable internal event ledger.
              </li>
              <li>
                <Term href="#term-accounting-sync-event" label="AccountingSyncEvent" /> captures
                external accounting synchronization trace and accountability.
              </li>
              <li>
                These are control-plane records, not transactional primitives. They prove what
                happened, when, and what synced externally.
              </li>
            </ul>
          </details>
          <details className={styles.accordion}>
            <summary className={styles.accordionSummary}>Hard Audit / Fiscal Truth Objects</summary>
            <p>
              Minimum object set that must reconcile for financial confidence across estimate,
              delivery, AP, AR, and accounting sync surfaces.
            </p>
            <ol className={styles.orderedList}>
              <li>
                <Term href="#term-budget" label="Budget" /> and{" "}
                <Term href="#term-budget-line" label="BudgetLine" /> (internal approved baseline and
                working budget)
              </li>
              <li>
                <Term href="#term-change-order" label="ChangeOrder" /> (approved scope/value deltas)
              </li>
              <li>
                <Term href="#term-invoice" label="Invoice" /> and{" "}
                <Term href="#term-invoice-line" label="InvoiceLine" /> (AR obligations)
              </li>
              <li>
                <Term href="#term-vendor-bill" label="VendorBill" /> and{" "}
                <Term href="#term-vendor-bill-allocation" label="VendorBillAllocation" /> (AP
                obligations and budget attribution)
              </li>
              <li>
                <Term href="#term-payment" label="Payment" /> and{" "}
                <Term href="#term-payment-allocation" label="PaymentAllocation" /> (cash movement and
                settlement)
              </li>
              <li>
                <Term href="#term-financial-audit-event" label="FinancialAuditEvent" /> (immutable
                lifecycle trail)
              </li>
              <li>
                <Term href="#term-accounting-sync-event" label="AccountingSyncEvent" /> (external
                ledger sync accountability)
              </li>
            </ol>
          </details>
          <details className={styles.accordion}>
            <summary className={styles.accordionSummary}>Current Guardrails</summary>
            <ul className={styles.bulletList}>
              <li>
                Project-scoped routes are the default UX entry points for workflow entities where
                context matters (including change orders).
              </li>
              <li>
                Seed data is expected to include explicit status variation plus an obvious
                child-model playground path for quick QA.
              </li>
              <li>
                Validation messages should reflect actual policy scope (for example, allocation
                requirement language including `scheduled` state).
              </li>
            </ul>
          </details>
          <details className={styles.accordion}>
            <summary className={styles.accordionSummary}>Verbiage / Expansion</summary>
            <div className={styles.definitionList}>
              <article id="term-customer-intake" className={styles.definitionCard}>
                <h4>`CustomerIntake`</h4>
                <p>
                  Pre-conversion intake record used for qualification and initial customer details.
                </p>
              </article>
              <article id="term-customer" className={styles.definitionCard}>
                <h4>`Customer`</h4>
                <p>Canonical customer party record linked to one or more projects.</p>
              </article>
              <article id="term-project" className={styles.definitionCard}>
                <h4>`Project`</h4>
                <p>Primary workflow anchor that owns estimates, budgets, COs, billing, and spend.</p>
              </article>
              <article id="term-estimate" className={styles.definitionCard}>
                <h4>`Estimate`</h4>
                <p>Project-level proposal artifact with lifecycle status and semantic revision lineage.</p>
              </article>
              <article id="term-budget" className={styles.definitionCard}>
                <h4>`Budget`</h4>
                <p>Internal baseline/working cost container derived from approved estimate intent.</p>
              </article>
              <article id="term-budget-line" className={styles.definitionCard}>
                <h4>`BudgetLine`</h4>
                <p>Granular cost bucket used for AP and spend attribution.</p>
              </article>
              <article id="term-change-order" className={styles.definitionCard}>
                <h4>`ChangeOrder`</h4>
                <p>
                  Project-level contract delta with origin-estimate linkage and revision chain
                  semantics.
                </p>
              </article>
              <article id="term-invoice" className={styles.definitionCard}>
                <h4>`Invoice`</h4>
                <p>Accounts receivable obligation issued to the customer.</p>
              </article>
              <article id="term-invoice-line" className={styles.definitionCard}>
                <h4>`InvoiceLine`</h4>
                <p>Line-level AR charge detail within an invoice.</p>
              </article>
              <article id="term-vendor-bill" className={styles.definitionCard}>
                <h4>`VendorBill`</h4>
                <p>Accounts payable commitment/actual owed to a vendor.</p>
              </article>
              <article id="term-vendor-bill-allocation" className={styles.definitionCard}>
                <h4>`VendorBillAllocation`</h4>
                <p>Budget-line attribution record for AP obligations and actuals.</p>
              </article>
              <article id="term-expense" className={styles.definitionCard}>
                <h4>`Expense`</h4>
                <p>Direct spend record that should remain attributable to project budget lines.</p>
              </article>
              <article id="term-payment" className={styles.definitionCard}>
                <h4>`Payment`</h4>
                <p>Cash movement record for AR/AP settlement.</p>
              </article>
              <article id="term-payment-allocation" className={styles.definitionCard}>
                <h4>`PaymentAllocation`</h4>
                <p>Allocation of payment amount across invoices, vendor bills, or applicable targets.</p>
              </article>
              <article id="term-financial-audit-event" className={styles.definitionCard}>
                <h4>`FinancialAuditEvent`</h4>
                <p>Immutable internal event trail for finance lifecycle transitions and controls.</p>
              </article>
              <article id="term-accounting-sync-event" className={styles.definitionCard}>
                <h4>`AccountingSyncEvent`</h4>
                <p>External ledger synchronization event with status and accountability metadata.</p>
              </article>
            </div>
          </details>
        </section>
        <section className={styles.card}>
          <h2>Memory Timeline</h2>
          <p>Entries are recorded as we discuss and make implementation calls.</p>
          <div className={styles.timeline}>
            {opsMetaMemoryLog.map((entry) => (
              <article key={entry.id} className={styles.entry}>
                <header className={styles.entryHeader}>
                  <h3>{entry.title}</h3>
                  <span className={styles.badge}>{entry.type}</span>
                </header>
                <p className={styles.date}>{entry.date}</p>
                <ul className={styles.notes}>
                  {entry.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
