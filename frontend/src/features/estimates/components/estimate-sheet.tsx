import { FormEvent } from "react";

import styles from "./estimates-console.module.css";
import { CostCode, EstimateLineInput, ProjectRecord } from "../types";

type LineSortKey = "quantity" | "costCode" | "unitCost" | "markupPercent" | "amount";

type EstimateSheetProps = {
  project: ProjectRecord | null;
  estimateId: string;
  estimateTitle: string;
  estimateDate: string;
  dueDate: string;
  taxPercent: string;
  lineItems: EstimateLineInput[];
  lineTotals: number[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  costCodes: CostCode[];
  canSubmit: boolean;
  isSubmitting: boolean;
  isEditingDraft: boolean;
  readOnly: boolean;
  showReadOnlyHint?: boolean;
  readOnlyPresentation?: "inputs" | "text";
  showMarkupColumn?: boolean;
  titlePresentation?: "field" | "header";
  lineSortKey: LineSortKey | null;
  lineSortDirection: "asc" | "desc";
  onTitleChange: (value: string) => void;
  onDueDateChange: (value: string) => void;
  onTaxPercentChange: (value: string) => void;
  onLineItemChange: (
    localId: number,
    key: keyof Omit<EstimateLineInput, "localId">,
    value: string,
  ) => void;
  onAddLineItem: () => void;
  onMoveLineItem: (localId: number, direction: "up" | "down") => void;
  onDuplicateLineItem: (localId: number) => void;
  onRemoveLineItem: (localId: number) => void;
  onSortLineItems: (key: LineSortKey) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function formatMoney(value: number): string {
  return value.toFixed(2);
}

export function EstimateSheet({
  project,
  estimateId,
  estimateTitle,
  estimateDate,
  dueDate,
  taxPercent,
  lineItems,
  lineTotals,
  subtotal,
  taxAmount,
  totalAmount,
  costCodes,
  canSubmit,
  isSubmitting,
  isEditingDraft,
  readOnly,
  showReadOnlyHint = true,
  readOnlyPresentation = "inputs",
  showMarkupColumn = true,
  titlePresentation = "field",
  lineSortKey,
  lineSortDirection,
  onTitleChange,
  onDueDateChange,
  onTaxPercentChange,
  onLineItemChange,
  onAddLineItem,
  onMoveLineItem,
  onDuplicateLineItem,
  onRemoveLineItem,
  onSortLineItems,
  onSubmit,
}: EstimateSheetProps) {
  const customerName = (project?.customer_display_name || "Customer name").trim();
  const rawBillingAddress = (project?.customer_billing_address || "").trim();
  const isExistingEstimate = Boolean(estimateId);
  const titleReadOnly = readOnly || isExistingEstimate;
  const mailingLines = rawBillingAddress
    ? rawBillingAddress
        .replace(/\s*,\s*/g, "\n")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : ["Customer address"];
  const sortIndicator = lineSortDirection === "asc" ? "▲" : "▼";
  const showReadOnlyText = readOnly && readOnlyPresentation === "text";

  function formatDisplayDate(value: string): string {
    if (!value) {
      return "Not set";
    }
    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(parsed);
  }

  function findCostCodeLabel(costCodeId: string): string {
    const code = costCodes.find((candidate) => String(candidate.id) === costCodeId);
    if (!code) {
      return costCodeId || "Not set";
    }
    return `${code.code} - ${code.name}`;
  }

  function renderSortableHeader(label: string, key: LineSortKey) {
    if (showReadOnlyText) {
      return <span>{label}</span>;
    }
    const isActive = lineSortKey === key;
    return (
      <button
        type="button"
        className={`${styles.lineHeaderButton} ${
          isActive ? styles.lineHeaderButtonActive : ""
        } ${readOnly ? styles.actionDisabled : ""}`}
        onClick={() => onSortLineItems(key)}
        disabled={readOnly}
      >
        <span>{label}</span>
        <span className={styles.sortIndicator}>{isActive ? sortIndicator : "↕"}</span>
      </button>
    );
  }

  return (
    <form className={`${styles.sheet} ${readOnly ? styles.sheetReadOnly : ""}`} onSubmit={onSubmit}>
      <div className={styles.sheetHeader}>
        <div className={styles.fromBlock}>
          <span className={styles.blockLabel}>From</span>
          <p className={styles.blockText}>Your Company</p>
          <p className={styles.blockMuted}>Your Address 1234</p>
          <p className={styles.blockMuted}>City, ST 12345</p>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.logoBox}>Upload Logo</div>
          {titlePresentation === "header" ? (
            <div className={styles.sheetTitleValue}>{estimateTitle || "Untitled"}</div>
          ) : (
            <div className={styles.sheetTitle}>Estimate</div>
          )}
        </div>
      </div>

      <div className={styles.partyGrid}>
        <div className={styles.toBlock}>
          <span className={styles.blockLabel}>To</span>
          <p className={styles.blockText}>{customerName}</p>
          {mailingLines.map((line, index) => (
            <p key={`${line}-${index}`} className={styles.blockMuted}>
              {line}
            </p>
          ))}
        </div>

        <div className={styles.metaBlock}>
          {titlePresentation !== "header" ? (
            <>
              <div className={styles.metaTitle}>Estimate Details</div>
              <label className={styles.inlineField}>
                Estimate title
                {showReadOnlyText ? (
                  <span className={styles.staticFieldInlineValue}>{estimateTitle || "Untitled"}</span>
                ) : (
                  <input
                    className={styles.fieldInput}
                    value={estimateTitle}
                    onChange={(event) => onTitleChange(event.target.value)}
                    disabled={titleReadOnly}
                    aria-disabled={titleReadOnly}
                    required
                  />
                )}
              </label>
            </>
          ) : null}
          <div className={styles.metaLine}>
            <span>Estimate #</span>
            <span>{estimateId ? `#${estimateId}` : "Draft"}</span>
          </div>
          <div className={styles.metaLine}>
            <span>Estimate date</span>
            {showReadOnlyText ? (
              <span className={styles.staticMetaValue}>{formatDisplayDate(estimateDate)}</span>
            ) : (
              <input
                className={styles.fieldInput}
                type="date"
                value={estimateDate}
                disabled
                aria-disabled="true"
              />
            )}
          </div>
          <div className={styles.metaLine}>
            <span>Due date</span>
            {showReadOnlyText ? (
              <span className={styles.staticMetaValue}>{formatDisplayDate(dueDate)}</span>
            ) : (
              <input
                className={styles.fieldInput}
                type="date"
                value={dueDate}
                onChange={(event) => onDueDateChange(event.target.value)}
                disabled={readOnly}
                aria-disabled={readOnly}
              />
            )}
          </div>
        </div>
      </div>

      {costCodes.length === 0 ? (
        <p className={styles.inlineHint}>
          Cost codes are required for line items. Create them on the Cost Codes page.
        </p>
      ) : null}

      <div className={styles.lineTable}>
        <div
          className={`${styles.lineHeader} ${readOnly ? styles.lineHeaderReadOnly : ""} ${
            readOnly && !showMarkupColumn ? styles.lineHeaderNoMarkup : ""
          }`}
        >
          <div className={styles.lineHeaderCell}>{renderSortableHeader("Qty", "quantity")}</div>
          <div className={styles.lineHeaderCell}>
            <span>Description</span>
          </div>
          <div className={styles.lineHeaderCell}>{renderSortableHeader("Cost Code", "costCode")}</div>
          <div className={styles.lineHeaderCell}>
            <span>Unit</span>
          </div>
          <div className={styles.lineHeaderCell}>
            {renderSortableHeader("Unit Price", "unitCost")}
          </div>
          {showMarkupColumn ? (
            <div className={styles.lineHeaderCell}>
              {renderSortableHeader("Markup", "markupPercent")}
            </div>
          ) : null}
          <div className={styles.lineHeaderCell}>{renderSortableHeader("Amount", "amount")}</div>
          {!readOnly ? (
            <div className={styles.lineHeaderCell}>
              <span>Actions</span>
            </div>
          ) : null}
        </div>
        {lineItems.map((line, index) => (
          <div
            key={line.localId}
            className={`${styles.lineRow} ${readOnly ? styles.lineRowReadOnly : ""} ${
              readOnly && !showMarkupColumn ? styles.lineRowNoMarkup : ""
            }`}
          >
            <div className={styles.lineCell}>
              {showReadOnlyText ? (
                <span className={styles.staticCellValue}>{line.quantity || "0"}</span>
              ) : (
                <input
                  className={styles.lineInput}
                  aria-label="Quantity"
                  value={line.quantity}
                  onChange={(event) => onLineItemChange(line.localId, "quantity", event.target.value)}
                  inputMode="decimal"
                  disabled={readOnly}
                  aria-disabled={readOnly}
                  required
                />
              )}
            </div>
            <div className={styles.lineCell}>
              {showReadOnlyText ? (
                <span className={styles.staticCellValue}>{line.description || "No description"}</span>
              ) : (
                <input
                  className={styles.lineInput}
                  aria-label="Description"
                  value={line.description}
                  onChange={(event) => onLineItemChange(line.localId, "description", event.target.value)}
                  disabled={readOnly}
                  aria-disabled={readOnly}
                  required
                />
              )}
            </div>
            <div className={styles.lineCell}>
              {showReadOnlyText ? (
                <span className={styles.staticCellValue}>{findCostCodeLabel(line.costCodeId)}</span>
              ) : (
                <select
                  className={styles.lineSelect}
                  aria-label="Cost code"
                  value={line.costCodeId}
                  onChange={(event) =>
                    onLineItemChange(line.localId, "costCodeId", event.target.value)
                  }
                  disabled={readOnly}
                  required
                >
                  <option value="">Select</option>
                  {costCodes.map((code) => (
                    <option key={code.id} value={code.id}>
                      {code.code} - {code.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className={styles.lineCell}>
              {showReadOnlyText ? (
                <span className={styles.staticCellValue}>{line.unit || "ea"}</span>
              ) : (
                <input
                  className={styles.lineInput}
                  aria-label="Unit"
                  value={line.unit}
                  onChange={(event) => onLineItemChange(line.localId, "unit", event.target.value)}
                  disabled={readOnly}
                  aria-disabled={readOnly}
                  required
                />
              )}
            </div>
            <div className={styles.lineCell}>
              {showReadOnlyText ? (
                <span className={styles.staticCellValue}>
                  {/* Displaying markup inside unit price is equivalent to applying markup on the line total. */}
                  $
                  {formatMoney(
                    Number(line.unitCost || 0) * (1 + Number(line.markupPercent || 0) / 100),
                  )}
                </span>
              ) : (
                <input
                  className={styles.lineInput}
                  aria-label="Unit cost"
                  value={line.unitCost}
                  onChange={(event) => onLineItemChange(line.localId, "unitCost", event.target.value)}
                  inputMode="decimal"
                  disabled={readOnly}
                  aria-disabled={readOnly}
                  required
                />
              )}
            </div>
            {showMarkupColumn ? (
              <div className={styles.lineCell}>
                {showReadOnlyText ? (
                  <span className={styles.staticCellValue}>{line.markupPercent || "0"}%</span>
                ) : (
                  <div className={styles.percentField}>
                    <input
                      className={styles.lineInput}
                      aria-label="Markup percent"
                      value={line.markupPercent}
                      onChange={(event) =>
                        onLineItemChange(line.localId, "markupPercent", event.target.value)
                      }
                      inputMode="decimal"
                      disabled={readOnly}
                      aria-disabled={readOnly}
                      required
                    />
                    <span className={styles.percentSuffix}>%</span>
                  </div>
                )}
              </div>
            ) : null}
            <div className={styles.lineCell}>
              <div className={styles.amountCell}>${formatMoney(lineTotals[index] || 0)}</div>
            </div>
            {!readOnly ? (
              <div className={styles.lineCell}>
                <div className={styles.lineActionsCell}>
                  <button
                    type="button"
                    className={`${styles.smallButton} ${
                      readOnly || index === 0 ? styles.actionDisabled : ""
                    }`}
                    onClick={() => onMoveLineItem(line.localId, "up")}
                    disabled={readOnly || index === 0}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    className={`${styles.smallButton} ${
                      readOnly || index === lineItems.length - 1 ? styles.actionDisabled : ""
                    }`}
                    onClick={() => onMoveLineItem(line.localId, "down")}
                    disabled={readOnly || index === lineItems.length - 1}
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    className={`${styles.smallButton} ${readOnly ? styles.actionDisabled : ""}`}
                    onClick={() => onDuplicateLineItem(line.localId)}
                    disabled={readOnly}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className={`${styles.removeButton} ${readOnly ? styles.actionDisabled : ""}`}
                    onClick={() => onRemoveLineItem(line.localId)}
                    disabled={readOnly}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {!showReadOnlyText ? (
        <div className={styles.lineActions}>
          <button
            type="button"
            className={`${styles.secondaryButton} ${readOnly ? styles.actionDisabled : ""}`}
            onClick={onAddLineItem}
            disabled={readOnly}
          >
            Add Line Item
          </button>
        </div>
      ) : null}

      {readOnly && showReadOnlyHint ? (
        <p className={styles.readOnlyHint}>Read-only estimate. Clone or add new to edit.</p>
      ) : null}

      <div className={styles.summary}>
        <div className={styles.summaryRow}>
          <span>Subtotal</span>
          <span>${formatMoney(subtotal)}</span>
        </div>
        <div className={styles.summaryRow}>
          <span>{showReadOnlyText ? `Sales Tax (${taxPercent}%)` : "Sales Tax"}</span>
          <div className={styles.summaryTaxLine}>
            {showReadOnlyText ? null : (
              <span className={styles.summaryTaxRate}>
                <input
                  className={styles.summaryTaxInput}
                  value={taxPercent}
                  onChange={(event) => onTaxPercentChange(event.target.value)}
                  inputMode="decimal"
                  aria-label="Sales tax percent"
                  disabled={readOnly}
                  aria-disabled={readOnly}
                />
                <span className={styles.summaryTaxSuffix}>%</span>
              </span>
            )}
            <span className={styles.summaryTaxAmount}>${formatMoney(taxAmount)}</span>
          </div>
        </div>
        <div className={`${styles.summaryRow} ${styles.summaryTotal}`}>
          <span>Total</span>
          <span>${formatMoney(totalAmount)}</span>
        </div>
      </div>
      {!readOnly ? (
        <div className={styles.finalizeActions}>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={!canSubmit || isSubmitting}
          >
            {isSubmitting
              ? isEditingDraft
                ? "Saving..."
                : "Creating..."
              : isEditingDraft
                ? "Save Draft Changes"
                : "Create Estimate"}
          </button>
        </div>
      ) : null}

      <div className={styles.terms}>
        <h4>Terms and Conditions</h4>
        <p>Payment is due within 14 days of project completion.</p>
        <p>All checks to be made out to __________________.</p>
        <p>Thank you for your business.</p>
      </div>

      <div className={styles.footer}>
        <span>Tel: +1 234 567 8901</span>
        <span>Email: company@email.com</span>
        <span>Web: company.com</span>
      </div>
    </form>
  );
}
