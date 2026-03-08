import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageCard, PageShell } from "@/shared/shell";
import lightTheme from "@/shared/styles/light-theme.module.css";
import { ChangeOrderPublicPreview } from "@/features/change-orders/components/change-order-public-preview";
import {
  composePublicDocumentMetadataTitle,
  parsePublicTokenFromRef,
  resolvePublicChangeOrderMetadataTitle,
} from "@/shared/shell/public-route-metadata";

type ChangeOrderPublicPageProps = {
  params: Promise<{ publicRef: string }>;
};

export async function generateMetadata({ params }: ChangeOrderPublicPageProps): Promise<Metadata> {
  const { publicRef } = await params;
  const publicToken = parsePublicTokenFromRef(publicRef);
  if (!publicToken) {
    return { title: "Change Order" };
  }
  const resolvedTitle = await resolvePublicChangeOrderMetadataTitle(publicToken);
  return { title: composePublicDocumentMetadataTitle(resolvedTitle, "Change Order") };
}

export default async function ChangeOrderPublicPage({ params }: ChangeOrderPublicPageProps) {
  const { publicRef } = await params;
  const publicToken = parsePublicTokenFromRef(publicRef);
  if (!publicToken) {
    notFound();
  }

  return (
    <PageShell narrow className={lightTheme.lightTheme}>
      <PageCard>
        <ChangeOrderPublicPreview publicToken={publicToken} />
      </PageCard>
    </PageShell>
  );
}
