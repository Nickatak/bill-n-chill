import type { Metadata } from "next";
import { InvoicesConsole } from "@/features/invoices";
import shell from "@/app/wip-shell.module.css";

type InvoicesPageMetadataProps = {
  searchParams: Promise<{ project?: string }>;
};

export async function generateMetadata({ searchParams }: InvoicesPageMetadataProps): Promise<Metadata> {
  const { project } = await searchParams;
  if (project && /^\d+$/.test(project)) {
    return { title: `Invoices - Project #${project}` };
  }
  return { title: "Invoices" };
}

export default function InvoicesPage() {
  return (
    <div className={shell.page}>
      <main className={shell.main}>
        <section className={shell.card}>
          <InvoicesConsole />
        </section>
      </main>
    </div>
  );
}
