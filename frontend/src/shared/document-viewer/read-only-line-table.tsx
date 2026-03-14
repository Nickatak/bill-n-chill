/**
 * ReadOnlyLineTable — polished read-only line-items table for reference data.
 *
 * Used for contract breakdowns (approved estimate lines, approved CO lines)
 * and any other context where line items need to be displayed as a styled,
 * non-editable table with automatic mobile card conversion.
 *
 * Uses internal theme tokens so it works in both light and dark mode.
 */

"use client";

import { type ReactNode } from "react";
import styles from "./read-only-line-table.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReadOnlyLineTableRow = {
  key: string | number;
  cells: ReactNode[];
};

/** Per-column mobile layout hint — mirrors PublicDocumentFrame's MobileColumnHint. */
type MobileColumnHint = {
  order: number;
  span?: "full" | "half";
  align?: "left" | "right";
  hidden?: boolean;
};

type ReadOnlyLineTableProps = {
  /** Optional heading rendered above the table (e.g. "Approved Estimate: ..."). */
  caption?: string;
  /** Column header labels. */
  columns: string[];
  /** Data rows. Each row's `cells` array must match `columns` length. */
  rows: ReadOnlyLineTableRow[];
  /** Message shown when `rows` is empty. */
  emptyMessage?: string;
  /** Optional content rendered below the table (e.g. a totals summary row). */
  afterTable?: ReactNode;
  /** Per-column mobile card layout hints. */
  mobileColumnLayout?: MobileColumnHint[];
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReadOnlyLineTable({
  caption,
  columns,
  rows,
  emptyMessage = "No line items.",
  afterTable,
  mobileColumnLayout,
}: ReadOnlyLineTableProps) {
  return (
    <div className={styles.section}>
      {caption ? <h4 className={styles.caption}>{caption}</h4> : null}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th key={`${column}-${index}`}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.key}>
                  {row.cells.map((cell, index) => {
                    const hint = mobileColumnLayout?.[index];
                    return (
                      <td
                        key={`${row.key}-${index}`}
                        data-label={columns[index]}
                        data-span={hint?.span || "half"}
                        data-align={hint?.align || "left"}
                        data-hidden={hint?.hidden ? "true" : undefined}
                        style={hint ? { order: hint.order } : undefined}
                      >
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length}>
                  <p className={styles.emptyHint}>{emptyMessage}</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {afterTable}
    </div>
  );
}

export type { ReadOnlyLineTableRow, MobileColumnHint as ReadOnlyMobileColumnHint };
export { styles as readOnlyLineTableStyles };
