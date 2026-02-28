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
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Join class name fragments, filtering out falsy values. */
function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

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
    root: cx(styles.viewer, overrides?.root),
    statusMessage: cx(styles.statusMessage, overrides?.statusMessage),
    banner: cx(styles.banner, overrides?.banner),
    bannerPending: cx(styles.bannerPending, overrides?.bannerPending),
    bannerComplete: cx(styles.bannerComplete, overrides?.bannerComplete),
    bannerBody: cx(styles.bannerBody, overrides?.bannerBody),
    bannerEyebrow: cx(styles.bannerEyebrow, overrides?.bannerEyebrow),
    bannerText: cx(styles.bannerText, overrides?.bannerText),
    bannerLink: cx(styles.bannerLink, overrides?.bannerLink),
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
                rows.map((row) => (
                  <tr key={row.key}>
                    {row.cells.map((cell, index) => (
                      <td key={`${row.key}-${index}`}>{cell}</td>
                    ))}
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
      </section>

      {afterLineSection}
      {footer}
    </section>
  );
}

export { styles as publicDocumentFrameStyles };
