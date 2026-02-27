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

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

async function loadPublicInvoiceTitle(publicToken: string): Promise<string | null> {
  const normalizedBaseUrl = defaultApiBaseUrl.trim().replace(/\/$/, "");
  try {
    const response = await fetch(`${normalizedBaseUrl}/public/invoices/${publicToken}/`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as {
      data?: { invoice_number?: string; project_context?: { name?: string }; id?: number };
    };
    const invoiceNumber = payload.data?.invoice_number?.trim();
    if (invoiceNumber) {
      return invoiceNumber;
    }
    const invoiceId = payload.data?.id;
    if (typeof invoiceId === "number") {
      return `Invoice #${invoiceId}`;
    }
    const projectName = payload.data?.project_context?.name?.trim();
    if (projectName) {
      return `${projectName} Invoice`;
    }
    return null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: InvoiceReviewPageProps): Promise<Metadata> {
  const { publicRef } = await params;
  const publicToken = parsePublicToken(publicRef);
  if (!publicToken) {
    return { title: "Invoice" };
  }
  const resolvedTitle = await loadPublicInvoiceTitle(publicToken);
  return { title: resolvedTitle ? `${resolvedTitle} | Invoice` : "Invoice" };
}

export default async function InvoiceReviewPage({ params }: InvoiceReviewPageProps) {
  const { publicRef } = await params;
  const publicToken = parsePublicToken(publicRef);
  if (!publicToken) {
    notFound();
  }

  return (
    <div className={shell.page}>
      <main className={`${shell.main} ${shell.mainNarrow}`}>
        <section className={shell.card}>
          <InvoicePublicPreview publicToken={publicToken} />
        </section>
      </main>
    </div>
  );
}
