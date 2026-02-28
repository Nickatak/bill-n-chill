import Link from "next/link";
import { FormEvent } from "react";

import composerStyles from "@/shared/document-composer/composer-foundation.module.css";
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
        .split(/\r?\n/)
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
        className={`${composerStyles.lineHeaderButton} ${
          isActive ? composerStyles.lineHeaderButtonActive : ""
        } ${readOnly ? composerStyles.actionDisabled : ""}`}
        onClick={() => onSortLineItems(key)}
        disabled={readOnly}
      >
        <span>{label}</span>
        <span className={composerStyles.sortIndicator}>{isActive ? sortIndicator : "↕"}</span>
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
      className={`${composerStyles.sheet} ${readOnly ? composerStyles.sheetReadOnly : ""}`}
      sectionClassName={composerStyles.sheetSection}
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
          <div className={composerStyles.sheetHeader}>
            <div className={composerStyles.partyStack}>
              <div className={composerStyles.fromBlock}>
                <span className={composerStyles.blockLabel}>From</span>
                <p className={composerStyles.blockText}>{senderName || "Your Company"}</p>
                {senderEmail ? <p className={composerStyles.blockMuted}>{senderEmail}</p> : null}
                {senderAddressLines.length ? (
                  senderAddressLines.map((line, index) => (
                    <p key={`${line}-${index}`} className={composerStyles.blockMuted}>
                      {line}
                    </p>
                  ))
                ) : (
                  <p className={composerStyles.blockMuted}>Set sender address in Organization settings.</p>
                )}
              </div>
              <div className={composerStyles.toBlock}>
                <span className={composerStyles.blockLabel}>To</span>
                <p className={composerStyles.blockText}>{customerName}</p>
                {mailingLines.map((line, index) => (
                  <p key={`${line}-${index}`} className={composerStyles.blockMuted}>
                    {line}
                  </p>
                ))}
              </div>
            </div>
            <div className={composerStyles.headerRight}>
              <div className={composerStyles.logoBox}>
                {/* TODO(nick): Replace temporary logo URL link with uploaded logo image rendering. */}
                {senderLogoUrl ? (
                  <a
                    className={composerStyles.logoUrlLink}
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
                <div className={composerStyles.sheetTitleValue}>{estimateTitle || "Untitled"}</div>
              ) : (
                <div className={composerStyles.sheetTitle}>Estimate</div>
              )}
            </div>
          </div>
        ),
        meta: () => (
          <>
            <div className={composerStyles.metaOnlyRow}>
              <div className={composerStyles.metaBlock}>
                {titlePresentation !== "header" ? (
                  <>
                    <div className={composerStyles.metaTitle}>Estimate Details</div>
                    <label className={composerStyles.inlineField}>
                      Estimate title
                      {showReadOnlyText ? (
                        <span className={composerStyles.staticFieldInlineValue}>{estimateTitle || "Untitled"}</span>
                      ) : (
                        <input
                          className={composerStyles.fieldInput}
                          value={estimateTitle}
                          onChange={(event) => onTitleChange(event.target.value)}
                          placeholder="Enter estimate title"
                          disabled={titleReadOnly}
                          aria-disabled={titleReadOnly}
                          required
                        />
                      )}
                    </label>
                  </>
                ) : null}
                <div className={composerStyles.metaLine}>
                  <span>Estimate #</span>
                  <span>{estimateId ? `#${estimateId}` : "Draft"}</span>
                </div>
                <div className={composerStyles.metaLine}>
                  <span>Estimate date</span>
                  {showReadOnlyText ? (
                    <span className={composerStyles.staticMetaValue}>{formatDisplayDate(estimateDate)}</span>
                  ) : (
                    <input
                      className={composerStyles.fieldInput}
                      type="date"
                      value={estimateDate}
                      disabled
                      aria-disabled="true"
                    />
                  )}
                </div>
                <div className={`${composerStyles.metaLine} ${composerStyles.metaLineLast}`}>
                  <span>Valid through</span>
                  {showReadOnlyText ? (
                    <span className={composerStyles.staticMetaValue}>{formatDisplayDate(validThrough)}</span>
                  ) : (
                    <input
                      className={composerStyles.fieldInput}
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
              <p className={composerStyles.inlineHint}>
                Cost codes are required for line items. Create them on the Cost Codes page.
              </p>
            ) : null}
          </>
        ),
        line_items: () => (
          <>
            <div className={composerStyles.lineTable}>
              <div
                className={`${composerStyles.lineHeader} ${readOnly ? composerStyles.lineHeaderReadOnly : ""} ${
                  readOnly && !showMarkupColumn ? composerStyles.lineHeaderNoMarkup : ""
                }`}
              >
                <div className={composerStyles.lineHeaderCell}>{renderSortableHeader("Qty", "quantity")}</div>
                <div className={composerStyles.lineHeaderCell}>
                  <span>Description</span>
                </div>
                <div className={composerStyles.lineHeaderCell}>{renderSortableHeader("Cost Code", "costCode")}</div>
                <div className={composerStyles.lineHeaderCell}>
                  <span>Unit</span>
                </div>
                <div className={composerStyles.lineHeaderCell}>
                  {renderSortableHeader("Unit Price", "unitCost")}
                </div>
                {showMarkupColumn ? (
                  <div className={composerStyles.lineHeaderCell}>
                    {renderSortableHeader("Markup", "markupPercent")}
                  </div>
                ) : null}
                <div className={composerStyles.lineHeaderCell}>{renderSortableHeader("Amount", "amount")}</div>
                {!readOnly ? (
                  <div className={composerStyles.lineHeaderCell}>
                    <span>Actions</span>
                  </div>
                ) : null}
              </div>
              {lineItems.map((line, index) => (
                <div
                  key={line.localId}
                  className={`${composerStyles.lineRow} ${readOnly ? composerStyles.lineRowReadOnly : ""} ${
                    readOnly && !showMarkupColumn ? composerStyles.lineRowNoMarkup : ""
                  }`}
                >
                  <div className={composerStyles.lineCell}>
                    {showReadOnlyText ? (
                      <span className={composerStyles.staticCellValue}>{line.quantity || "0"}</span>
                    ) : (
                      <input
                        className={composerStyles.lineInput}
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
                  <div className={composerStyles.lineCell}>
                    {showReadOnlyText ? (
                      <span className={composerStyles.staticCellValue}>{line.description || "No description"}</span>
                    ) : (
                      <input
                        className={composerStyles.lineInput}
                        aria-label="Description"
                        value={line.description}
                        onChange={(event) => onLineItemChange(line.localId, "description", event.target.value)}
                        disabled={readOnly}
                        aria-disabled={readOnly}
                        required
                      />
                    )}
                  </div>
                  <div className={composerStyles.lineCell}>
                    {showReadOnlyText ? (
                      <span className={composerStyles.staticCellValue}>{findCostCodeLabel(line.costCodeId)}</span>
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
                  <div className={composerStyles.lineCell}>
                    {showReadOnlyText ? (
                      <span className={composerStyles.staticCellValue}>{line.unit || "ea"}</span>
                    ) : (
                      <input
                        className={composerStyles.lineInput}
                        aria-label="Unit"
                        value={line.unit}
                        onChange={(event) => onLineItemChange(line.localId, "unit", event.target.value)}
                        disabled={readOnly}
                        aria-disabled={readOnly}
                        required
                      />
                    )}
                  </div>
                  <div className={composerStyles.lineCell}>
                    {showReadOnlyText ? (
                      <span className={composerStyles.staticCellValue}>
                        ${formatMoney(Number(line.unitCost || 0) * (1 + Number(line.markupPercent || 0) / 100))}
                      </span>
                    ) : (
                      <input
                        className={composerStyles.lineInput}
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
                    <div className={composerStyles.lineCell}>
                      {showReadOnlyText ? (
                        <span className={composerStyles.staticCellValue}>{line.markupPercent || "0"}%</span>
                      ) : (
                        <div className={composerStyles.percentField}>
                          <input
                            className={composerStyles.lineInput}
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
                          <span className={composerStyles.percentSuffix}>%</span>
                        </div>
                      )}
                    </div>
                  ) : null}
                  <div className={composerStyles.lineCell}>
                    <div className={composerStyles.amountCell}>${formatMoney(lineTotals[index] || 0)}</div>
                  </div>
                  {!readOnly ? (
                    <div className={composerStyles.lineCell}>
                      <div className={composerStyles.lineActionsCell}>
                        <button
                          type="button"
                          className={`${composerStyles.smallButton} ${
                            readOnly || index === 0 ? composerStyles.actionDisabled : ""
                          }`}
                          onClick={() => onMoveLineItem(line.localId, "up")}
                          disabled={readOnly || index === 0}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className={`${composerStyles.smallButton} ${
                            readOnly || index === lineItems.length - 1 ? composerStyles.actionDisabled : ""
                          }`}
                          onClick={() => onMoveLineItem(line.localId, "down")}
                          disabled={readOnly || index === lineItems.length - 1}
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          className={`${composerStyles.smallButton} ${readOnly ? composerStyles.actionDisabled : ""}`}
                          onClick={() => onDuplicateLineItem(line.localId)}
                          disabled={readOnly}
                        >
                          Duplicate
                        </button>
                        <button
                          type="button"
                          className={`${composerStyles.removeButton} ${readOnly ? composerStyles.actionDisabled : ""}`}
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
              <div className={composerStyles.lineActions}>
                <button
                  type="button"
                  className={`${composerStyles.secondaryButton} ${readOnly ? composerStyles.actionDisabled : ""}`}
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
            <div className={composerStyles.summary}>
              <div className={composerStyles.summaryRow}>
                <span>Subtotal</span>
                <span>${formatMoney(subtotal)}</span>
              </div>
              <div className={composerStyles.summaryRow}>
                <span>{showReadOnlyText ? `Sales Tax (${taxPercent}%)` : "Sales Tax"}</span>
                <div className={composerStyles.summaryTaxLine}>
                  {showReadOnlyText ? null : (
                    <span className={composerStyles.summaryTaxRate}>
                      <input
                        className={composerStyles.summaryTaxInput}
                        value={taxPercent}
                        onChange={(event) => onTaxPercentChange(event.target.value)}
                        inputMode="decimal"
                        aria-label="Sales tax percent"
                        disabled={readOnly}
                        aria-disabled={readOnly}
                      />
                      <span className={composerStyles.summaryTaxSuffix}>%</span>
                    </span>
                  )}
                  <span className={composerStyles.summaryTaxAmount}>${formatMoney(taxAmount)}</span>
                </div>
              </div>
              <div className={`${composerStyles.summaryRow} ${composerStyles.summaryTotal}`}>
                <span>Total</span>
                <span>${formatMoney(totalAmount)}</span>
              </div>
            </div>
          </>
        ),
        context: () =>
          !readOnly ? (
            <div className={composerStyles.finalizeActions}>
              {formErrorMessage ? <p className={composerStyles.actionError}>{formErrorMessage}</p> : null}
              {!formErrorMessage && formSuccessMessage ? (
                <p className={composerStyles.actionSuccess}>
                  {formSuccessMessage}{" "}
                  {formSuccessHref ? (
                    <Link href={formSuccessHref} target="_blank" rel="noopener noreferrer">
                      Open client-facing estimate
                    </Link>
                  ) : null}
                </p>
              ) : null}
              <button type="submit" className={composerStyles.primaryButton} disabled={!canSubmit || isSubmitting}>
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
            <div className={composerStyles.terms}>
              <h4>Terms and Conditions</h4>
              {(termsText || organizationDefaults?.estimate_default_terms || "Not set")
                .split("\n")
                .filter((line) => line.trim())
                .map((line, index) => (
                  <p key={`${line}-${index}`}>{line}</p>
                ))}
            </div>

            <div className={composerStyles.footer}>
              <span>{senderName || "Your Company"}</span>
              <span>{senderEmail || "Help email not set"}</span>
              <span>{estimateId ? `Estimate #${estimateId}` : "Draft estimate"}</span>
            </div>
          </>
        ),
      }}
    />
  );
}

export type { OrganizationDocumentDefaults };
