"use client";

import { ReactNode } from "react";
import styles from "./public-document-frame.module.css";

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

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

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
