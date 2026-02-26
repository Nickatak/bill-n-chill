import type { Metadata } from "next";
import { VendorBillsConsole } from "@/features/vendor-bills";
import shell from "@/app/wip-shell.module.css";

type BillsPageMetadataProps = {
  searchParams: Promise<{ project?: string }>;
};

export async function generateMetadata({ searchParams }: BillsPageMetadataProps): Promise<Metadata> {
  const { project } = await searchParams;
  if (project && /^\d+$/.test(project)) {
    return { title: `Bills - Project #${project}` };
  }
  return { title: "Bills" };
}

export default function BillsPage() {
  return (
    <div className={shell.page}>
      <main className={shell.main}>
        <section className={shell.card}>
          <VendorBillsConsole />
        </section>
      </main>
    </div>
  );
}
