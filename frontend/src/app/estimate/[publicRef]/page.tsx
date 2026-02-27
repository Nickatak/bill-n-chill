import type { Metadata } from "next";
import { EstimateApprovalPreview } from "@/features/estimates/components/estimate-approval-preview";
import { notFound } from "next/navigation";
import shell from "@/app/wip-shell.module.css";

type EstimateReviewPageProps = {
  params: Promise<{ publicRef: string }>;
};

function parsePublicToken(publicRef: string): string | null {
  const match = publicRef.match(/--([A-Za-z0-9]{8,24})$/);
  return match ? match[1] : null;
}

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

async function loadPublicEstimateTitle(publicToken: string): Promise<string | null> {
  const normalizedBaseUrl = defaultApiBaseUrl.trim().replace(/\/$/, "");
  try {
    const response = await fetch(`${normalizedBaseUrl}/public/estimates/${publicToken}/`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as {
      data?: { title?: string; project_context?: { name?: string } };
    };
    const estimateTitle = payload.data?.title?.trim();
    if (estimateTitle) {
      return estimateTitle;
    }
    const projectName = payload.data?.project_context?.name?.trim();
    if (projectName) {
      return `${projectName} Estimate`;
    }
    return null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: EstimateReviewPageProps): Promise<Metadata> {
  const { publicRef } = await params;
  const publicToken = parsePublicToken(publicRef);
  if (!publicToken) {
    return { title: "Estimate" };
  }
  const resolvedTitle = await loadPublicEstimateTitle(publicToken);
  return { title: resolvedTitle ? `${resolvedTitle} | Estimate` : "Estimate" };
}

export default async function EstimateReviewPage({ params }: EstimateReviewPageProps) {
  const { publicRef } = await params;
  const publicToken = parsePublicToken(publicRef);
  if (!publicToken) {
    notFound();
  }

  return (
    <div className={shell.page}>
      <main className={shell.main}>
        <section className={shell.card}>
          <EstimateApprovalPreview publicToken={publicToken} />
        </section>
      </main>
    </div>
  );
}
