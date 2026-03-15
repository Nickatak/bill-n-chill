/**
 * Estimate document creator sheet used for both creating and editing estimates.
 * Delegates layout to the shared DocumentCreator and renders header, meta,
 * line-item table, totals, terms, and footer sections via slot renderers.
 */

import { FormEvent } from "react";

import { formatDateDisplay } from "@/shared/date-format";
import { formatDecimal } from "@/shared/money-format";
import { useMediaQuery } from "@/shared/hooks/use-media-query";
import creatorStyles from "@/shared/document-creator/creator-foundation.module.css";
import { MobileLineItemCard } from "@/shared/document-creator/mobile-line-card";
import mobileCardStyles from "@/shared/document-creator/mobile-line-card.module.css";
import { CostCode, EstimateLineInput, ProjectRecord } from "../types";
import { CostCodeCombobox } from "./cost-code-combobox";
import { DocumentCreator } from "@/shared/document-creator";
import {
  resolveOrganizationBranding,
  type OrganizationBrandingDefaults,
} from "@/shared/document-creator";
import {
  createEstimateDocumentAdapter,
  EstimateFormState,
} from "../document-adapter";
import type { LineValidationResult } from "../helpers";

type LineSortKey = "quantity" | "costCode" | "unitCost" | "markupPercent" | "amount";

type OrganizationDocumentDefaults = OrganizationBrandingDefaults & {
  estimate_terms_and_conditions: string;
  default_estimate_valid_delta: number;
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
  lineValidation?: LineValidationResult;
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

/**
 * Composable estimate sheet supporting draft creation, draft editing, and
 * read-only review. Uses DocumentCreator slots for layout consistency.
 */
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
  lineValidation,
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
  const isMobile = useMediaQuery("(max-width: 700px)");
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
  const senderEmail = senderBranding.helpEmail;
  const senderAddressLines = senderBranding.senderAddressLines;
  const senderLogoUrl = senderBranding.logoUrl;

  /** Look up the display label for a cost code by its ID. */
  function findCostCodeLabel(costCodeId: string): string {
    const code = costCodes.find((candidate) => String(candidate.id) === costCodeId);
    if (!code) {
      return costCodeId || "Not set";
    }
    return `${code.code} - ${code.name}`;
  }

  /** Return just the short code (e.g. "01-100") for print display. */
  function findCostCodeShort(costCodeId: string): string {
    const code = costCodes.find((candidate) => String(candidate.id) === costCodeId);
    return code?.code || costCodeId || "—";
  }

  /** Render a column header that doubles as a sort toggle when editing is allowed. */
  function renderSortableHeader(label: string, key: LineSortKey) {
    if (readOnly) {
      return <span>{label}</span>;
    }
    const isActive = lineSortKey === key;
    return (
      <button
        type="button"
        className={`${creatorStyles.lineHeaderButton} ${
          isActive ? creatorStyles.lineHeaderButtonActive : ""
        }`}
        onClick={() => onSortLineItems(key)}
      >
        <span>{label}</span>
        <span className={creatorStyles.sortIndicator}>{isActive ? sortIndicator : "↕"}</span>
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
    <DocumentCreator
      adapter={adapter}
      document={null}
      formState={draftFormState}
      className={`${creatorStyles.sheet} ${readOnly ? creatorStyles.sheetReadOnly : ""}`}
      sectionClassName={creatorStyles.sheetSection}
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
          <div className={creatorStyles.sheetHeader}>
            <div className={creatorStyles.partyStack}>
              <div className={creatorStyles.fromBlock}>
                <span className={creatorStyles.blockLabel}>From</span>
                <p className={creatorStyles.blockText}>{senderName || "Your Company"}</p>
                {senderAddressLines.length ? (
                  senderAddressLines.map((line, index) => (
                    <p key={`${line}-${index}`} className={creatorStyles.blockMuted}>
                      {line}
                    </p>
                  ))
                ) : (
                  <p className={creatorStyles.blockMuted}>Set sender address in Organization settings.</p>
                )}
              </div>
              <div className={creatorStyles.toBlock}>
                <span className={creatorStyles.blockLabel}>To</span>
                <p className={creatorStyles.blockText}>{customerName}</p>
                {mailingLines.map((line, index) => (
                  <p key={`${line}-${index}`} className={creatorStyles.blockMuted}>
                    {line}
                  </p>
                ))}
              </div>
            </div>
            <div className={creatorStyles.headerRight}>
              <div className={`${creatorStyles.logoBox} ${senderLogoUrl ? creatorStyles.logoBoxHasImage : ""}`}>
                {senderLogoUrl ? (
                  <img
                    className={creatorStyles.logoImage}
                    src={senderLogoUrl}
                    alt={`${senderName || "Company"} logo`}
                  />
                ) : "No logo set"}
              </div>
              {titlePresentation === "header" ? (
                <div className={creatorStyles.sheetTitleValue}>{estimateTitle || "Untitled"}</div>
              ) : (
                <>
                  <div className={creatorStyles.sheetTitle}>Estimate</div>
                  <div className={`${creatorStyles.sheetTitleValue} ${creatorStyles.printOnly}`}>
                    {estimateTitle || "Untitled"}
                  </div>
                </>
              )}
            </div>
          </div>
        ),
        meta: () => (
          <>
            <div className={creatorStyles.metaOnlyRow}>
              <div className={creatorStyles.metaBlock}>
                {titlePresentation !== "header" ? (
                  <>
                    <div className={creatorStyles.metaTitle}>Estimate Details</div>
                    <label className={`${creatorStyles.inlineField} ${creatorStyles.screenOnly}`}>
                      Estimate title
                      {showReadOnlyText ? (
                        <span className={creatorStyles.staticFieldInlineValue}>{estimateTitle || "Untitled"}</span>
                      ) : (
                        <input
                          className={creatorStyles.fieldInput}
                          value={estimateTitle}
                          onChange={(event) => onTitleChange(event.target.value)}
                          placeholder="Enter estimate title"
                          disabled={titleReadOnly}
                          aria-disabled={titleReadOnly}
                        />
                      )}
                    </label>
                  </>
                ) : null}
                <div className={creatorStyles.metaLine}>
                  <span>Estimate #</span>
                  <span>{estimateId ? `#${estimateId}` : "Draft"}</span>
                </div>
                <div className={creatorStyles.metaLine}>
                  <span>Estimate date</span>
                  {showReadOnlyText ? (
                    <span className={creatorStyles.staticMetaValue}>{formatDateDisplay(estimateDate, "Not set")}</span>
                  ) : (
                    <input
                      className={creatorStyles.fieldInput}
                      type="date"
                      value={estimateDate}
                      disabled
                      aria-disabled="true"
                    />
                  )}
                </div>
                <div className={creatorStyles.metaLine}>
                  <span>Valid through</span>
                  {showReadOnlyText ? (
                    <span className={creatorStyles.staticMetaValue}>{formatDateDisplay(validThrough, "Not set")}</span>
                  ) : (
                    <input
                      className={creatorStyles.fieldInput}
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
          </>
        ),
        line_items: () => (
          <>
            <div className={creatorStyles.lineSectionIntro}>
              <h3>Line Items</h3>
            </div>
            {isMobile ? (
              <div className={mobileCardStyles.cardList}>
                {lineItems.map((line, index) => {
                  const rowIssues = lineValidation?.issuesByLocalId.get(line.localId) ?? [];
                  return (
                  <MobileLineItemCard
                    key={line.localId}
                    index={index}
                    readOnly={readOnly}
                    isFirst={index === 0}
                    isLast={index === lineItems.length - 1}
                    onRemove={readOnly ? undefined : () => onRemoveLineItem(line.localId)}
                    onMoveUp={readOnly ? undefined : () => onMoveLineItem(line.localId, "up")}
                    onMoveDown={readOnly ? undefined : () => onMoveLineItem(line.localId, "down")}
                    onDuplicate={readOnly ? undefined : () => onDuplicateLineItem(line.localId)}
                    validationError={rowIssues.length ? `Row ${index + 1}: ${rowIssues.join(" ")}` : undefined}
                    fields={[
                      {
                        label: "Description",
                        key: "description",
                        span: "full",
                        render: () =>
                          showReadOnlyText ? (
                            <span className={mobileCardStyles.fieldStatic}>{line.description || "No description"}</span>
                          ) : (
                            <input
                              className={mobileCardStyles.fieldInput}
                              aria-label="Description"
                              value={line.description}
                              onChange={(event) => onLineItemChange(line.localId, "description", event.target.value)}
                              disabled={readOnly}
                              required
                            />
                          ),
                      },
                      {
                        label: "Cost Code",
                        key: "costCode",
                        span: "full",
                        render: () =>
                          showReadOnlyText ? (
                            <span className={mobileCardStyles.fieldStatic}>{findCostCodeLabel(line.costCodeId)}</span>
                          ) : (
                            <CostCodeCombobox
                              costCodes={costCodes}
                              value={line.costCodeId}
                              onChange={(nextValue) => onLineItemChange(line.localId, "costCodeId", nextValue)}
                              ariaLabel="Cost code"
                              disabled={readOnly}
                              placeholder="Search cost code"
                            />
                          ),
                      },
                      {
                        label: "Qty",
                        key: "quantity",
                        render: () =>
                          showReadOnlyText ? (
                            <span className={mobileCardStyles.fieldStatic}>{line.quantity || "0"}</span>
                          ) : (
                            <input
                              className={mobileCardStyles.fieldInput}
                              aria-label="Quantity"
                              value={line.quantity}
                              onChange={(event) => onLineItemChange(line.localId, "quantity", event.target.value)}
                              inputMode="decimal"
                              disabled={readOnly}
                              required
                            />
                          ),
                      },
                      {
                        label: "Unit",
                        key: "unit",
                        render: () =>
                          showReadOnlyText ? (
                            <span className={mobileCardStyles.fieldStatic}>{line.unit || "ea"}</span>
                          ) : (
                            <input
                              className={mobileCardStyles.fieldInput}
                              aria-label="Unit"
                              value={line.unit}
                              onChange={(event) => onLineItemChange(line.localId, "unit", event.target.value)}
                              disabled={readOnly}
                              required
                            />
                          ),
                      },
                      {
                        label: "Unit Price",
                        key: "unitCost",
                        render: () =>
                          showReadOnlyText ? (
                            <span className={mobileCardStyles.fieldStatic}>
                              ${formatDecimal(Number(line.unitCost || 0) * (1 + Number(line.markupPercent || 0) / 100))}
                            </span>
                          ) : (
                            <input
                              className={mobileCardStyles.fieldInput}
                              aria-label="Unit cost"
                              value={line.unitCost}
                              onChange={(event) => onLineItemChange(line.localId, "unitCost", event.target.value)}
                              inputMode="decimal"
                              disabled={readOnly}
                              required
                            />
                          ),
                      },
                      ...(showMarkupColumn
                        ? [
                            {
                              label: "Markup %",
                              key: "markupPercent",
                              render: () =>
                                showReadOnlyText ? (
                                  <span className={mobileCardStyles.fieldStatic}>{line.markupPercent || "0"}%</span>
                                ) : (
                                  <input
                                    className={mobileCardStyles.fieldInput}
                                    aria-label="Markup percent"
                                    value={line.markupPercent}
                                    onChange={(event) =>
                                      onLineItemChange(line.localId, "markupPercent", event.target.value)
                                    }
                                    inputMode="decimal"
                                    disabled={readOnly}
                                    required
                                  />
                                ),
                            } as const,
                          ]
                        : []),
                      {
                        label: "Amount",
                        key: "amount",
                        span: "full",
                        align: "right",
                        render: () => (
                          <span className={`${mobileCardStyles.fieldStatic} ${mobileCardStyles.fieldStaticRight} ${readOnly ? mobileCardStyles.fieldStaticReadOnly : ""}`}>
                            ${formatDecimal(lineTotals[index] || 0)}
                          </span>
                        ),
                      },
                    ]}
                  />
                  );
                })}
              </div>
            ) : (
              <div className={creatorStyles.lineTable}>
                <div
                  className={`${creatorStyles.lineHeader} ${readOnly ? creatorStyles.lineHeaderReadOnly : ""} ${
                    readOnly && !showMarkupColumn ? creatorStyles.lineHeaderNoMarkup : ""
                  }`}
                >
                  <div className={creatorStyles.lineHeaderCell}>{renderSortableHeader("Qty", "quantity")}</div>
                  <div className={creatorStyles.lineHeaderCell}>
                    <span>Description</span>
                  </div>
                  <div className={creatorStyles.lineHeaderCell}>{renderSortableHeader("Cost Code", "costCode")}</div>
                  <div className={creatorStyles.lineHeaderCell}>
                    <span>Unit</span>
                  </div>
                  <div className={creatorStyles.lineHeaderCell}>
                    {renderSortableHeader("Unit Price", "unitCost")}
                  </div>
                  {showMarkupColumn ? (
                    <div className={creatorStyles.lineHeaderCell}>
                      {renderSortableHeader("Markup", "markupPercent")}
                    </div>
                  ) : null}
                  <div className={creatorStyles.lineHeaderCell}>{renderSortableHeader("Amount", "amount")}</div>
                  {!readOnly ? (
                    <div className={creatorStyles.lineHeaderCell}>
                      <span>Actions</span>
                    </div>
                  ) : null}
                </div>
                {lineItems.map((line, index) => {
                  const rowIssues = lineValidation?.issuesByLocalId.get(line.localId) ?? [];
                  return (
                  <div
                    key={line.localId}
                    className={`${creatorStyles.lineRow} ${readOnly ? creatorStyles.lineRowReadOnly : ""} ${
                      readOnly && !showMarkupColumn ? creatorStyles.lineRowNoMarkup : ""
                    } ${rowIssues.length ? creatorStyles.lineRowInvalid : ""}`}
                  >
                    <div className={creatorStyles.lineCell}>
                      {showReadOnlyText ? (
                        <span className={creatorStyles.staticCellValue}>{line.quantity || "0"}</span>
                      ) : (
                        <input
                          className={creatorStyles.lineInput}
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
                    <div className={creatorStyles.lineCell}>
                      {showReadOnlyText ? (
                        <span className={creatorStyles.staticCellValue}>{line.description || "No description"}</span>
                      ) : (
                        <input
                          className={creatorStyles.lineInput}
                          aria-label="Description"
                          value={line.description}
                          onChange={(event) => onLineItemChange(line.localId, "description", event.target.value)}
                          disabled={readOnly}
                          aria-disabled={readOnly}
                          required
                        />
                      )}
                    </div>
                    <div className={creatorStyles.lineCell}>
                      <span className={creatorStyles.printOnly}>{findCostCodeShort(line.costCodeId)}</span>
                      <span className={creatorStyles.screenOnly}>
                        {showReadOnlyText ? (
                          <span className={creatorStyles.staticCellValue}>{findCostCodeLabel(line.costCodeId)}</span>
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
                      </span>
                    </div>
                    <div className={creatorStyles.lineCell}>
                      {showReadOnlyText ? (
                        <span className={creatorStyles.staticCellValue}>{line.unit || "ea"}</span>
                      ) : (
                        <input
                          className={creatorStyles.lineInput}
                          aria-label="Unit"
                          value={line.unit}
                          onChange={(event) => onLineItemChange(line.localId, "unit", event.target.value)}
                          disabled={readOnly}
                          aria-disabled={readOnly}
                          required
                        />
                      )}
                    </div>
                    <div className={creatorStyles.lineCell}>
                      {showReadOnlyText ? (
                        <span className={creatorStyles.staticCellValue}>
                          ${formatDecimal(Number(line.unitCost || 0) * (1 + Number(line.markupPercent || 0) / 100))}
                        </span>
                      ) : (
                        <input
                          className={creatorStyles.lineInput}
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
                      <div className={creatorStyles.lineCell}>
                        {showReadOnlyText ? (
                          <span className={creatorStyles.staticCellValue}>{line.markupPercent || "0"}%</span>
                        ) : (
                          <div className={creatorStyles.percentField}>
                            <input
                              className={creatorStyles.lineInput}
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
                            <span className={creatorStyles.percentSuffix}>%</span>
                          </div>
                        )}
                      </div>
                    ) : null}
                    <div className={creatorStyles.lineCell}>
                      <div className={creatorStyles.amountCell}>${formatDecimal(lineTotals[index] || 0)}</div>
                    </div>
                    {!readOnly ? (
                      <div className={creatorStyles.lineCell}>
                        <div className={creatorStyles.lineActionsCell}>
                          <button
                            type="button"
                            className={`${creatorStyles.smallButton} ${
                              readOnly || index === 0 ? creatorStyles.actionDisabled : ""
                            }`}
                            onClick={() => onMoveLineItem(line.localId, "up")}
                            disabled={readOnly || index === 0}
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            className={`${creatorStyles.smallButton} ${
                              readOnly || index === lineItems.length - 1 ? creatorStyles.actionDisabled : ""
                            }`}
                            onClick={() => onMoveLineItem(line.localId, "down")}
                            disabled={readOnly || index === lineItems.length - 1}
                          >
                            Down
                          </button>
                          <button
                            type="button"
                            className={`${creatorStyles.smallButton} ${readOnly ? creatorStyles.actionDisabled : ""}`}
                            onClick={() => onDuplicateLineItem(line.localId)}
                            disabled={readOnly}
                          >
                            Duplicate
                          </button>
                          <button
                            type="button"
                            className={`${creatorStyles.removeButton} ${readOnly ? creatorStyles.actionDisabled : ""}`}
                            onClick={() => onRemoveLineItem(line.localId)}
                            disabled={readOnly}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  );
                })}
              </div>
            )}

            {!showReadOnlyText ? (
              <div className={creatorStyles.lineActions}>
                <button
                  type="button"
                  className={`${creatorStyles.secondaryButton} ${readOnly ? creatorStyles.actionDisabled : ""}`}
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
            <div className={creatorStyles.summary}>
              <div className={creatorStyles.summaryRow}>
                <span>Subtotal</span>
                <span>${formatDecimal(subtotal)}</span>
              </div>
              <div className={creatorStyles.summaryRow}>
                <span>{showReadOnlyText ? `Sales Tax (${taxPercent}%)` : "Sales Tax"}</span>
                <div className={creatorStyles.summaryTaxLine}>
                  {showReadOnlyText ? null : (
                    <span className={creatorStyles.summaryTaxRate}>
                      <input
                        className={creatorStyles.summaryTaxInput}
                        value={taxPercent}
                        onChange={(event) => onTaxPercentChange(event.target.value)}
                        inputMode="decimal"
                        aria-label="Sales tax percent"
                        disabled={readOnly}
                        aria-disabled={readOnly}
                      />
                      <span className={creatorStyles.summaryTaxSuffix}>%</span>
                    </span>
                  )}
                  <span className={creatorStyles.summaryTaxAmount}>${formatDecimal(taxAmount)}</span>
                </div>
              </div>
              <div className={`${creatorStyles.summaryRow} ${creatorStyles.summaryTotal}`}>
                <span>Total</span>
                <span>${formatDecimal(totalAmount)}</span>
              </div>
            </div>
          </>
        ),
        context: () =>
          !readOnly ? (
            <div className={creatorStyles.finalizeActions}>
              {formErrorMessage ? <p className={creatorStyles.actionError}>{formErrorMessage}</p> : null}
              {!formErrorMessage && formSuccessMessage ? (
                <p className={creatorStyles.actionSuccess}>{formSuccessMessage}</p>
              ) : null}
              <button type="submit" className={creatorStyles.primaryButton} disabled={!canSubmit || isSubmitting}>
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
            <div className={creatorStyles.terms}>
              <h4>Terms and Conditions</h4>
              {(termsText || organizationDefaults?.estimate_terms_and_conditions || "Not set")
                .split("\n")
                .filter((line) => line.trim())
                .map((line, index) => (
                  <p key={`${line}-${index}`}>{line}</p>
                ))}
            </div>

            <div className={creatorStyles.footer}>
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
