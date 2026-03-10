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
    desc: "Build detailed estimates with cost codes, send for customer approval, and convert to contracts.",
  },
  {
    title: "Change Orders",
    desc: "Track scope changes with full audit trail. Approved COs update your contract baseline automatically.",
  },
  {
    title: "Invoicing",
    desc: "Create invoices from your approved budget or from scratch. Send professional links to customers.",
  },
  {
    title: "Vendor Bills",
    desc: "Log subcontractor and supplier invoices against projects to keep outgoing costs organized.",
  },
  {
    title: "Payments",
    desc: "Record inbound and outbound payments, allocate against invoices and bills, track what's outstanding.",
  },
  {
    title: "Dashboard",
    desc: "Portfolio health, AR/AP at a glance, attention items, and change order impact across all projects.",
  },
];

export function LandingPage() {
  const { isAuthorized, isChecking } = useSessionAuthorization();
  const router = useRouter();

  useEffect(() => {
    if (isAuthorized) {
      router.replace("/dashboard");
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
            Estimates, invoicing, change orders, and payment tracking for
            contractors and remodelers. One place for the money side of every job.
          </p>
          <div className={styles.heroCtas}>
            <Link href="/login?tab=register" className={styles.primaryCta}>
              Get Started Free
            </Link>
            <Link href="/login" className={styles.primaryCta}>
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

      <footer className={styles.footer}>Bill n&apos; Chill</footer>
    </div>
  );
}
