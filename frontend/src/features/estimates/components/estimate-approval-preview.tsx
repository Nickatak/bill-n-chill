"use client";

/**
 * Public-facing estimate approval preview for customer decision flow.
 * Renders a read-only estimate document via a tokenized public URL and
 * provides approve/reject controls for estimates in "sent" status.
 *
 * Parent: app/estimate/[publicRef]/page.tsx
 */

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useCreatorFlash } from "@/shared/hooks/use-creator-flash";
import {
  PublicDocumentFrame,
  publicDocumentFrameStyles as frameStyles,
  publicDocumentViewerClassNames,
} from "@/shared/document-viewer/public-document-frame";
import {
  resolveDefaultTerms,
  resolvePublicRecipient,
  resolvePublicSender,
} from "@/shared/document-viewer/public-document-context";
import { PublicDocumentViewerShell } from "@/shared/document-viewer/public-document-viewer-shell";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import creatorStyles from "@/shared/document-creator/creator-foundation.module.css";
import stampStyles from "@/shared/styles/decision-stamp.module.css";
import styles from "./estimates-console.module.css";
import { ApiResponse, EstimateRecord } from "../types";
import {
  estimateStatusLabel,
  mapLineCostCodes,
  mapPublicEstimateLineItems,
} from "../helpers";
import { formatDateDisplay, formatDateInputFromIso } from "@/shared/date-format";
import { formatDecimal } from "@/shared/money-format";
import { usePrintContext } from "@/shared/hooks/use-print-context";
import { SigningCeremony, type CeremonyPayload } from "@/shared/document-viewer/signing-ceremony";

type EstimateApprovalPreviewProps = {
  publicToken: string;
};

/** Renders the public estimate preview and customer decision form. */
export function EstimateApprovalPreview({ publicToken }: EstimateApprovalPreviewProps) {
  const [statusMessage, setStatusMessage] = useState("Loading estimate...");
  const [estimate, setEstimate] = useState<EstimateRecord | null>(null);
  const [decisionMessage, setDecisionMessage] = useState("");
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [decisionReceiptName, setDecisionReceiptName] = useState("");
  const { ref: decisionSectionRef, flash: flashDecision } = useCreatorFlash();
  const { printTimestamp } = usePrintContext();

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const lineItems = useMemo(() => mapPublicEstimateLineItems(estimate), [estimate]);
  const costCodes = useMemo(() => mapLineCostCodes(estimate), [estimate]);
  const estimateDate = formatDateInputFromIso(estimate?.created_at);
  const validThrough = estimate?.valid_through ?? "";
  const sender = useMemo(
    () => resolvePublicSender(estimate?.organization_context, estimate),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally granular deps
    [estimate?.organization_context, estimate?.sender_name, estimate?.sender_address, estimate?.sender_logo_url],
  );
  const recipient = useMemo(
    () => resolvePublicRecipient(estimate?.project_context),
    [estimate?.project_context],
  );
  const termsText = useMemo(() => {
    const documentTerms = (estimate?.terms_text || "").trim();
    if (documentTerms) return documentTerms;
    const organizationTerms = resolveDefaultTerms(estimate?.organization_context, "estimate");
    return organizationTerms || "No terms specified.";
  }, [estimate?.organization_context, estimate?.terms_text]);

  const lineTotals = useMemo(
    () =>
      lineItems.map((line) => {
        const quantity = Number(line.quantity || 0);
        const unitCost = Number(line.unitCost || 0);
        const markup = Number(line.markupPercent || 0);
        const base = quantity * unitCost;
        return base + base * (markup / 100);
      }),
    [lineItems],
  );
  const subtotal = lineTotals.reduce((sum, value) => sum + value, 0);
  const taxPercent = String(estimate?.tax_percent ?? "0");
  const taxableBase = lineTotals.reduce((sum, value, index) => {
    const cc = costCodes.find((c) => String(c.id) === lineItems[index].costCodeId);
    return sum + (cc?.taxable !== false ? value : 0);
  }, 0);
  const taxAmount = taxableBase * (Number(taxPercent) / 100);
  const totalAmount = subtotal + taxAmount;
  const canDecide = estimate?.status === "sent";
  const hasDecision = estimate?.status === "approved" || estimate?.status === "rejected";
  const decisionStatusLabel = estimateStatusLabel(estimate?.status);
  // Clear stale decision feedback when the estimate is no longer actionable.
  useEffect(() => {
    if (!canDecide) {
      setDecisionMessage("");
    }
  }, [canDecide]);

  // Fetch the estimate record from the public token on mount.
  useEffect(() => {
    async function loadEstimateContext() {
      try {
        const estimateRes = await fetch(`${normalizedBaseUrl}/public/estimates/${publicToken}/`);
        const estimateJson: ApiResponse = await estimateRes.json();
        if (!estimateRes.ok || !estimateJson.data) {
          setStatusMessage("Estimate not found.");
          return;
        }

        const nextEstimate = estimateJson.data as EstimateRecord;
        setEstimate(nextEstimate);
        setDecisionReceiptName("");
        setStatusMessage("");
      } catch {
        setStatusMessage("Could not reach estimate endpoint.");
      }
    }

    void loadEstimateContext();
  }, [normalizedBaseUrl, publicToken]);

  /** Submit the customer's approve/reject decision with signing ceremony data. */
  async function applyDecision(decision: string, ceremony: CeremonyPayload) {
    if (!estimate || !canDecide || decisionSubmitting) {
      return;
    }

    setDecisionSubmitting(true);
    setDecisionMessage("");

    try {
      const response = await fetch(`${normalizedBaseUrl}/public/estimates/${publicToken}/decision/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          note: ceremony.note,
          session_token: ceremony.session_token,
          signer_name: ceremony.signer_name,
          consent_accepted: ceremony.consent_accepted,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok || !payload.data || Array.isArray(payload.data)) {
        setDecisionMessage(payload.error?.message || "Could not apply decision.");
        return;
      }
      const nextEstimate = payload.data as EstimateRecord;

      setEstimate(nextEstimate);
      setDecisionReceiptName(ceremony.signer_name);
      setDecisionMessage("");
      flashDecision();
    } catch {
      setDecisionMessage("Could not reach estimate decision endpoint.");
    } finally {
      setDecisionSubmitting(false);
    }
  }

  /** Look up the display label for a cost code by its ID. */
  function findCostCodeLabel(costCodeId: string): string {
    const code = costCodes.find((candidate) => String(candidate.id) === costCodeId);
    if (!code) {
      return "N/A";
    }
    return `${code.code} - ${code.name}`;
  }

  function findCostCodeShort(costCodeId: string): string {
    const code = costCodes.find((candidate) => String(candidate.id) === costCodeId);
    return code?.code || "N/A";
  }

  return (
    <PublicDocumentViewerShell
      classNames={publicDocumentViewerClassNames()}
      statusMessage={statusMessage}
      banner={
        estimate && canDecide
          ? {
              tone: "pending" as const,
              eyebrow: "Decision",
              text: "Ready to sign? Jump to the decision section and submit your response.",
              linkHref: "#estimate-decision",
              linkLabel: "Review & Sign",
              stateClassName: styles.decisionBannerAwaiting,
            }
          : undefined
      }
    >
      {estimate ? (
        <>
          <PublicDocumentFrame
            headerLeft={
              <>
                <section className={frameStyles.partyBlock}>
                  <p className={frameStyles.partyLabel}>From</p>
                  <p className={frameStyles.partyPrimary}>{sender.senderName || sender.companyName}</p>
                  {sender.senderAddressLines.length ? (
                    sender.senderAddressLines.map((line, index) => (
                      <p key={`sender-${line}-${index}`} className={frameStyles.partySecondary}>
                        {line}
                      </p>
                    ))
                  ) : (
                    <p className={frameStyles.partySecondary}>Set sender address in Organization settings.</p>
                  )}
                </section>
                <section className={frameStyles.partyBlock}>
                  <p className={frameStyles.partyLabel}>To</p>
                  <p className={frameStyles.partyPrimary}>{recipient.name}</p>
                  {recipient.email ? (
                    <p className={frameStyles.partySecondary}>{recipient.email}</p>
                  ) : null}
                  {recipient.phone ? (
                    <p className={frameStyles.partySecondary}>{recipient.phone}</p>
                  ) : null}
                  {recipient.addressLines.length ? (
                    recipient.addressLines.map((line, index) => (
                      <p key={`${line}-${index}`} className={frameStyles.partySecondary}>
                        {line}
                      </p>
                    ))
                  ) : (
                    <p className={frameStyles.partySecondary}>Billing address unavailable.</p>
                  )}
                </section>
              </>
            }
            headerRight={
              <>
                <div className={frameStyles.logoBox}>
                  {sender.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo
                    <img
                      className={frameStyles.logoImage}
                      src={sender.logoUrl}
                      alt={`${sender.companyName} logo`}
                    />
                  ) : (
                    <p className={frameStyles.logoPlaceholder}>No logo URL set</p>
                  )}
                </div>
                <div>
                  <p className={frameStyles.identityEyebrow}>Estimate</p>
                  <h2 className={frameStyles.identityTitle}>{estimate.title || "Untitled"}</h2>
                  <p className={frameStyles.identitySubhead}>
                    {(estimate.project_context?.name || "Project") + ` · v${estimate.version}`}
                  </p>
                </div>
                <hr className={frameStyles.identityDivider} />
                <section className={`${frameStyles.metaDetails} ${styles.publicDetailsPanel}`}>
                  <h4 className={frameStyles.metaDetailsTitle}>Estimate Details</h4>
                  <div className={frameStyles.metaDetailsRow}>
                    <span>Status</span>
                    <span>{decisionStatusLabel}</span>
                  </div>
                  <div className={frameStyles.metaDetailsRow}>
                    <span>Estimate date</span>
                    <span>{formatDateDisplay(estimateDate, "Not set")}</span>
                  </div>
                  <div className={frameStyles.metaDetailsRow}>
                    <span>Valid through</span>
                    <span>{formatDateDisplay(validThrough, "Not set")}</span>
                  </div>
                </section>
              </>
            }
            lineTitle="Line Items"
            columns={["Qty", "Desc", "Cost Code", "Unit", "Unit Price", "Total"]}
            mobileColumnLayout={[
              { order: 2, span: "half", hidden: true },  // Qty (folded into Amount)
              { order: 0, span: "full" },                 // Desc
              { order: 1, span: "full" },                 // Cost Code
              { order: 3, span: "half", hidden: true },   // Unit (folded into Amount)
              { order: 4, span: "half", hidden: true },   // Unit Price (folded into Amount)
              { order: 2, span: "full", align: "right" }, // Amount (shows breakdown)
            ]}
            rows={(() => {
              const sections = [...(estimate.sections ?? [])].sort((a, b) => a.order - b.order);
              const rawItems = estimate.line_items ?? [];

              function buildLineRow(index: number) {
                const line = lineItems[index];
                const qty = Number(line.quantity || 0);
                const unitPrice = Number(line.unitCost || 0);
                const unit = line.unit || "ea";
                return {
                  key: line.localId,
                  cells: [
                    qty.toFixed(2),
                    line.description || "No description",
                    <>
                      <span className={creatorStyles.printOnly}>{findCostCodeShort(line.costCodeId)}</span>
                      <span className={creatorStyles.screenOnly}>{findCostCodeLabel(line.costCodeId)}</span>
                    </>,
                    unit,
                    `$${unitPrice.toFixed(2)}`,
                    <>
                      <span className={frameStyles.mobileBreakdown}>
                        {qty.toFixed(2)} {unit} × ${unitPrice.toFixed(2)}
                      </span>
                      <span>${formatDecimal(lineTotals[index] ?? 0)}</span>
                    </>,
                  ],
                };
              }

              // No sections — flat rendering
              if (!sections.length) {
                return lineItems.map((_, index) => buildLineRow(index));
              }

              const result: { key: string | number; cells: ReactNode[]; variant?: "section-header" | "section-subtotal" }[] = [];

              // Orphan line items before first section
              for (let i = 0; i < rawItems.length; i++) {
                if ((rawItems[i].order ?? i) < sections[0].order) {
                  result.push(buildLineRow(i));
                }
              }

              for (let s = 0; s < sections.length; s++) {
                const section = sections[s];
                const nextOrder = s + 1 < sections.length ? sections[s + 1].order : Infinity;

                result.push({
                  key: `section-${section.id}`,
                  variant: "section-header",
                  cells: [section.name],
                });

                for (let i = 0; i < rawItems.length; i++) {
                  const order = rawItems[i].order ?? i;
                  if (order > section.order && order < nextOrder) {
                    result.push(buildLineRow(i));
                  }
                }

                result.push({
                  key: `section-sub-${section.id}`,
                  variant: "section-subtotal",
                  cells: [`${section.name} Subtotal — $${formatDecimal(Number(section.subtotal))}`],
                });
              }

              return result;
            })()}
            afterTable={
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <div className={frameStyles.summaryBox}>
                  <div className={frameStyles.summaryRow}>
                    <span>Subtotal</span>
                    <span>${formatDecimal(subtotal)}</span>
                  </div>
                  <div className={frameStyles.summaryRow}>
                    <span>Sales Tax ({Number(taxPercent || 0).toFixed(2)}%)</span>
                    <span>${formatDecimal(taxAmount)}</span>
                  </div>
                  <div className={`${frameStyles.summaryRow} ${frameStyles.summaryTotal}`}>
                    <span>Total</span>
                    <span>${formatDecimal(totalAmount)}</span>
                  </div>
                </div>
              </div>
            }
            afterLineSection={
              <>
                {estimate.notes_text ? (
                  <div className={frameStyles.terms}>
                    <h4>Notes &amp; Exclusions</h4>
                    {estimate.notes_text
                      .split("\n")
                      .filter((line) => line.trim())
                      .map((line, index) => (
                        <p key={`estimate-notes-${index}`}>{line}</p>
                      ))}
                  </div>
                ) : null}
                <div className={frameStyles.terms}>
                  <h4>Terms and Conditions</h4>
                  {termsText
                    .split("\n")
                    .filter((line) => line.trim())
                    .map((line, index) => (
                      <p key={`estimate-terms-${line}-${index}`}>{line}</p>
                    ))}
                </div>
              </>
            }
            footer={
              <footer>
                <div className={frameStyles.footerRow}>
                  <span>{sender.companyName}</span>
                  <span>{sender.helpEmail || "Help email not set"}</span>
                  <span>{estimate.public_ref || publicToken}</span>
                </div>
                <div className={frameStyles.printFooter}>
                  <span>{printTimestamp}</span>
                  <span>{estimate.public_ref || publicToken}</span>
                </div>
              </footer>
            }
          />
          {canDecide ? (
            <div ref={decisionSectionRef} id="estimate-decision">
              {decisionMessage ? <p className={styles.inlineHint}>{decisionMessage}</p> : null}
              <SigningCeremony
                publicToken={publicToken}
                documentType="estimate"
                documentSummary={{
                  type: "Estimate",
                  title: estimate.title || "Untitled",
                  total: `$${formatDecimal(totalAmount)}`,
                }}
                customerEmailAvailable={Boolean(estimate.project_context?.customer_email)}
                consentText={estimate.ceremony_consent_text ?? ""}
                decisions={[
                  { label: "Approve Estimate", value: "approve", variant: "primary" },
                  { label: "Reject Estimate", value: "reject", variant: "secondary" },
                ]}
                onDecision={applyDecision}
                disabled={decisionSubmitting}
              />
            </div>
          ) : null}
          {hasDecision ? (
            <div
              ref={decisionSectionRef}
              className={`${stampStyles.decisionStamp} ${
                estimate?.status === "approved" ? stampStyles.decisionStampApproved
                : stampStyles.decisionStampRejected
              }`}
            >
              <p className={stampStyles.decisionStampLabel}>
                {estimate?.status === "approved" ? "Approved" : "Rejected"}
              </p>
              {decisionReceiptName.trim() ? (
                <p className={stampStyles.decisionStampDetail}>by {decisionReceiptName.trim()}</p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </PublicDocumentViewerShell>
  );
}
