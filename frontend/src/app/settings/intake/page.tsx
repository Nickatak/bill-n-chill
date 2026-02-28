import type { Metadata } from "next";
import { IntakeSettingsConsole } from "@/features/settings-intake";
import shell from "@/shared/shell/page-shell.module.css";
import { PageCard, PageShell } from "@/shared/shell";

export const metadata: Metadata = {
  title: "Intake Settings",
};

export default function IntakeSettingsPage() {
  return (
    <PageShell narrow>
      <header className={shell.hero}>
        <div className={shell.heroTop}>
          <p className={shell.eyebrow}>Ops / Meta</p>
          <h1 className={shell.title}>Settings</h1>
          <p className={shell.copy}>
            Intake guardrails and workflow defaults. This page is intentionally focused on
            contract-safe toggles before broader settings expansion.
          </p>
        </div>
      </header>
      <PageCard>
        <IntakeSettingsConsole />
      </PageCard>
    </PageShell>
  );
}
