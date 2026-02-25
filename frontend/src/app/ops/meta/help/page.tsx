import Link from "next/link";
import shell from "@/app/wip-shell.module.css";
import styles from "./page.module.css";

const quickStartSteps = [
  {
    title: "Set your project baseline first",
    body: "Create or pick a project, approve an estimate, then convert it to budget so downstream billing and CO flows have valid scope.",
    href: "/projects",
    hrefLabel: "Open Projects",
  },
  {
    title: "Run scope changes through Change Orders",
    body: "Use Change Orders for contract deltas after baseline. Move through pending approval before approved so totals propagate correctly.",
    href: "/change-orders",
    hrefLabel: "Open Change Orders",
  },
  {
    title: "Execute billing in sequence",
    body: "Draft invoices from approved scope, send only when ready, then record payments and allocations so AR/AP balances reconcile.",
    href: "/invoices",
    hrefLabel: "Open Billing",
  },
  {
    title: "Keep master lists clean",
    body: "Maintain customers, cost codes, and vendors as canonical records to reduce duplicate cleanup and reporting friction later.",
    href: "/customers",
    hrefLabel: "Open Ops / Meta",
  },
];

const faqs = [
  {
    question: "How quickly should I expect value from bill-n-chill?",
    answer:
      "Most teams can reach first useful outcome in the first session: one project selected, one estimate approved, and one invoice drafted from approved scope.",
  },
  {
    question: "What is the safest order for day-to-day work?",
    answer:
      "Projects and scope first (estimates/change orders), billing second (invoices/vendor bills), then payments and accounting checks.",
  },
  {
    question: "Why are some pages marked WIP?",
    answer:
      "WIP routes are usable for core flow validation but still being refined for speed, copy clarity, and workflow ergonomics.",
  },
  {
    question: "Can viewers change financial data?",
    answer:
      "No. Viewer role is intended to remain read-only for mutating financial and dictionary endpoints.",
  },
  {
    question: "Where should I report friction or confusing behavior?",
    answer:
      "Capture the route, project id (if applicable), action attempted, and exact error text. That gives fastest turnaround for fixes.",
  },
];

export default function OpsMetaHelpPage() {
  return (
    <div className={shell.page}>
      <main className={`${shell.main} ${shell.mainNarrow}`}>
        <header className={shell.hero}>
          <div className={shell.heroTop}>
            <p className={shell.eyebrow}>Ops / Meta</p>
            <h1 className={shell.title}>Help (WIP)</h1>
            <p className={shell.copy}>
              Fast-start guide and FAQ for operators. The goal is immediate day-one value: fewer
              workflow missteps, faster billing throughput, and clearer next actions.
            </p>
          </div>
          <div className={shell.heroMetaRow}>
            <span className={shell.metaPill}>5-10 minute onboarding</span>
            <span className={shell.metaPill}>Workflow-first guidance</span>
            <span className={shell.metaPill}>FAQ for common blockers</span>
          </div>
        </header>

        <section className={shell.card}>
          <h2 className={shell.sectionTitle}>Get Immediate Value</h2>
          <p className={shell.sectionCopy}>
            Start with this sequence to avoid rework and to make totals reconcile cleanly.
          </p>
          <ol className={styles.stepList}>
            {quickStartSteps.map((step) => (
              <li key={step.title} className={styles.stepItem}>
                <h3 className={styles.stepTitle}>{step.title}</h3>
                <p className={styles.stepBody}>{step.body}</p>
                <Link href={step.href} className={shell.linkButton}>
                  {step.hrefLabel}
                </Link>
              </li>
            ))}
          </ol>
        </section>

        <section className={`${shell.card} ${shell.cardMuted}`}>
          <h2 className={shell.sectionTitle}>Role-Based Starting Points</h2>
          <div className={styles.roleGrid}>
            <article className={styles.roleCard}>
              <h3>Owner / PM</h3>
              <p>Prioritize scope control, approval decisions, and contract-impacting changes.</p>
            </article>
            <article className={styles.roleCard}>
              <h3>Bookkeeping</h3>
              <p>Focus on invoice status, vendor bills, payment allocation, and reconciliation.</p>
            </article>
            <article className={styles.roleCard}>
              <h3>Viewer</h3>
              <p>Use project and financial views for visibility; expect read-only behavior.</p>
            </article>
          </div>
        </section>

        <section className={shell.card}>
          <h2 className={shell.sectionTitle}>FAQ</h2>
          <div className={styles.faqList}>
            {faqs.map((faq) => (
              <details key={faq.question} className={styles.faqItem}>
                <summary>{faq.question}</summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
