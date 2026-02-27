"use client";

import { useEffect, useMemo, useState } from "react";
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
import styles from "./estimates-console.module.css";
import { ApiResponse, CostCode, EstimateLineInput, EstimateRecord } from "../types";
import { formatDateInputFromIso } from "../../../shared/date-format";

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

function formatMoney(value: number): string {
  return value.toFixed(2);
}

function formatDisplayDate(value: string): string {
  if (!value) {
    return "Not set";
  }
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function estimateStatusLabel(status?: string): string {
  const normalized = (status || "").trim();
  return STATUS_LABELS[normalized] || normalized || "Unknown";
}

export function EstimateApprovalPreview({ publicToken }: EstimateApprovalPreviewProps) {
  const [statusMessage, setStatusMessage] = useState("Loading estimate...");
  const [estimate, setEstimate] = useState<EstimateRecord | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [deciderName, setDeciderName] = useState("");
  const [deciderEmail, setDeciderEmail] = useState("");
  const [decisionMessage, setDecisionMessage] = useState("");
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [decisionReceiptName, setDecisionReceiptName] = useState("");
  const [printTimestamp, setPrintTimestamp] = useState("");

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
  const showDecisionSection = canDecide;
  const decisionStatusLabel = estimateStatusLabel(estimate?.status);
  const approvalAcknowledgement = useMemo(() => {
    const name = decisionReceiptName.trim();
    if (name) {
      return `Thank you for your approval, ${name}.`;
    }
    return "Thank you for your approval.";
  }, [decisionReceiptName]);
  const nonPendingDecisionMessage =
    estimate?.status === "approved"
      ? `Decision status: ${decisionStatusLabel}. ${approvalAcknowledgement}`
      : `Decision status: ${decisionStatusLabel}. This estimate is not awaiting response.`;

  useEffect(() => {
    if (!canDecide) {
      setDecisionMessage("");
    }
  }, [canDecide]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const titleBeforeMount = document.title;
    const formatPrintedAt = () =>
      new Intl.DateTimeFormat("en-US", {
        month: "numeric",
        day: "numeric",
        year: "2-digit",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date());

    const setPrintContext = () => {
      setPrintTimestamp(formatPrintedAt());
    };

    const handleBeforePrint = () => {
      setPrintContext();
      document.title = "";
    };

    const handleAfterPrint = () => {
      document.title = titleBeforeMount;
    };

    setPrintContext();
    window.addEventListener("beforeprint", handleBeforePrint);
    window.addEventListener("afterprint", handleAfterPrint);

    return () => {
      window.removeEventListener("beforeprint", handleBeforePrint);
      window.removeEventListener("afterprint", handleAfterPrint);
      document.title = titleBeforeMount;
    };
  }, []);

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
    } catch {
      setDecisionMessage("Could not reach estimate decision endpoint.");
    } finally {
      setDecisionSubmitting(false);
    }
  }

  function findCostCodeLabel(costCodeId: string): string {
    const code = costCodes.find((candidate) => String(candidate.id) === costCodeId);
    if (!code) {
      return "N/A";
    }
    return `${code.code} - ${code.name}`;
  }

  return (
    <PublicDocumentViewerShell
      classNames={publicDocumentViewerClassNames()}
      statusMessage={statusMessage}
      banner={
        estimate
          ? {
              tone: canDecide ? "pending" : "complete",
              eyebrow: "Decision",
              text: canDecide
                ? "Ready to sign? Jump to the decision section and submit your response."
                : nonPendingDecisionMessage,
              linkHref: canDecide ? "#estimate-decision" : undefined,
              linkLabel: canDecide ? "Review & Sign" : undefined,
              stateClassName: canDecide ? styles.decisionBannerAwaiting : styles.decisionBannerSettled,
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
                  {sender.senderEmail ? (
                    <p className={frameStyles.partySecondary}>{sender.senderEmail}</p>
                  ) : null}
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
                    <span>{formatDisplayDate(estimateDate)}</span>
                  </div>
                  <div className={frameStyles.metaDetailsRow}>
                    <span>Valid through</span>
                    <span>{formatDisplayDate(validThrough)}</span>
                  </div>
                </section>
              </>
            }
            lineTitle="Line Items"
            columns={["Qty", "Description", "Cost Code", "Unit", "Unit Price", "Amount"]}
            rows={lineItems.map((line, index) => ({
              key: line.localId,
              cells: [
                Number(line.quantity || 0).toFixed(2),
                line.description || "No description",
                findCostCodeLabel(line.costCodeId),
                line.unit || "ea",
                `$${Number(line.unitCost || 0).toFixed(2)}`,
                `$${formatMoney(lineTotals[index] ?? 0)}`,
              ],
            }))}
            afterTable={
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <div className={frameStyles.summaryBox}>
                  <div className={frameStyles.summaryRow}>
                    <span>Subtotal</span>
                    <span>${formatMoney(subtotal)}</span>
                  </div>
                  <div className={frameStyles.summaryRow}>
                    <span>Sales Tax ({Number(taxPercent || 0).toFixed(2)}%)</span>
                    <span>${formatMoney(taxAmount)}</span>
                  </div>
                  <div className={`${frameStyles.summaryRow} ${frameStyles.summaryTotal}`}>
                    <span>Total</span>
                    <span>${formatMoney(totalAmount)}</span>
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
          {showDecisionSection ? (
            <div id="estimate-decision" className={`${styles.lifecycle} ${styles.publicDecisionSection}`}>
              <h3>Decision</h3>
              {canDecide && decisionMessage ? <p className={styles.inlineHint}>{decisionMessage}</p> : null}
              {canDecide ? (
                <>
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
                </>
              ) : (
                <p className={styles.inlineHint}>{nonPendingDecisionMessage}</p>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </PublicDocumentViewerShell>
  );
}
