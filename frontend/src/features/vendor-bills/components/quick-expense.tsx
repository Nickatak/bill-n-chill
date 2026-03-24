"use client";

/**
 * Quick expense form — creates a VendorBill with no vendor.
 *
 * Minimal form: store name (optional), amount (required), notes (optional).
 * POSTs to `/projects/{id}/expenses/` and calls back on success.
 *
 * Parent: ProjectsConsole, QuickEntryTabs
 */

import { FormEvent, useState } from "react";
import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { normalizeApiBaseUrl } from "@/features/projects/api";
import styles from "./quick-expense.module.css";

const API_BASE = normalizeApiBaseUrl(
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000/api/v1",
);

type QuickExpenseProps = {
  projectId: number;
  authToken: string;
  onExpenseCreated?: () => void;
};

export function QuickExpense({
  projectId,
  authToken,
  onExpenseCreated,
}: QuickExpenseProps) {
  const [storeName, setStoreName] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("card");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ amount?: string }>({});

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const trimmed = amount.trim();
    const numericAmount = parseFloat(trimmed);
    if (!trimmed) {
      setFieldErrors({ amount: "Enter an amount." });
      return;
    }
    if (isNaN(numericAmount) || numericAmount <= 0) {
      setFieldErrors({ amount: "Amount must be greater than zero." });
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    try {
      const response = await fetch(
        `${API_BASE}/projects/${projectId}/expenses/`,
        {
          method: "POST",
          headers: {
            ...buildAuthHeaders(authToken),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            store_name: storeName.trim(),
            total: numericAmount.toFixed(2),
            method,
            notes: notes.trim(),
          }),
        },
      );

      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error?.message || "Failed to create expense.");
        return;
      }

      // Reset form
      setStoreName("");
      setAmount("");
      setMethod("card");
      setNotes("");
      onExpenseCreated?.();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.panel} onSubmit={handleSubmit}>
      <h4 className={styles.heading}>Log Expense</h4>

      <label className={styles.fieldLabel}>
        Store / Source
        <input
          className={styles.input}
          type="text"
          placeholder="e.g. Home Depot"
          value={storeName}
          onChange={(e) => setStoreName(e.target.value)}
        />
      </label>

      <label className={styles.fieldLabel}>
        Amount
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

      <label className={styles.fieldLabel}>
        Payment Method
        <select
          className={styles.select}
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          <option value="card">Card</option>
          <option value="check">Check</option>
          <option value="zelle">Zelle</option>
          <option value="ach">ACH</option>
          <option value="cash">Cash</option>
          <option value="wire">Wire</option>
          <option value="other">Other</option>
        </select>
      </label>

      <label className={styles.fieldLabel}>
        Notes
        <textarea
          className={styles.textarea}
          rows={2}
          placeholder="Optional"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>

      {error && <p className={styles.error}>{error}</p>}

      <button
        type="submit"
        className={styles.submitButton}
        disabled={submitting}
      >
        {submitting ? "Saving…" : "Log Expense"}
      </button>
    </form>
  );
}
