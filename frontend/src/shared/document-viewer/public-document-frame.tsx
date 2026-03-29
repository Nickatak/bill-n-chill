/**
 * Structural frame for public-facing document pages (invoices, estimates, change orders).
 *
 * Provides the card layout shared by all public document types: a two-column
 * header (sender/recipient on the left, document identity on the right),
 * a titled line-items table, and optional after-table/footer slots.
 *
 * Also exports a `publicDocumentViewerClassNames` factory and the raw
 * CSS module styles so consumers can merge overrides without importing the
 * module directly.
 */

"use client";

import { ReactNode } from "react";
import { joinClassNames } from "../utils/class-names";
import styles from "./public-document-frame.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Class name map consumed by `PublicDocumentViewerShell`. */
type PublicDocumentViewerClassNames = {
  root: string;
  statusMessage: string;
  banner: string;
  bannerPending: string;
  bannerComplete: string;
  bannerBody: string;
  bannerEyebrow: string;
  bannerText: string;
  bannerLink: string;
};

/** A single row in the document line-items table. */
type PublicDocumentTableRow = {
  key: string | number;
  cells: ReactNode[];
  /**
   * Full-width row variant. Only `cells[0]` is rendered in a single
   * `<td colSpan>`. Used for section dividers in sectioned documents.
   */
  variant?: "section-header" | "section-subtotal";
};

/** Per-column mobile card layout hint. One entry per column index. */
type MobileColumnHint = {
  /** Visual order within the card grid (lower = earlier). */
  order: number;
  /** "full" spans the full card width, "half" shares a row. Default "half". */
  span?: "full" | "half";
  /** Right-align this field's value. Default "left". */
  align?: "left" | "right";
  /** Hide this column on mobile. Default false. */
  hidden?: boolean;
};

type PublicDocumentFrameProps = {
  headerLeft: ReactNode;
  headerRight: ReactNode;
  lineTitle: string;
  columns: string[];
  rows: PublicDocumentTableRow[];
  emptyMessage?: string;
  afterTable?: ReactNode;
  afterLineSection?: ReactNode;
  footer?: ReactNode;
  /** Optional per-column mobile layout hints (order, span, alignment). */
  mobileColumnLayout?: MobileColumnHint[];
};

// ---------------------------------------------------------------------------
// Class name factory
// ---------------------------------------------------------------------------

/**
 * Build a complete `PublicDocumentViewerClassNames` map by merging the
 * frame's base CSS module classes with optional per-document overrides.
 *
 * This lets each document type (invoice, estimate, change order) layer
 * additional styling without duplicating the base class structure.
 */
export function publicDocumentViewerClassNames(
  overrides?: Partial<PublicDocumentViewerClassNames>,
): PublicDocumentViewerClassNames {
  return {
    root: joinClassNames(styles.viewer, overrides?.root),
    statusMessage: joinClassNames(styles.statusMessage, overrides?.statusMessage),
    banner: joinClassNames(styles.banner, overrides?.banner),
    bannerPending: joinClassNames(styles.bannerPending, overrides?.bannerPending),
    bannerComplete: joinClassNames(styles.bannerComplete, overrides?.bannerComplete),
    bannerBody: joinClassNames(styles.bannerBody, overrides?.bannerBody),
    bannerEyebrow: joinClassNames(styles.bannerEyebrow, overrides?.bannerEyebrow),
    bannerText: joinClassNames(styles.bannerText, overrides?.bannerText),
    bannerLink: joinClassNames(styles.bannerLink, overrides?.bannerLink),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Render the standard document card frame used by all public viewer pages.
 *
 * Layout order:
 * 1. Two-column header (party info + document identity)
 * 2. Line-items section with column headers, data rows, and empty state
 * 3. Optional after-table content (e.g. totals summary)
 * 4. Optional after-line-section content (e.g. terms & conditions)
 * 5. Optional footer (e.g. action buttons)
 */
export function PublicDocumentFrame({
  headerLeft,
  headerRight,
  lineTitle,
  columns,
  rows,
  emptyMessage = "No line items available.",
  afterTable,
  afterLineSection,
  footer,
  mobileColumnLayout,
}: PublicDocumentFrameProps) {
  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <div className={styles.partyColumn}>{headerLeft}</div>
        <div className={styles.identityColumn}>{headerRight}</div>
      </header>

      <section className={styles.lineSection}>
        <h3 className={styles.lineHeading}>{lineTitle}</h3>
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
                rows.map((row) => {
                  if (row.variant) {
                    return (
                      <tr key={row.key} data-variant={row.variant}>
                        <td colSpan={columns.length}>{row.cells[0]}</td>
                      </tr>
                    );
                  }
                  return (
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
                  );
                })
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
      </section>

      {afterLineSection}
      {footer}
    </section>
  );
}

export type { MobileColumnHint };
export { styles as publicDocumentFrameStyles };
