"use client";

import { useEffect, useMemo, useState } from "react";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { EstimateSheet } from "./estimate-sheet";
import styles from "./estimates-console.module.css";
import { ApiResponse, CostCode, EstimateLineInput, EstimateRecord, ProjectRecord } from "../types";
import { formatDateInputFromIso } from "../../../shared/date-format";

type EstimateApprovalPreviewProps = {
  publicToken: string;
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

export function EstimateApprovalPreview({ publicToken }: EstimateApprovalPreviewProps) {
  const [statusMessage, setStatusMessage] = useState("Loading estimate...");
  const [estimate, setEstimate] = useState<EstimateRecord | null>(null);
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [deciderName, setDeciderName] = useState("");
  const [deciderEmail, setDeciderEmail] = useState("");
  const [decisionMessage, setDecisionMessage] = useState("");
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [decisionReceiptName, setDecisionReceiptName] = useState("");

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const lineItems = useMemo(() => mapLineItemsToInputs(estimate), [estimate]);
  const costCodes = useMemo(() => mapLineCostCodes(estimate), [estimate]);
  const estimateDate = formatDateInputFromIso(estimate?.created_at);
  const validThrough = estimate?.valid_through ?? "";

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
  const decisionStatusLabel = estimate?.status
    ? estimate.status.charAt(0).toUpperCase() + estimate.status.slice(1)
    : "Unavailable";
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
        setProject(nextEstimate.project_context ?? null);
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
      setProject(nextEstimate.project_context ?? null);
      setDecisionReceiptName(deciderName.trim());
      setDecisionMessage("");
    } catch {
      setDecisionMessage("Could not reach estimate decision endpoint.");
    } finally {
      setDecisionSubmitting(false);
    }
  }

  return (
    <div className={styles.console}>
      {statusMessage ? <p className={styles.statusMessage}>{statusMessage}</p> : null}

      {estimate ? (
        <>
          <section
            className={`${styles.publicDecisionBanner} ${
              canDecide ? styles.publicDecisionBannerPending : styles.publicDecisionBannerComplete
            }`}
          >
            <div className={styles.publicDecisionBannerBody}>
              <p className={styles.publicDecisionBannerEyebrow}>Decision</p>
              {canDecide ? (
                <p className={styles.publicDecisionBannerText}>
                  Ready to sign? Jump to the decision section and submit your response.
                </p>
              ) : (
                <p className={styles.publicDecisionBannerText}>{nonPendingDecisionMessage}</p>
              )}
            </div>
            {canDecide ? (
              <a href="#estimate-decision" className={styles.publicDecisionBannerLink}>
                Review & Sign
              </a>
            ) : null}
          </section>
          <EstimateSheet
            project={project}
            estimateId={String(estimate.id)}
            estimateTitle={estimate.title || "Untitled"}
            estimateDate={estimateDate}
            validThrough={validThrough}
            termsText={estimate.terms_text || ""}
            taxPercent={taxPercent}
            lineItems={lineItems}
            lineTotals={lineTotals}
            subtotal={subtotal}
            taxAmount={taxAmount}
            totalAmount={totalAmount}
            costCodes={costCodes}
            canSubmit={false}
            isSubmitting={false}
            isEditingDraft={false}
            readOnly
            readOnlyPresentation="text"
            showMarkupColumn={false}
            titlePresentation="header"
            lineSortKey={null}
            lineSortDirection="asc"
            onTitleChange={() => undefined}
            onValidThroughChange={() => undefined}
            onTaxPercentChange={() => undefined}
            onLineItemChange={() => undefined}
            onAddLineItem={() => undefined}
            onMoveLineItem={() => undefined}
            onDuplicateLineItem={() => undefined}
            onRemoveLineItem={() => undefined}
            onSortLineItems={() => undefined}
            onSubmit={(event) => event.preventDefault()}
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
    </div>
  );
}
