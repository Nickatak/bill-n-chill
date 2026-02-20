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

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

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

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const lineItems = useMemo(() => mapLineItemsToInputs(estimate), [estimate]);
  const costCodes = useMemo(() => mapLineCostCodes(estimate), [estimate]);
  const estimateDate = formatDateInputFromIso(estimate?.created_at);
  const dueDate = useMemo(() => {
    if (!estimateDate) {
      return "";
    }
    const parsed = new Date(estimateDate);
    if (Number.isNaN(parsed.getTime())) {
      return "";
    }
    parsed.setDate(parsed.getDate() + 14);
    return formatDateInput(parsed);
  }, [estimateDate]);

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
            dueDate={dueDate}
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
            showReadOnlyHint={false}
            readOnlyPresentation="text"
            showMarkupColumn={false}
            titlePresentation="header"
            lineSortKey={null}
            lineSortDirection="asc"
            onTitleChange={() => undefined}
            onDueDateChange={() => undefined}
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
            <p className={styles.inlineHint}>
              Approval/decline is not wired yet. These buttons are preview-only and will remain
              inactive for now.
            </p>
            <div className={styles.lifecycleActions}>
              <button type="button" className={styles.primaryButton}>
                Approve Estimate
              </button>
              <button type="button" className={styles.secondaryButton}>
                Decline Estimate
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
