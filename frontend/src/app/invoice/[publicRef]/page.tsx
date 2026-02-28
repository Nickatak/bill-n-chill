import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageCard, PageShell } from "@/shared/shell";
import { InvoicePublicPreview } from "@/features/invoices/components/invoice-public-preview";
import {
  composePublicDocumentMetadataTitle,
  parsePublicTokenFromRef,
  resolvePublicInvoiceMetadataTitle,
} from "@/shared/shell/public-route-metadata";

type InvoiceReviewPageProps = {
  params: Promise<{ publicRef: string }>;
};

export async function generateMetadata({ params }: InvoiceReviewPageProps): Promise<Metadata> {
  const { publicRef } = await params;
  const publicToken = parsePublicTokenFromRef(publicRef);
  if (!publicToken) {
    return { title: "Invoice" };
  }
  const resolvedTitle = await resolvePublicInvoiceMetadataTitle(publicToken);
  return { title: composePublicDocumentMetadataTitle(resolvedTitle, "Invoice") };
}

export default async function InvoiceReviewPage({ params }: InvoiceReviewPageProps) {
  const { publicRef } = await params;
  const publicToken = parsePublicTokenFromRef(publicRef);
  if (!publicToken) {
    notFound();
  }

  return (
    <PageShell narrow>
      <PageCard>
        <InvoicePublicPreview publicToken={publicToken} />
      </PageCard>
    </PageShell>
  );
}
