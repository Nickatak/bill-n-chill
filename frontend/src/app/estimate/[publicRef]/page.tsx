import type { Metadata } from "next";
import { EstimateApprovalPreview } from "@/features/estimates/components/estimate-approval-preview";
import { notFound } from "next/navigation";
import { PageCard, PageShell } from "@/app/page-shell";
import {
  composePublicDocumentMetadataTitle,
  parsePublicTokenFromRef,
  resolvePublicEstimateMetadataTitle,
} from "@/app/public-route-metadata";

type EstimateReviewPageProps = {
  params: Promise<{ publicRef: string }>;
};

export async function generateMetadata({ params }: EstimateReviewPageProps): Promise<Metadata> {
  const { publicRef } = await params;
  const publicToken = parsePublicTokenFromRef(publicRef);
  if (!publicToken) {
    return { title: "Estimate" };
  }
  const resolvedTitle = await resolvePublicEstimateMetadataTitle(publicToken);
  return { title: composePublicDocumentMetadataTitle(resolvedTitle, "Estimate") };
}

export default async function EstimateReviewPage({ params }: EstimateReviewPageProps) {
  const { publicRef } = await params;
  const publicToken = parsePublicTokenFromRef(publicRef);
  if (!publicToken) {
    notFound();
  }

  return (
    <PageShell>
      <PageCard>
        <EstimateApprovalPreview publicToken={publicToken} />
      </PageCard>
    </PageShell>
  );
}
