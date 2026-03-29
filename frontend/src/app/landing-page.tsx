"use client";

/**
 * Public landing page shown to unauthenticated visitors at /.
 * Authenticated users are redirected to /dashboard by the auth gate.
 */

import { useSessionAuthorization } from "@/shared/session/session-authorization";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import styles from "./landing-page.module.css";

const FEATURES = [
  {
    title: "Estimates",
    desc: "Build line-item estimates, send a professional link for customer approval, and lock in your contract baseline.",
  },
  {
    title: "Change Orders",
    desc: "Scope changes with full audit trail. Approved COs update your contract value automatically.",
  },
  {
    title: "Invoicing",
    desc: "Invoice from your approved budget or ad-hoc. Customers review and approve from a branded link.",
  },
  {
    title: "Vendor Bills",
    desc: "Log sub and supplier invoices against projects. Snap a photo and let OCR do the data entry.",
  },
  {
    title: "Payments",
    desc: "Record what came in and what went out. Allocate against invoices and bills, see what's outstanding.",
  },
  {
    title: "Project Finance",
    desc: "Contract value, billed-to-date, AR/AP, and cost tracking — one view per project, no spreadsheets.",
  },
];

export function LandingPage() {
  const { isAuthorized, isChecking } = useSessionAuthorization();
  const router = useRouter();

  useEffect(() => {
    if (isAuthorized) {
      router.replace("/customers");
    }
  }, [isAuthorized, router]);

  if (isChecking || isAuthorized) {
    return null;
  }

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <main className={styles.hero}>
          <h1 className={styles.headline}>
            Construction finance,
            <br />
            without the headache.
          </h1>
          <p className={styles.subheadline}>
            Estimates, invoicing, change orders, and payment tracking —
            one place for the money side of every job.
          </p>
          <p className={styles.audience}>
            Built for general contractors, remodelers, and specialty subs.
          </p>
          <div className={styles.heroCtas}>
            <Link href="/register" className={styles.primaryCta}>
              Get Started — Free During Early Access
            </Link>
            <Link href="/login" className={styles.secondaryCta}>
              Sign In
            </Link>
          </div>
        </main>

        <div className={styles.features}>
          {FEATURES.map((f) => (
            <div key={f.title} className={styles.featureCard}>
              <h3 className={styles.featureTitle}>{f.title}</h3>
              <p className={styles.featureDesc}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <footer className={styles.footer}>
        <span>&copy; {new Date().getFullYear()} Bill n&apos; Chill</span>
        <span className={styles.footerDot}>&middot;</span>
        <span>Built in Los Angeles</span>
        <span className={styles.footerDot}>&middot;</span>
        <Link href="/terms" className={styles.footerLink}>Terms</Link>
        <span className={styles.footerDot}>&middot;</span>
        <Link href="/privacy" className={styles.footerLink}>Privacy</Link>
      </footer>
    </div>
  );
}
