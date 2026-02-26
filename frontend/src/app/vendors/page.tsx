import type { Metadata } from "next";
import { VendorsConsole } from "@/features/vendors";
import shell from "@/app/wip-shell.module.css";

export const metadata: Metadata = {
  title: "Vendors",
};

export default function VendorsPage() {
  return (
    <div className={shell.page}>
      <main className={`${shell.main} ${shell.mainNarrow}`}>
        <header className={shell.hero}>
          <div className={shell.heroTop}>
            <p className={shell.eyebrow}>Ops / Meta</p>
            <h1 className={shell.title}>Vendors (WIP)</h1>
            <p className={shell.copy}>
              Maintain canonical payees for AP workflows. This directory feeds Bills and
              outbound payment allocation.
            </p>
          </div>
          <div className={shell.heroMetaRow}>
            <span className={shell.metaPill}>Duplicate guarded</span>
            <span className={shell.metaPill}>Reusable vendor records</span>
            <span className={shell.metaPill}>AP-first shape</span>
          </div>
        </header>
        <section className={shell.card}>
          <VendorsConsole />
        </section>
      </main>
    </div>
  );
}
