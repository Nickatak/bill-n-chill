import type { Metadata } from "next";
import shell from "@/shared/shell/page-shell.module.css";
import { PageCard, PageShell } from "@/shared/shell";
import { OnboardingChecklist } from "./onboarding-checklist";

export const metadata: Metadata = {
  title: "Get Started",
};

export default function OnboardingPage() {
  return (
    <PageShell narrow>
      <header className={shell.hero}>
        <div className={shell.heroTop}>
          <p className={shell.eyebrow}>Get Started</p>
          <h1 className={shell.title}>Set up your first project in minutes</h1>
          <p className={shell.copy}>
            Follow these steps to go from zero to your first invoice. Each step builds on the
            last &mdash; by the end you&apos;ll have a complete billing workflow.
          </p>
          <p className={shell.copy} style={{ fontSize: "0.82rem", opacity: 0.7 }}>
            You can always get back to this page from your organization menu
            &rarr; <strong>Get Started</strong>.
          </p>
        </div>
      </header>

      <PageCard>
        <OnboardingChecklist />
      </PageCard>
    </PageShell>
  );
}
