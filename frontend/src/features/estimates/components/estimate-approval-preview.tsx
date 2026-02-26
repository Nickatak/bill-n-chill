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
      setDecisionMessage(
        decision === "approve"
          ? "Estimate approved. Thank you."
          : "Estimate rejected. The team has been notified.",
      );
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
          <div className={styles.lifecycle}>
            <h3>Decision</h3>
            <p className={styles.inlineHint}>Approve or reject this estimate. Actions are logged for audit history.</p>
            {decisionMessage ? <p className={styles.inlineHint}>{decisionMessage}</p> : null}
            {!canDecide ? (
              <p className={styles.inlineHint}>
                This estimate is currently <strong>{estimate.status}</strong> and no longer awaiting decision.
              </p>
            ) : null}
            <label className={styles.lifecycleField}>
              Your name (optional)
              <input
                className={styles.fieldInput}
                value={deciderName}
                onChange={(event) => setDeciderName(event.target.value)}
                placeholder="Homeowner name"
                disabled={decisionSubmitting || !canDecide}
              />
            </label>
            <label className={styles.lifecycleField}>
              Your email (optional)
              <input
                className={styles.fieldInput}
                value={deciderEmail}
                onChange={(event) => setDeciderEmail(event.target.value)}
                placeholder="owner@example.com"
                disabled={decisionSubmitting || !canDecide}
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
                disabled={decisionSubmitting || !canDecide}
              />
            </label>
            <div className={styles.lifecycleActions}>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void applyDecision("approve")}
                disabled={decisionSubmitting || !canDecide}
              >
                Approve Estimate
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void applyDecision("reject")}
                disabled={decisionSubmitting || !canDecide}
              >
                Reject Estimate
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
