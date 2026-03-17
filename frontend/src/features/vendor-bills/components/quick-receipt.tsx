"use client";

/**
 * Standalone quick receipt form for recording expenses against a project.
 *
 * Posts to the receipts endpoint with a free-text store name.
 * Receipts are standalone expense records with direct payment ownership —
 * not bills. See docs/decisions/receipt-vendor-separation.md.
 */

import { FormEvent, useState } from "react";
import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { todayDateInput } from "@/shared/date-format";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import styles from "./quick-receipt.module.css";

type ApiResponse = {
  data?: unknown;
  error?: { code?: string; message?: string };
};

type QuickReceiptProps = {
  projectId: number;
  token: string;
  onReceiptCreated?: () => void;
};

export function QuickReceipt({ projectId, token, onReceiptCreated }: QuickReceiptProps) {
  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);

  const [storeName, setStoreName] = useState("");
  const [receiptAmount, setReceiptAmount] = useState("");
  const [receiptDate, setReceiptDate] = useState(todayDateInput());
  const [receiptNotes, setReceiptNotes] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amountNum = parseFloat(receiptAmount);
    if (!amountNum || amountNum <= 0) {
      setMessage("Enter an amount.");
      setMessageTone("error");
      return;
    }

    try {
      const body: Record<string, unknown> = {
        amount: receiptAmount,
        receipt_date: receiptDate || undefined,
        notes: receiptNotes || undefined,
      };
      if (storeName.trim()) body.store_name = storeName.trim();

      const response = await fetch(
        `${normalizedBaseUrl}/projects/${projectId}/receipts/`,
        {
          method: "POST",
          headers: buildAuthHeaders(token, { contentType: "application/json" }),
          body: JSON.stringify(body),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        const msg = payload.error?.message ?? "Failed to record receipt.";
        setMessage(msg);
        setMessageTone("error");
        return;
      }

      // Reset form
      setStoreName("");
      setReceiptAmount("");
      setReceiptDate(todayDateInput());
      setReceiptNotes("");
      setMessage("Receipt recorded.");
      setMessageTone("success");

      onReceiptCreated?.();
    } catch {
      setMessage("Network error recording receipt.");
      setMessageTone("error");
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Store</span>
          <input
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            placeholder="e.g. Home Depot"
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Amount *</span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={receiptAmount}
            onChange={(e) => setReceiptAmount(e.target.value)}
            placeholder="0.00"
            required
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Date</span>
          <input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Notes</span>
          <input value={receiptNotes} onChange={(e) => setReceiptNotes(e.target.value)} placeholder="Optional" />
        </label>
        <div className={styles.submitRow}>
          <button type="submit" className={styles.submit}>Record Receipt</button>
          {message ? (
            <p className={`${styles.message} ${
              messageTone === "success" ? styles.messageSuccess : styles.messageError
            }`}>
              {message}
            </p>
          ) : null}
        </div>
      </div>
    </form>
  );
}
