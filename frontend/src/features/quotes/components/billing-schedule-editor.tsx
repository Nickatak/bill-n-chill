/**
 * BillingScheduleEditor — editable/read-only billing period table.
 *
 * Reusable across quote creator, project overview, and public preview.
 * Periods are project-scoped; dollar amounts are computed from the provided
 * quoteTotal at render time (not stored on the period).
 */
"use client";

import { formatDecimal, parseAmount } from "@/shared/money-format";
import type { BillingPeriodInput } from "../types";
import styles from "./billing-schedule-editor.module.css";

type BillingScheduleEditorProps = {
  periods: BillingPeriodInput[];
  quoteTotal: number;
  readOnly?: boolean;
  onPeriodsChange?: (periods: BillingPeriodInput[]) => void;
  validationError?: string;
};

let nextLocalId = Date.now();

function newPeriod(): BillingPeriodInput {
  return {
    localId: nextLocalId++,
    description: "",
    percent: "",
    dueDate: "",
  };
}

export function BillingScheduleEditor({
  periods,
  quoteTotal,
  readOnly = false,
  onPeriodsChange,
  validationError,
}: BillingScheduleEditorProps) {
  const totalPercent = periods.reduce((sum, p) => sum + parseAmount(p.percent), 0);
  const isValid = Math.abs(totalPercent - 100) < 0.005;

  function updatePeriod(localId: number, field: keyof BillingPeriodInput, value: string) {
    if (!onPeriodsChange) return;
    onPeriodsChange(
      periods.map((p) => (p.localId === localId ? { ...p, [field]: value } : p)),
    );
  }

  function removePeriod(localId: number) {
    if (!onPeriodsChange) return;
    onPeriodsChange(periods.filter((p) => p.localId !== localId));
  }

  function addPeriod() {
    if (!onPeriodsChange) return;
    onPeriodsChange([...periods, newPeriod()]);
  }

  return (
    <div className={styles.wrapper}>
      <p className={styles.sectionLabel}>Payment Schedule</p>

      <div className={styles.table}>
        <div className={`${styles.header} ${readOnly ? styles.headerReadOnly : ""}`}>
          <span className={styles.headerCell}>Description</span>
          <span className={styles.headerCell}>%</span>
          <span className={styles.headerCell}>Due Date</span>
          <span className={styles.headerCell}>Amount</span>
          {!readOnly ? <span className={styles.headerCell} /> : null}
        </div>

        {periods.map((p) => {
          const pct = parseAmount(p.percent);
          const amount = quoteTotal * pct / 100;

          return (
            <div
              key={p.localId}
              className={`${styles.row} ${readOnly ? styles.rowReadOnly : ""}`}
            >
              {readOnly ? (
                <span className={styles.cell}>{p.description || "—"}</span>
              ) : (
                <input
                  className={styles.input}
                  type="text"
                  placeholder="e.g. Upon signing"
                  value={p.description}
                  onChange={(e) => updatePeriod(p.localId, "description", e.target.value)}
                />
              )}

              {readOnly ? (
                <span className={styles.cell}>{p.percent}%</span>
              ) : (
                <input
                  className={styles.input}
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  placeholder="0"
                  value={p.percent}
                  onChange={(e) => updatePeriod(p.localId, "percent", e.target.value)}
                />
              )}

              {readOnly ? (
                <span className={styles.cell}>{p.dueDate || "—"}</span>
              ) : (
                <input
                  className={styles.input}
                  type="date"
                  value={p.dueDate}
                  onChange={(e) => updatePeriod(p.localId, "dueDate", e.target.value)}
                />
              )}

              <span className={styles.computed}>
                ${formatDecimal(amount)}
              </span>

              {!readOnly ? (
                <button
                  type="button"
                  className={styles.removeBtn}
                  onClick={() => removePeriod(p.localId)}
                  title="Remove period"
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}

        <div className={styles.footer}>
          <span className={styles.totalLabel}>
            Total:{" "}
            <span className={`${styles.totalValue} ${!isValid ? styles.totalInvalid : ""}`}>
              {formatDecimal(totalPercent)}%
            </span>
          </span>
          {!readOnly ? (
            <button type="button" className={styles.addBtn} onClick={addPeriod}>
              + Add Period
            </button>
          ) : null}
        </div>
      </div>

      {validationError ? (
        <p className={styles.validationError}>{validationError}</p>
      ) : null}
    </div>
  );
}
