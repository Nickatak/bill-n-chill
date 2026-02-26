import type { Metadata } from "next";
import { notFound } from "next/navigation";
import shell from "@/app/wip-shell.module.css";
import { InvoicePublicPreview } from "@/features/invoices/components/invoice-public-preview";

type InvoiceReviewPageProps = {
  params: Promise<{ publicRef: string }>;
};

function parsePublicToken(publicRef: string): string | null {
  const match = publicRef.match(/--([A-Za-z0-9]{8,24})$/);
  return match ? match[1] : null;
}

export const metadata: Metadata = {
  title: "Invoice",
};

export default async function InvoiceReviewPage({ params }: InvoiceReviewPageProps) {
  const { publicRef } = await params;
  const publicToken = parsePublicToken(publicRef);
  if (!publicToken) {
    notFound();
  }

  return (
    <div className={shell.page}>
      <main className={`${shell.main} ${shell.mainNarrow}`}>
        <header className={shell.hero}>
          <div className={shell.heroTop}>
            <p className={shell.eyebrow}>Client Facing</p>
            <h1 className={shell.title}>Invoice</h1>
            <p className={shell.copy}>Review the invoice details, billing breakdown, and payment terms.</p>
          </div>
        </header>
        <section className={shell.card}>
          <InvoicePublicPreview publicToken={publicToken} />
        </section>
      </main>
    </div>
  );
}
