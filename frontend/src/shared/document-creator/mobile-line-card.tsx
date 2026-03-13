/**
 * Mobile line-item card: renders a single line item as a stacked card
 * with labeled fields, replacing the desktop table row at narrow widths.
 */

"use client";

import { type ReactNode, useRef } from "react";
import styles from "./mobile-line-card.module.css";

export type MobileLineField = {
  label: string;
  key: string;
  /** "full" = full-width row, "half" = shares row with next half field. Default "half". */
  span?: "full" | "half";
  /** Optional alignment for the field cell (label + content). */
  align?: "left" | "right";
  render: () => ReactNode;
};

type MobileLineItemCardProps = {
  index: number;
  fields: MobileLineField[];
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDuplicate?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  readOnly?: boolean;
  validationError?: string;
};

export function MobileLineItemCard({
  index,
  fields,
  onRemove,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  isFirst = false,
  isLast = false,
  readOnly = false,
  validationError,
}: MobileLineItemCardProps) {
  // Group fields into rows: full-span fields get their own row,
  // half-span fields are paired into 2-column grids.
  const rows: MobileLineField[][] = [];
  let pendingHalf: MobileLineField | null = null;

  for (const field of fields) {
    if (field.span === "full") {
      if (pendingHalf) {
        rows.push([pendingHalf]);
        pendingHalf = null;
      }
      rows.push([field]);
    } else {
      if (pendingHalf) {
        rows.push([pendingHalf, field]);
        pendingHalf = null;
      } else {
        pendingHalf = field;
      }
    }
  }
  if (pendingHalf) {
    rows.push([pendingHalf]);
  }

  const cardRef = useRef<HTMLDivElement>(null);
  const hasActions = !readOnly && (onRemove || onMoveUp || onMoveDown || onDuplicate);

  /** Call a move callback then scroll this card into view after React re-renders. */
  function handleMove(callback: () => void) {
    callback();
    requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  return (
    <div ref={cardRef} className={`${styles.card} ${validationError ? styles.cardInvalid : ""}`}>
      <span className={styles.cardIndex}>Item {index + 1}</span>

      {rows.map((row) => {
        if (row.length === 1) {
          const field = row[0];
          const alignClass = field.align === "right" ? styles.fieldAlignRight : "";
          return (
            <div key={field.key} className={`${styles.fieldFull} ${alignClass}`.trim()}>
              <span className={styles.fieldLabel}>{field.label}</span>
              {field.render()}
            </div>
          );
        }
        return (
          <div key={`${row[0].key}-${row[1].key}`} className={styles.fieldGrid}>
            {row.map((field) => {
              const alignClass = field.align === "right" ? styles.fieldAlignRight : "";
              return (
                <div key={field.key} className={`${styles.fieldHalf} ${alignClass}`.trim()}>
                  <span className={styles.fieldLabel}>{field.label}</span>
                  {field.render()}
                </div>
              );
            })}
          </div>
        );
      })}

      {validationError ? (
        <p className={styles.validationError}>{validationError}</p>
      ) : null}

      {hasActions ? (
        <div className={styles.cardActions}>
          {(onMoveUp || onMoveDown) ? (
            <div className={styles.moveActions}>
              {onMoveUp ? (
                <button
                  type="button"
                  className={styles.moveButton}
                  onClick={() => handleMove(onMoveUp)}
                  disabled={isFirst}
                  aria-label="Move up"
                >
                  ▲
                </button>
              ) : null}
              {onMoveDown ? (
                <button
                  type="button"
                  className={styles.moveButton}
                  onClick={() => handleMove(onMoveDown)}
                  disabled={isLast}
                  aria-label="Move down"
                >
                  ▼
                </button>
              ) : null}
            </div>
          ) : null}
          <div className={styles.primaryActions}>
            {onDuplicate ? (
              <button
                type="button"
                className={styles.duplicateButton}
                onClick={onDuplicate}
              >
                Duplicate
              </button>
            ) : null}
            {onRemove ? (
              <button
                type="button"
                className={styles.removeButton}
                onClick={onRemove}
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
