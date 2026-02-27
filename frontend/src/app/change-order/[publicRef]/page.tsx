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

export const metadata: Metadata = {
  title: "Change Order",
};

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
