"use client";

/**
 * Inline deposit invoice panel for the projects page action area.
 *
 * Allows the user to create a deposit invoice tied to an approved estimate
 * without leaving the project hub. On success, calls back with the new
 * invoice so the parent can pivot to the payment recorder.
 *
 * Parent: ProjectsConsole
 */

import { FormEvent, useState } from "react";
import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { formatCurrency } from "@/shared/money-format";
import { parseMoneyValue } from "../utils/project-helpers";
import type { ApprovedEstimate } from "../types";
import styles from "./deposit-panel.module.css";

type DepositInvoice = {
  id: number;
  invoice_number: string;
  balance_due: string;
};

type DepositPanelProps = {
  projectId: number;
  approvedEstimates: ApprovedEstimate[];
  /** Set of estimate IDs that already have a non-void linked invoice. */
  linkedEstimateIds: Set<number>;
  onInvoiceCreated: (invoice: DepositInvoice) => void;
};

export function DepositPanel({
  projectId,
  approvedEstimates,
  linkedEstimateIds,
  onInvoiceCreated,
}: DepositPanelProps) {
  const { token: authToken } = useSharedSessionAuth();
  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);

  const availableEstimates = approvedEstimates.filter(
    (est) => !linkedEstimateIds.has(est.id),
  );

  const [selectedEstimateId, setSelectedEstimateId] = useState<string>(
    availableEstimates.length === 1 ? String(availableEstimates[0].id) : "",
  );
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ estimate?: string; amount?: string }>({});

  const selectedEstimate = approvedEstimates.find(
    (est) => String(est.id) === selectedEstimateId,
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const errors: { estimate?: string; amount?: string } = {};

    if (!selectedEstimateId) {
      errors.estimate = "Select an estimate.";
    }
    const trimmed = amount.trim();
    const numericAmount = parseFloat(trimmed);
    if (!trimmed) {
      errors.amount = "Enter a deposit amount.";
    } else if (isNaN(numericAmount) || numericAmount <= 0) {
      errors.amount = "Amount must be greater than zero.";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    try {
      const estimateLabel = selectedEstimate?.title || `Estimate #${selectedEstimateId}`;
      const response = await fetch(
        `${normalizedBaseUrl}/projects/${projectId}/invoices/`,
        {
          method: "POST",
          headers: {
            ...buildAuthHeaders(authToken),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            related_estimate: Number(selectedEstimateId),
            initial_status: "sent",
            line_items: [
              {
                description: `Deposit for ${estimateLabel}`,
                quantity: "1",
                unit: "ea",
                unit_price: numericAmount.toFixed(2),
              },
            ],
          }),
        },
      );

      const payload = await response.json();
      if (!response.ok) {
        const msg =
          payload?.error?.message || "Failed to create deposit invoice.";
        setError(msg);
        return;
      }

      const invoice = payload.data as DepositInvoice;
      onInvoiceCreated(invoice);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (availableEstimates.length === 0) {
    const reason = approvedEstimates.length === 0
      ? "No approved estimates on this project."
      : "All approved estimates already have a linked invoice.";
    return (
      <div className={styles.panel}>
        <p className={styles.emptyMessage}>{reason}</p>
      </div>
    );
  }

  return (
    <form className={styles.panel} onSubmit={handleSubmit}>
      <h4 className={styles.heading}>Create Deposit Invoice</h4>

      <label className={styles.fieldLabel}>
        Estimate
        <select
          className={`${styles.select} ${fieldErrors.estimate ? styles.inputError : ""}`}
          value={selectedEstimateId}
          onChange={(e) => {
            setSelectedEstimateId(e.target.value);
            setFieldErrors((prev) => ({ ...prev, estimate: undefined }));
          }}
        >
          <option value="" disabled>
            Select estimate…
          </option>
          {availableEstimates.map((est) => (
            <option key={est.id} value={String(est.id)}>
              {est.title || `Estimate #${est.id}`} —{" "}
              {formatCurrency(parseMoneyValue(est.grand_total))}
            </option>
          ))}
        </select>
        {fieldErrors.estimate && (
          <span className={styles.fieldError}>{fieldErrors.estimate}</span>
        )}
      </label>

      <label className={styles.fieldLabel}>
        Deposit Amount
        <input
          className={`${styles.input} ${fieldErrors.amount ? styles.inputError : ""}`}
          type="number"
          step="0.01"
          min="0.01"
          placeholder="0.00"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setFieldErrors((prev) => ({ ...prev, amount: undefined }));
          }}
        />
        {fieldErrors.amount && (
          <span className={styles.fieldError}>{fieldErrors.amount}</span>
        )}
      </label>

      {selectedEstimate && (
        <p className={styles.hint}>
          Estimate total: {formatCurrency(parseMoneyValue(selectedEstimate.grand_total))}
        </p>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <button
        type="submit"
        className={styles.submitButton}
        disabled={submitting}
      >
        {submitting ? "Creating…" : "Create & Send Invoice"}
      </button>
    </form>
  );
}
