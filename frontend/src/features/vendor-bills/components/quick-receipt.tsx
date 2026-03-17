"use client";

/**
 * Standalone quick receipt form for recording receipts against a project.
 *
 * Fetches active vendors on mount and provides a combobox for optional vendor
 * selection. Submits a receipt-kind vendor bill to the project's bills endpoint.
 */

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useCombobox } from "@/shared/hooks/use-combobox";
import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { todayDateInput } from "@/shared/date-format";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import type { VendorRecord } from "../types";
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

  const [vendors, setVendors] = useState<VendorRecord[]>([]);
  const [receiptTotal, setReceiptTotal] = useState("");
  const [receiptVendorId, setReceiptVendorId] = useState("");
  const [receiptDate, setReceiptDate] = useState(todayDateInput());
  const [receiptNotes, setReceiptNotes] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");

  const activeVendors = useMemo(() => vendors.filter((v) => v.is_active), [vendors]);

  const commitVendor = useCallback((vendor: VendorRecord | null) => {
    setReceiptVendorId(vendor ? String(vendor.id) : "");
    vendorCombobox.close(!!vendor);
    if (vendor) vendorCombobox.setQuery(vendor.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const vendorCombobox = useCombobox<VendorRecord>({
    items: activeVendors,
    getLabel: (v) => v.name,
    onCommit: commitVendor,
    syntheticPrefixCount: 1,
  });

  const selectedVendor = useMemo(
    () => vendors.find((v) => String(v.id) === receiptVendorId) ?? null,
    [vendors, receiptVendorId],
  );

  // Fetch vendors on mount
  useEffect(() => {
    if (!token) return;
    async function loadVendors() {
      try {
        const response = await fetch(`${normalizedBaseUrl}/vendors/`, {
          headers: buildAuthHeaders(token),
        });
        const payload: ApiResponse = await response.json();
        if (response.ok && Array.isArray(payload.data)) {
          setVendors(payload.data as VendorRecord[]);
        }
      } catch {
        // Silently fail — vendor list will be empty.
      }
    }
    void loadVendors();
  }, [token, normalizedBaseUrl]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const totalNum = parseFloat(receiptTotal);
    if (!totalNum || totalNum <= 0) {
      setMessage("Enter a total amount.");
      setMessageTone("error");
      return;
    }

    try {
      const body: Record<string, unknown> = {
        kind: "receipt",
        total: receiptTotal,
        received_date: receiptDate || undefined,
        notes: receiptNotes || undefined,
      };
      if (receiptVendorId) body.vendor = Number(receiptVendorId);

      const response = await fetch(
        `${normalizedBaseUrl}/projects/${projectId}/vendor-bills/`,
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
      setReceiptTotal("");
      setReceiptVendorId("");
      vendorCombobox.setQuery("");
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
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Vendor</span>
          <div className={styles.combobox}>
            <div className={styles.comboboxInputWrap}>
              <input
                ref={vendorCombobox.inputRef}
                className={styles.comboboxInput}
                role="combobox"
                aria-expanded={vendorCombobox.isOpen}
                aria-controls="quick-receipt-vendor-listbox"
                value={vendorCombobox.isOpen ? vendorCombobox.query : (selectedVendor?.name ?? "")}
                placeholder="Search vendors..."
                onFocus={() => vendorCombobox.open(selectedVendor?.name ?? "")}
                onChange={(e) => {
                  vendorCombobox.handleInput(e.target.value);
                  if (receiptVendorId) setReceiptVendorId("");
                }}
                onKeyDown={vendorCombobox.handleKeyDown}
                autoComplete="off"
              />
              {receiptVendorId ? (
                <button
                  type="button"
                  className={styles.comboboxClear}
                  aria-label="Clear vendor"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commitVendor(null)}
                >&times;</button>
              ) : (
                <button
                  type="button"
                  className={styles.comboboxClear}
                  aria-label="Open vendor list"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { vendorCombobox.inputRef.current?.focus(); vendorCombobox.open(""); }}
                >&#9662;</button>
              )}
            </div>
            {vendorCombobox.isOpen ? (
              <div ref={vendorCombobox.menuRef} id="quick-receipt-vendor-listbox" className={styles.comboboxMenu} role="listbox">
                <button
                  type="button"
                  role="option"
                  aria-selected={!receiptVendorId}
                  className={`${styles.comboboxOption} ${vendorCombobox.highlightIndex === 0 ? styles.comboboxOptionActive : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => vendorCombobox.setHighlightIndex(0)}
                  onClick={() => commitVendor(null)}
                >None</button>
                {vendorCombobox.filteredItems.map((v, i) => (
                  <button
                    key={v.id}
                    type="button"
                    role="option"
                    aria-selected={String(v.id) === receiptVendorId}
                    className={`${styles.comboboxOption} ${vendorCombobox.highlightIndex === i + 1 ? styles.comboboxOptionActive : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => vendorCombobox.setHighlightIndex(i + 1)}
                    onClick={() => commitVendor(v)}
                  >{v.name}</button>
                ))}
                {vendorCombobox.filteredItems.length === 0 && vendorCombobox.query.trim() ? (
                  <div className={styles.comboboxNoResults}>No matching vendors.</div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Amount *</span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={receiptTotal}
            onChange={(e) => setReceiptTotal(e.target.value)}
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
