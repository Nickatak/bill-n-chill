"use client";

import { IntakeSettingsConsole } from "@/features/settings-intake";
import shell from "@/app/wip-shell.module.css";

export default function IntakeSettingsPage() {
  return (
    <div className={shell.page}>
      <main className={`${shell.main} ${shell.mainNarrow}`}>
        <header className={shell.hero}>
          <div className={shell.heroTop}>
            <p className={shell.eyebrow}>Ops / Meta</p>
            <h1 className={shell.title}>Settings (WIP)</h1>
            <p className={shell.copy}>
              Intake guardrails and workflow defaults. This page is intentionally focused on
              contract-safe toggles before broader settings expansion.
            </p>
          </div>
        </header>
        <section className={shell.card}>
          <IntakeSettingsConsole />
        </section>
      </main>
    </div>
  );
}
