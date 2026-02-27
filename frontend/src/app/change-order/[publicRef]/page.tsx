import type { Metadata } from "next";
import { notFound } from "next/navigation";
import shell from "@/app/wip-shell.module.css";
import { ChangeOrderPublicPreview } from "@/features/change-orders/components/change-order-public-preview";

type ChangeOrderPublicPageProps = {
  params: Promise<{ publicRef: string }>;
};

function parsePublicToken(publicRef: string): string | null {
  const match = publicRef.match(/--([A-Za-z0-9]{8,24})$/);
  return match ? match[1] : null;
}

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

async function loadPublicChangeOrderTitle(publicToken: string): Promise<string | null> {
  const normalizedBaseUrl = defaultApiBaseUrl.trim().replace(/\/$/, "");
  try {
    const response = await fetch(`${normalizedBaseUrl}/public/change-orders/${publicToken}/`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as {
      data?: { title?: string; project_context?: { name?: string } };
    };
    const changeOrderTitle = payload.data?.title?.trim();
    if (changeOrderTitle) {
      return changeOrderTitle;
    }
    const projectName = payload.data?.project_context?.name?.trim();
    if (projectName) {
      return `${projectName} Change Order`;
    }
    return null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: ChangeOrderPublicPageProps): Promise<Metadata> {
  const { publicRef } = await params;
  const publicToken = parsePublicToken(publicRef);
  if (!publicToken) {
    return { title: "Change Order" };
  }
  const resolvedTitle = await loadPublicChangeOrderTitle(publicToken);
  return { title: resolvedTitle ? `${resolvedTitle} | Change Order` : "Change Order" };
}

export default async function ChangeOrderPublicPage({ params }: ChangeOrderPublicPageProps) {
  const { publicRef } = await params;
  const publicToken = parsePublicToken(publicRef);
  if (!publicToken) {
    notFound();
  }

  return (
    <div className={shell.page}>
      <main className={`${shell.main} ${shell.mainNarrow}`}>
        <section className={shell.card}>
          <ChangeOrderPublicPreview publicToken={publicToken} />
        </section>
      </main>
    </div>
  );
}
