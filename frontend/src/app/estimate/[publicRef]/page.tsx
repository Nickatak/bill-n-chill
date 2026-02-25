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

export default async function EstimateReviewPage({ params }: EstimateReviewPageProps) {
  const { publicRef } = await params;
  const publicToken = parsePublicToken(publicRef);
  if (!publicToken) {
    notFound();
  }

  return (
    <div className={shell.page}>
      <main className={shell.main}>
        <header className={shell.hero}>
          <div className={shell.heroTop}>
            <p className={shell.eyebrow}>Client Facing</p>
            <h1 className={shell.title}>Estimate Review (WIP)</h1>
            <p className={shell.copy}>
              Customer-facing estimate preview while final approval/denial language and response
              handling are finalized.
            </p>
          </div>
        </header>
        <section className={shell.card}>
          <EstimateApprovalPreview publicToken={publicToken} />
        </section>
      </main>
    </div>
  );
}
