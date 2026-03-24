"use client";

/**
 * Quick expense form — creates a VendorBill with no vendor.
 *
 * Minimal form: store name (combobox with autocomplete), amount (required),
 * payment method, notes (optional). POSTs to `/projects/{id}/expenses/`
 * and calls back on success.
 *
 * Parent: ProjectsConsole, QuickEntryTabs
 */

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { normalizeApiBaseUrl } from "@/features/projects/api";
import styles from "./quick-expense.module.css";

const API_BASE = normalizeApiBaseUrl(
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000/api/v1",
);

type StoreOption = { id: number; name: string };

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
  const [successMessage, setSuccessMessage] = useState("");
  const [lastBillId, setLastBillId] = useState<number | null>(null);

  // Store combobox state
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const storeInputRef = useRef<HTMLInputElement | null>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);

  // Fetch org stores on mount
  useEffect(() => {
    if (!authToken) return;
    fetch(`${API_BASE}/stores/`, {
      headers: buildAuthHeaders(authToken),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (payload?.data) setStores(payload.data);
      })
      .catch(() => {});
  }, [authToken]);

  const needle = storeName.trim().toLowerCase();
  const filteredStores = needle
    ? stores.filter((s) => s.name.toLowerCase().includes(needle))
    : stores;

  // Dismiss suggestions on outside click
  useEffect(() => {
    if (!showSuggestions) return;
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (
        storeInputRef.current?.contains(target) ||
        suggestionsRef.current?.contains(target)
      ) return;
      setShowSuggestions(false);
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [showSuggestions]);

  function selectStore(name: string) {
    setStoreName(name);
    setShowSuggestions(false);
    setHighlightIndex(-1);
  }

  function handleStoreKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions || filteredStores.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => (i < filteredStores.length - 1 ? i + 1 : i));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => (i > 0 ? i - 1 : 0));
    } else if (e.key === "Enter" && highlightIndex >= 0 && filteredStores[highlightIndex]) {
      e.preventDefault();
      selectStore(filteredStores[highlightIndex].name);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setHighlightIndex(-1);
    }
  }

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

    setSuccessMessage("");
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

      const bill = payload.data;
      const label = bill.store_name || "Expense";
      const total = bill.total ? `$${Number(bill.total).toFixed(2)}` : "";
      setSuccessMessage(`${label} ${total} logged and paid.`);
      setLastBillId(bill.id);

      // Refresh store list if a new store was created
      if (bill.store && !stores.some((s) => s.id === bill.store)) {
        setStores((prev) => [...prev, { id: bill.store, name: bill.store_name }]);
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
        <div className={styles.comboboxWrap}>
          <input
            ref={storeInputRef}
            className={styles.input}
            type="text"
            placeholder="e.g. Home Depot"
            value={storeName}
            autoComplete="off"
            onChange={(e) => {
              setStoreName(e.target.value);
              setShowSuggestions(true);
              setHighlightIndex(-1);
            }}
            onFocus={() => {
              if (stores.length > 0) setShowSuggestions(true);
            }}
            onKeyDown={handleStoreKeyDown}
          />
          {showSuggestions && filteredStores.length > 0 && (
            <div ref={suggestionsRef} className={styles.suggestions}>
              {filteredStores.map((store, i) => (
                <button
                  key={store.id}
                  type="button"
                  className={`${styles.suggestion} ${i === highlightIndex ? styles.suggestionActive : ""}`}
                  onMouseEnter={() => setHighlightIndex(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectStore(store.name)}
                >
                  {store.name}
                </button>
              ))}
            </div>
          )}
        </div>
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

      {successMessage && (
        <p className={styles.success}>
          {successMessage}{" "}
          {lastBillId && (
            <Link className={styles.successLink} href={`/projects/${projectId}/bills`}>
              View in Bills &rarr;
            </Link>
          )}
        </p>
      )}
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
