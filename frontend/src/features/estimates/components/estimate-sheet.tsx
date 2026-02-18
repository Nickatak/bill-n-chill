import { FormEvent } from "react";

import styles from "./estimates-console.module.css";
import { CostCode, EstimateLineInput, ProjectRecord } from "../types";

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
  onTitleChange,
  onDueDateChange,
  onTaxPercentChange,
  onLineItemChange,
  onAddLineItem,
  onMoveLineItem,
  onDuplicateLineItem,
  onRemoveLineItem,
  onSubmit,
}: EstimateSheetProps) {
  return (
    <form className={styles.sheet} onSubmit={onSubmit}>
      <div className={styles.sheetHeader}>
        <div className={styles.fromBlock}>
          <span className={styles.blockLabel}>From</span>
          <p className={styles.blockText}>Your Company</p>
          <p className={styles.blockMuted}>Your Address 1234</p>
          <p className={styles.blockMuted}>City, ST 12345</p>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.logoBox}>Upload Logo</div>
          <div className={styles.sheetTitle}>Estimate</div>
        </div>
      </div>

      <div className={styles.partyGrid}>
        <div className={styles.toBlock}>
          <span className={styles.blockLabel}>To</span>
          {project ? (
            <div className={styles.metaLine}>
              <span>Project</span>
              <span>
                #{project.id} - {project.name}
              </span>
            </div>
          ) : (
            <p className={styles.inlineHint}>
              No projects yet. Create one from Intake so we can bill against it.
            </p>
          )}
          <div className={styles.metaLine}>
            <span>Customer</span>
            <span>{project?.customer_display_name ?? "Customer name"}</span>
          </div>
          <div className={styles.metaLine}>
            <span>Status</span>
            <span>{project?.status ?? "-"}</span>
          </div>
        </div>

        <div className={styles.metaBlock}>
          <div className={styles.metaTitle}>Estimate Details</div>
          <label className={styles.inlineField}>
            Estimate title
            <input
              className={styles.fieldInput}
              value={estimateTitle}
              onChange={(event) => onTitleChange(event.target.value)}
              readOnly={readOnly}
              aria-readonly={readOnly}
              required
            />
          </label>
          <div className={styles.metaLine}>
            <span>Estimate #</span>
            <span>{estimateId ? `#${estimateId}` : "Draft"}</span>
          </div>
          <div className={styles.metaLine}>
            <span>Estimate date</span>
            <input
              className={styles.fieldInput}
              type="date"
              value={estimateDate}
              readOnly
              aria-readonly="true"
            />
          </div>
          <div className={styles.metaLine}>
            <span>Due date</span>
            <input
              className={styles.fieldInput}
              type="date"
              value={dueDate}
              onChange={(event) => onDueDateChange(event.target.value)}
              readOnly={readOnly}
              aria-readonly={readOnly}
            />
          </div>
        </div>
      </div>

      {costCodes.length === 0 ? (
        <p className={styles.inlineHint}>
          Cost codes are required for line items. Create them on the Cost Codes page.
        </p>
      ) : null}

      <div className={styles.lineTable}>
        <div className={styles.lineHeader}>
          <span>Qty</span>
          <span>Description</span>
          <span>Cost Code</span>
          <span>Unit</span>
          <span>Unit Price</span>
          <span>Markup</span>
          <span>Amount</span>
          <span>Actions</span>
        </div>
        {lineItems.map((line, index) => (
          <div key={line.localId} className={styles.lineRow}>
            <input
              className={styles.lineInput}
              aria-label="Quantity"
              value={line.quantity}
              onChange={(event) => onLineItemChange(line.localId, "quantity", event.target.value)}
              inputMode="decimal"
              readOnly={readOnly}
              aria-readonly={readOnly}
              required
            />
            <input
              className={styles.lineInput}
              aria-label="Description"
              value={line.description}
              onChange={(event) => onLineItemChange(line.localId, "description", event.target.value)}
              readOnly={readOnly}
              aria-readonly={readOnly}
              required
            />
            <select
              className={styles.lineSelect}
              aria-label="Cost code"
              value={line.costCodeId}
              onChange={(event) => onLineItemChange(line.localId, "costCodeId", event.target.value)}
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
            <input
              className={styles.lineInput}
              aria-label="Unit"
              value={line.unit}
              onChange={(event) => onLineItemChange(line.localId, "unit", event.target.value)}
              readOnly={readOnly}
              aria-readonly={readOnly}
              required
            />
            <input
              className={styles.lineInput}
              aria-label="Unit cost"
              value={line.unitCost}
              onChange={(event) => onLineItemChange(line.localId, "unitCost", event.target.value)}
              inputMode="decimal"
              readOnly={readOnly}
              aria-readonly={readOnly}
              required
            />
            <div className={styles.percentField}>
              <input
                className={styles.lineInput}
                aria-label="Markup percent"
                value={line.markupPercent}
                onChange={(event) =>
                  onLineItemChange(line.localId, "markupPercent", event.target.value)
                }
                inputMode="decimal"
                readOnly={readOnly}
                aria-readonly={readOnly}
                required
              />
              <span className={styles.percentSuffix}>%</span>
            </div>
            <div className={styles.amountCell}>${formatMoney(lineTotals[index] || 0)}</div>
            <div className={styles.lineActionsCell}>
              <button
                type="button"
                className={`${styles.smallButton} ${readOnly ? styles.actionDisabled : ""}`}
                onClick={() => onMoveLineItem(line.localId, "up")}
                disabled={readOnly || index === 0}
              >
                Up
              </button>
              <button
                type="button"
                className={`${styles.smallButton} ${readOnly ? styles.actionDisabled : ""}`}
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
        ))}
      </div>

      <div className={styles.lineActions}>
        <button
          type="button"
          className={`${styles.secondaryButton} ${readOnly ? styles.actionDisabled : ""}`}
          onClick={onAddLineItem}
          disabled={readOnly}
        >
          Add Line Item
        </button>
        <button
          type="submit"
          className={`${styles.primaryButton} ${readOnly ? styles.actionDisabled : ""}`}
          disabled={readOnly || !canSubmit || isSubmitting}
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

      {readOnly ? (
        <p className={styles.readOnlyHint}>Read-only estimate. Clone or add new to edit.</p>
      ) : null}

      <div className={styles.summary}>
        <div className={styles.summaryRow}>
          <span>Subtotal</span>
          <span>${formatMoney(subtotal)}</span>
        </div>
        <div className={styles.summaryRow}>
          <span>Sales Tax</span>
          <div className={styles.summaryTaxLine}>
            <input
              className={styles.summaryTaxInput}
              value={taxPercent}
              onChange={(event) => onTaxPercentChange(event.target.value)}
              inputMode="decimal"
              aria-label="Sales tax percent"
              readOnly={readOnly}
              aria-readonly={readOnly}
            />
            <span className={styles.summaryTaxSuffix}>%</span>
            <span>${formatMoney(taxAmount)}</span>
          </div>
        </div>
        <div className={`${styles.summaryRow} ${styles.summaryTotal}`}>
          <span>Total</span>
          <span>${formatMoney(totalAmount)}</span>
        </div>
      </div>

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
