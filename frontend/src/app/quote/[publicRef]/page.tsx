import type { Metadata } from "next";
import { QuoteApprovalPreview } from "@/features/quotes/components/quote-approval-preview";
import { notFound } from "next/navigation";
import { PageCard, PageShell } from "@/shared/shell";
import lightTheme from "@/shared/styles/light-theme.module.css";
import {
  composePublicDocumentMetadataTitle,
  parsePublicTokenFromRef,
  resolvePublicQuoteMetadataTitle,
} from "@/shared/shell/public-route-metadata";

type QuoteReviewPageProps = {
  params: Promise<{ publicRef: string }>;
};

export async function generateMetadata({ params }: QuoteReviewPageProps): Promise<Metadata> {
  const { publicRef } = await params;
  const publicToken = parsePublicTokenFromRef(publicRef);
  if (!publicToken) {
    return { title: "Quote" };
  }
  const resolvedTitle = await resolvePublicQuoteMetadataTitle(publicToken);
  return { title: composePublicDocumentMetadataTitle(resolvedTitle, "Quote") };
}

export default async function QuoteReviewPage({ params }: QuoteReviewPageProps) {
  const { publicRef } = await params;
  const publicToken = parsePublicTokenFromRef(publicRef);
  if (!publicToken) {
    notFound();
  }

  return (
    <PageShell className={lightTheme.lightTheme}>
      <PageCard>
        <QuoteApprovalPreview publicToken={publicToken} />
      </PageCard>
    </PageShell>
  );
}
