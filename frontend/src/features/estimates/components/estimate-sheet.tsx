import Link from "next/link";
import { FormEvent } from "react";

import styles from "./estimates-console.module.css";
import { CostCode, EstimateLineInput, ProjectRecord } from "../types";
import { CostCodeCombobox } from "@/shared/components/cost-code-combobox";
import { DocumentComposer } from "@/shared/document-composer";
import {
  resolveOrganizationBranding,
  type OrganizationBrandingDefaults,
} from "@/shared/document-composer";
import {
  createEstimateDocumentAdapter,
  EstimateFormState,
} from "../document-adapter";

type LineSortKey = "quantity" | "costCode" | "unitCost" | "markupPercent" | "amount";

type OrganizationDocumentDefaults = OrganizationBrandingDefaults & {
  estimate_default_terms: string;
  estimate_validation_delta_days: number;
};

type EstimateSheetProps = {
  project: ProjectRecord | null;
  organizationDefaults?: OrganizationDocumentDefaults | null;
  estimateId: string;
  estimateTitle: string;
  estimateDate: string;
  validThrough: string;
  termsText: string;
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
  formErrorMessage?: string;
  formSuccessMessage?: string;
  formSuccessHref?: string;
  readOnlyPresentation?: "inputs" | "text";
  showMarkupColumn?: boolean;
  titlePresentation?: "field" | "header";
  lineSortKey: LineSortKey | null;
  lineSortDirection: "asc" | "desc";
  onTitleChange: (value: string) => void;
  onValidThroughChange: (value: string) => void;
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

const ESTIMATE_COMPOSER_FALLBACK_POLICY = {
  statuses: ["draft", "sent", "approved", "rejected", "void"],
  statusLabels: {
    draft: "Draft",
    sent: "Sent",
    approved: "Approved",
    rejected: "Rejected",
    void: "Void",
  },
  defaultCreateStatus: "draft",
  defaultStatusFilters: ["draft", "sent", "approved"],
  allowedTransitions: {
    draft: ["sent", "void"],
    sent: ["draft", "approved", "rejected", "void"],
    approved: [],
    rejected: ["draft", "void"],
    void: [],
  },
  terminalStatuses: ["approved", "void"],
};

function formatMoney(value: number): string {
  return value.toFixed(2);
}

export function EstimateSheet({
  project,
  organizationDefaults = null,
  estimateId,
  estimateTitle,
  estimateDate,
  validThrough,
  termsText,
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
  formErrorMessage = "",
  formSuccessMessage = "",
  formSuccessHref = "",
  readOnlyPresentation = "inputs",
  showMarkupColumn = true,
  titlePresentation = "field",
  lineSortKey,
  lineSortDirection,
  onTitleChange,
  onValidThroughChange,
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
  const senderBranding = resolveOrganizationBranding(organizationDefaults);
  const senderName = senderBranding.senderDisplayName;
  const senderEmail = senderBranding.senderEmail;
  const senderAddressLines = senderBranding.senderAddressLines;
  const senderLogoUrl = senderBranding.logoUrl;

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

  const draftFormState: EstimateFormState = {
    title: estimateTitle,
    validThrough,
    termsText,
    taxPercent,
    subtotal,
    taxAmount,
    totalAmount,
    lineItems,
  };
  const adapter = createEstimateDocumentAdapter(ESTIMATE_COMPOSER_FALLBACK_POLICY, []);

  return (
    <DocumentComposer
      adapter={adapter}
      document={null}
      formState={draftFormState}
      className={`${styles.sheet} ${readOnly ? styles.sheetReadOnly : ""}`}
      sectionClassName={styles.sheetSection}
      onSubmit={onSubmit}
      sections={[
        { slot: "header" },
        { slot: "meta" },
        { slot: "line_items" },
        { slot: "totals" },
        { slot: "context" },
        { slot: "footer" },
      ]}
      renderers={{
        header: () => (
          <div className={styles.sheetHeader}>
            <div className={styles.fromBlock}>
              <span className={styles.blockLabel}>From</span>
              <p className={styles.blockText}>{senderName || "Your Company"}</p>
              {senderEmail ? <p className={styles.blockMuted}>{senderEmail}</p> : null}
              {senderAddressLines.length ? (
                senderAddressLines.map((line, index) => (
                  <p key={`${line}-${index}`} className={styles.blockMuted}>
                    {line}
                  </p>
                ))
              ) : (
                <p className={styles.blockMuted}>Set sender address in Organization settings.</p>
              )}
            </div>
            <div className={styles.headerRight}>
              <div className={styles.logoBox}>
                {/* TODO(nick): Replace temporary logo URL link with uploaded logo image rendering. */}
                {senderLogoUrl ? (
                  <a
                    className={styles.logoUrlLink}
                    href={senderLogoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {senderLogoUrl}
                  </a>
                ) : (
                  "No logo URL set"
                )}
              </div>
              {titlePresentation === "header" ? (
                <div className={styles.sheetTitleValue}>{estimateTitle || "Untitled"}</div>
              ) : (
                <div className={styles.sheetTitle}>Estimate</div>
              )}
            </div>
          </div>
        ),
        meta: () => (
          <>
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
                  <span>Valid through</span>
                  {showReadOnlyText ? (
                    <span className={styles.staticMetaValue}>{formatDisplayDate(validThrough)}</span>
                  ) : (
                    <input
                      className={styles.fieldInput}
                      type="date"
                      value={validThrough}
                      onChange={(event) => onValidThroughChange(event.target.value)}
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
          </>
        ),
        line_items: () => (
          <>
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
                      <CostCodeCombobox
                        costCodes={costCodes}
                        value={line.costCodeId}
                        onChange={(nextValue) => onLineItemChange(line.localId, "costCodeId", nextValue)}
                        ariaLabel="Cost code"
                        disabled={readOnly}
                        placeholder="Search cost code"
                      />
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
                        ${formatMoney(Number(line.unitCost || 0) * (1 + Number(line.markupPercent || 0) / 100))}
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
          </>
        ),
        totals: () => (
          <>
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
          </>
        ),
        context: () =>
          !readOnly ? (
            <div className={styles.finalizeActions}>
              {formErrorMessage ? <p className={styles.actionError}>{formErrorMessage}</p> : null}
              {!formErrorMessage && formSuccessMessage ? (
                <p className={styles.actionSuccess}>
                  {formSuccessMessage}{" "}
                  {formSuccessHref ? (
                    <Link href={formSuccessHref} target="_blank" rel="noopener noreferrer">
                      Open client-facing estimate
                    </Link>
                  ) : null}
                </p>
              ) : null}
              <button type="submit" className={styles.primaryButton} disabled={!canSubmit || isSubmitting}>
                {isSubmitting
                  ? isEditingDraft
                    ? "Saving..."
                    : "Creating..."
                  : isEditingDraft
                    ? "Save Draft Changes"
                    : "Create Estimate"}
              </button>
            </div>
          ) : null,
        footer: () => (
          <>
            <div className={styles.terms}>
              <h4>Terms and Conditions</h4>
              {(termsText || organizationDefaults?.estimate_default_terms || "Not set")
                .split("\n")
                .filter((line) => line.trim())
                .map((line, index) => (
                  <p key={`${line}-${index}`}>{line}</p>
                ))}
            </div>

            <div className={styles.footer}>
              <span>{senderName || "Your Company"}</span>
              <span>{senderEmail || "billing@example.com"}</span>
              <span>{senderAddressLines[0] || "Set address in Organization settings"}</span>
            </div>
          </>
        ),
      }}
    />
  );
}

export type { OrganizationDocumentDefaults };
