"use client";

/**
 * Public-facing estimate approval preview for customer decision flow.
 * Renders a read-only estimate document via a tokenized public URL and
 * provides approve/reject controls for estimates in "sent" status.
 */

import { useEffect, useMemo, useRef, useState } from "react";
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
import { ApiResponse, CostCode, EstimateLineInput, EstimateRecord } from "../types";
import { formatDateDisplay, formatDateInputFromIso } from "@/shared/date-format";
import { formatDecimal } from "@/shared/money-format";
import { usePrintContext } from "@/shared/hooks/use-print-context";

type EstimateApprovalPreviewProps = {
  publicToken: string;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  approved: "Approved",
  rejected: "Rejected",
  archived: "Archived",
  void: "Void",
};

/** Convert API line-item records into form-compatible input shapes. */
function mapLineItemsToInputs(estimate: EstimateRecord | null): EstimateLineInput[] {
  const items = estimate?.line_items ?? [];
  if (!items.length) {
    return [];
  }
  return items.map((item, index) => ({
    localId: index + 1,
    costCodeId: String(item.cost_code ?? ""),
    description: item.description || "",
    quantity: String(item.quantity ?? ""),
    unit: item.unit || "ea",
    unitCost: String(item.unit_cost ?? ""),
    markupPercent: String(item.markup_percent ?? ""),
  }));
}

/** Extract a deduplicated cost-code lookup list from inline line-item data. */
function mapLineCostCodes(estimate: EstimateRecord | null): CostCode[] {
  const items = estimate?.line_items ?? [];
  const byId = new Map<number, CostCode>();
  for (const item of items) {
    const costCodeId = Number(item.cost_code);
    if (!Number.isFinite(costCodeId)) {
      continue;
    }
    byId.set(costCodeId, {
      id: costCodeId,
      code: item.cost_code_code || `CC-${costCodeId}`,
      name: item.cost_code_name || "Cost code",
      is_active: true,
    });
  }
  return Array.from(byId.values());
}

/** Resolve a status value to its human-readable label, falling back gracefully. */
function estimateStatusLabel(status?: string): string {
  const normalized = (status || "").trim();
  return STATUS_LABELS[normalized] || normalized || "Unknown";
}

/** Renders the public estimate preview and customer decision form. */
export function EstimateApprovalPreview({ publicToken }: EstimateApprovalPreviewProps) {
  const [statusMessage, setStatusMessage] = useState("Loading estimate...");
  const [estimate, setEstimate] = useState<EstimateRecord | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [deciderName, setDeciderName] = useState("");
  const [deciderEmail, setDeciderEmail] = useState("");
  const [decisionMessage, setDecisionMessage] = useState("");
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [decisionReceiptName, setDecisionReceiptName] = useState("");
  const decisionSectionRef = useRef<HTMLDivElement | null>(null);
  const [decisionFlashCount, setDecisionFlashCount] = useState(0);
  const { printTimestamp } = usePrintContext();

  useEffect(() => {
    if (decisionFlashCount === 0) return;
    const el = decisionSectionRef.current;
    if (!el) return;
    el.classList.remove(creatorStyles.sheetFlash);
    void el.offsetWidth;
    el.classList.add(creatorStyles.sheetFlash);
    const cleanup = () => el.classList.remove(creatorStyles.sheetFlash);
    el.addEventListener("animationend", cleanup, { once: true });
    return () => el.removeEventListener("animationend", cleanup);
  }, [decisionFlashCount]);

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const lineItems = useMemo(() => mapLineItemsToInputs(estimate), [estimate]);
  const costCodes = useMemo(() => mapLineCostCodes(estimate), [estimate]);
  const estimateDate = formatDateInputFromIso(estimate?.created_at);
  const validThrough = estimate?.valid_through ?? "";
  const sender = useMemo(
    () => resolvePublicSender(estimate?.organization_context),
    [estimate?.organization_context],
  );
  const recipient = useMemo(
    () => resolvePublicRecipient(estimate?.project_context),
    [estimate?.project_context],
  );
  const termsText = useMemo(() => {
    const organizationTerms = resolveDefaultTerms(estimate?.organization_context, "estimate");
    return organizationTerms || (estimate?.terms_text || "").trim() || "No terms specified.";
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
  const taxAmount = subtotal * (Number(taxPercent) / 100);
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

  /** Submit the customer's approve/reject decision to the public decision endpoint. */
  async function applyDecision(decision: "approve" | "reject") {
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
          note: decisionNote,
          decider_name: deciderName,
          decider_email: deciderEmail,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok || !payload.data || Array.isArray(payload.data)) {
        setDecisionMessage(payload.error?.message || "Could not apply decision.");
        return;
      }
      const nextEstimate = payload.data as EstimateRecord;

      setEstimate(nextEstimate);
      setDecisionReceiptName(deciderName.trim());
      setDecisionMessage("");
      setDecisionFlashCount((c) => c + 1);
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
                    <span>Estimate #</span>
                    <span>#{estimate.id}</span>
                  </div>
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
            columns={["Qty", "Desc", "Cost Code", "Unit", "Unit Price", "Amount"]}
            rows={lineItems.map((line, index) => ({
              key: line.localId,
              cells: [
                Number(line.quantity || 0).toFixed(2),
                line.description || "No description",
                <>
                  <span className={creatorStyles.printOnly}>{findCostCodeShort(line.costCodeId)}</span>
                  <span className={creatorStyles.screenOnly}>{findCostCodeLabel(line.costCodeId)}</span>
                </>,
                line.unit || "ea",
                `$${Number(line.unitCost || 0).toFixed(2)}`,
                `$${formatDecimal(lineTotals[index] ?? 0)}`,
              ],
            }))}
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
              <div className={frameStyles.terms}>
                <h4>Terms and Conditions</h4>
                {termsText
                  .split("\n")
                  .filter((line) => line.trim())
                  .map((line, index) => (
                    <p key={`estimate-terms-${line}-${index}`}>{line}</p>
                  ))}
              </div>
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
            <div
              ref={decisionSectionRef}
              id="estimate-decision"
              className={`${styles.lifecycle} ${styles.publicDecisionSection}`}
            >
              <h3>Decision</h3>
              {decisionMessage ? <p className={styles.inlineHint}>{decisionMessage}</p> : null}
              <label className={styles.lifecycleField}>
                Your name (optional)
                <input
                  className={styles.fieldInput}
                  value={deciderName}
                  onChange={(event) => setDeciderName(event.target.value)}
                  placeholder="Homeowner name"
                  disabled={decisionSubmitting}
                />
              </label>
              <label className={styles.lifecycleField}>
                Your email (optional)
                <input
                  className={styles.fieldInput}
                  value={deciderEmail}
                  onChange={(event) => setDeciderEmail(event.target.value)}
                  placeholder="owner@example.com"
                  disabled={decisionSubmitting}
                />
              </label>
              <label className={styles.lifecycleField}>
                Note (optional)
                <textarea
                  className={styles.statusNote}
                  value={decisionNote}
                  onChange={(event) => setDecisionNote(event.target.value)}
                  placeholder="Optional decision note."
                  rows={3}
                  disabled={decisionSubmitting}
                />
              </label>
              <div className={styles.lifecycleActions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void applyDecision("approve")}
                  disabled={decisionSubmitting}
                >
                  Approve Estimate
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void applyDecision("reject")}
                  disabled={decisionSubmitting}
                >
                  Reject Estimate
                </button>
              </div>
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
