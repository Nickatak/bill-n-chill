import type { Metadata } from "next";
import Link from "next/link";
import shell from "@/app/wip-shell.module.css";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Help",
};

const jobWalkthroughs = [
  {
    title: "Job 1: Bathroom Remodel (Fixed Bid)",
    profile:
      "I am a small residential GC. Contract is mostly fixed scope, one customer, one jobsite, and I expect a small change order midway.",
    whatIActuallyDid: [
      "Created customer and project first so all downstream documents stayed project-scoped.",
      "Built estimate from scope lines, sent it, then marked approved to lock contract baseline.",
      "Created one change order for tile upgrade and moved it through sent -> approved.",
      "Drafted invoice lines tied to estimate/budget scope, then sent and collected payment.",
    ],
    workedWell: [
      "Document flow stayed coherent across estimate -> CO -> invoice.",
      "Status controls prevented most bad transitions once documents became terminal.",
      "Totals and deltas were visible enough to confirm contract movement quickly.",
    ],
    edgeCases: [
      "No explicit retainage flow (common in residential draws).",
      "No customer-facing acceptance artifact for CO outside status updates.",
      "Limited handling for tax-on-some-lines but not others.",
    ],
    links: [
      { href: "/projects", label: "Projects" },
      { href: "/change-orders", label: "Change Orders" },
      { href: "/invoices", label: "Invoices" },
    ],
  },
  {
    title: "Job 2: Kitchen + Structural Work (High Vendor Spend)",
    profile:
      "I am coordinating subcontractors and material houses with heavy AP activity while still billing client on AR milestones.",
    whatIActuallyDid: [
      "Loaded vendors, then entered bills and allocated spend against budget/estimate-derived lines.",
      "Used invoice viewer/composer to keep AR progressing while AP was still arriving.",
      "Tracked status changes and dates in bills to avoid missing due items.",
    ],
    workedWell: [
      "Bills and invoices now live in similar workflow patterns, so context switching was easier.",
      "Allocation validation caught incomplete distributions before save.",
      "Vendor list and de-dup controls reduced accidental duplicate records.",
    ],
    edgeCases: [
      "No OCR/import pipeline for real vendor PDFs yet.",
      "Freight modeling is still simplified (weight vs charge vs pass-through rules).",
      "Cross-project shared purchases still need a clean allocation UX pattern.",
    ],
    links: [
      { href: "/bills", label: "Bills" },
      { href: "/invoices", label: "Invoices" },
      { href: "/vendors", label: "Vendors" },
    ],
  },
  {
    title: "Job 3: Water-Damage Emergency (Scope Not Stable)",
    profile:
      "I start work fast, unknown final scope, and need to capture adjustments without corrupting baseline estimating.",
    whatIActuallyDid: [
      "Created project quickly from intake and drafted estimate as a working baseline.",
      "Used adjustment-capable invoice/CO attribution to isolate out-of-band work.",
      "Captured rationale in notes whenever billing moved outside original planned scope.",
    ],
    workedWell: [
      "Adjustment bins prevented me from polluting core scope lines.",
      "Status history made it clear why totals changed over time.",
      "Read-only states protected finalized docs from accidental edits.",
    ],
    edgeCases: [
      "Need stronger required-reason enforcement for non-baseline billing adjustments.",
      "Need better support for progressive scope discovery with customer signoff checkpoints.",
      "Need clearer visuals for what is baseline scope vs adjustment scope in one glance.",
    ],
    links: [
      { href: "/projects", label: "Projects" },
      { href: "/projects/7/estimates", label: "Estimates Example" },
      { href: "/invoices", label: "Invoices" },
    ],
  },
  {
    title: "Job 4: Small Service Jobs (Many Tiny Tickets)",
    profile:
      "I run many low-dollar jobs weekly. Speed matters more than perfect formatting, but I still need clean audit trails.",
    whatIActuallyDid: [
      "Reused customer/vendor/cost-code dictionaries to keep setup overhead low.",
      "Created quick estimates/invoices with minimum fields and moved status as work closed.",
      "Used filtering and selectors heavily to avoid opening wrong records.",
    ],
    workedWell: [
      "Shared selectors and consistent status UX reduced misclicks after repetition.",
      "Single-page consoles helped move quickly between records.",
      "Default active filtering kept noisy inactive items out of the way.",
    ],
    edgeCases: [
      "Bulk actions (status updates, archive, export) are still thin for high-volume workflow.",
      "Search relevance/ranking could improve when lists become large.",
      "Need stronger keyboard-first speed path for desk operators doing repetitive entry.",
    ],
    links: [
      { href: "/customers", label: "Customers" },
      { href: "/cost-codes", label: "Cost Codes" },
      { href: "/vendors", label: "Vendors" },
    ],
  },
];

const prioritizedGaps = [
  "Retainage and draw-schedule support across estimate/invoice/payment flows.",
  "Per-line tax logic and jurisdiction-aware defaults.",
  "Document intake from files (OCR + parser) for vendor bills and external references.",
  "Cross-project AP allocation for shared purchases without awkward workarounds.",
  "Bulk operations and keyboard-first workflows for high-volume users.",
  "Customer-facing acceptance artifacts for estimates/change orders.",
];

export default function OpsMetaHelpPage() {
  return (
    <div className={shell.page}>
      <main className={`${shell.main} ${shell.mainNarrow}`}>
        <header className={shell.hero}>
          <div className={shell.heroTop}>
            <p className={shell.eyebrow}>Ops / Meta</p>
            <h1 className={shell.title}>Field Guide: ICP Usage Walkthroughs</h1>
            <p className={shell.copy}>
              This page intentionally documents the product as if I were an ideal customer profile:
              owner-operator / PM running residential project financials. I ran four imaginary job
              types through current workflows and captured what worked plus unresolved edge cases.
            </p>
          </div>
          <div className={shell.heroMetaRow}>
            <span className={shell.metaPill}>4 scenario walkthroughs</span>
            <span className={shell.metaPill}>ICP viewpoint</span>
            <span className={shell.metaPill}>Explicit edge-case backlog</span>
          </div>
        </header>

        <section className={shell.card}>
          <h2 className={shell.sectionTitle}>Scenario Walkthroughs</h2>
          <p className={shell.sectionCopy}>
            Each scenario includes how I used the system, what felt strong, and where current
            behavior still breaks down for real-world operations.
          </p>
          <div className={styles.jobGrid}>
            {jobWalkthroughs.map((job) => (
              <article key={job.title} className={styles.jobCard}>
                <h3 className={styles.jobTitle}>{job.title}</h3>
                <p className={styles.jobProfile}>{job.profile}</p>

                <section className={styles.jobSection}>
                  <h4>How I used it</h4>
                  <ol className={styles.textList}>
                    {job.whatIActuallyDid.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ol>
                </section>

                <section className={styles.jobSection}>
                  <h4>What worked</h4>
                  <ul className={styles.textList}>
                    {job.workedWell.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>

                <section className={styles.jobSection}>
                  <h4>Edge cases not fully addressed</h4>
                  <ul className={styles.textList}>
                    {job.edgeCases.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>

                <div className={styles.linkRow}>
                  {job.links.map((link) => (
                    <Link key={link.href + link.label} href={link.href} className={shell.linkButton}>
                      {link.label}
                    </Link>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className={`${shell.card} ${shell.cardMuted}`}>
          <h2 className={shell.sectionTitle}>Cross-Scenario Gaps To Prioritize</h2>
          <p className={shell.sectionCopy}>
            These came up repeatedly across multiple job types and are likely highest leverage for
            next product iterations.
          </p>
          <ul className={styles.gapList}>
            {prioritizedGaps.map((gap) => (
              <li key={gap} className={styles.gapItem}>
                {gap}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
