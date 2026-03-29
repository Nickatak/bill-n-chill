import type { Metadata } from "next";
import shell from "@/shared/shell/page-shell.module.css";
import styles from "./page.module.css";
import { PageCard, PageShell } from "@/shared/shell";
import { DismissGuideButton, OnboardingChecklist } from "@/features/onboarding";

export const metadata: Metadata = {
  title: "Get Started",
};

/** Route page for the "Get Started" onboarding checklist shown to fresh orgs. */
export default function OnboardingPage() {
  return (
    <PageShell narrow>
      <header className={shell.hero}>
        <div className={shell.heroTop}>
          <div className={styles.eyebrowRow}>
            <p className={shell.eyebrow}>Get Started</p>
            <DismissGuideButton />
          </div>
          <h1 className={shell.title}>Set up your first project in minutes</h1>
          <p className={shell.copy}>
            Follow these steps to go from zero to your first invoice. Once you create a project,
            the full billing workflow unlocks inside it.
          </p>
          <p className={styles.returnHint} data-onboarding-step="return-hint">
            You can always get back here from your organization menu &rarr; <strong>Get Started</strong>
          </p>
        </div>
      </header>

      <PageCard>
        <OnboardingChecklist />
      </PageCard>
    </PageShell>
  );
}
