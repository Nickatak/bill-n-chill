/**
 * Workspace panel for the invoices console — toolbar, DocumentCreator form,
 * line items table, totals, submit button, and decision stamp.
 *
 * Pure presentational component: all state and handlers live in the parent
 * InvoicesConsole and are passed down as props.
 *
 * Parent: InvoicesConsole
 */
"use client";

import { FormEvent, RefObject } from "react";
import { parseAmount, formatDecimal } from "@/shared/money-format";
import { DocumentCreator } from "@/shared/document-creator";
import type { DocumentCreatorAdapter, CreatorLineDraft } from "@/shared/document-creator/types";
import { MobileLineItemCard } from "@/shared/document-creator/mobile-line-card";
import { CostCodeCombobox } from "@/features/estimates/components/cost-code-combobox";
import { ReadOnlyLineTable } from "@/shared/document-viewer/read-only-line-table";
import type {
  CostCode,
  InvoiceLineInput,
  InvoiceRecord,
  OrganizationInvoiceDefaults,
  ProjectRecord,
} from "../types";
import type { InvoiceFormState } from "../document-adapter";
import styles from "./invoices-console.module.css";
import creatorStyles from "@/shared/document-creator/creator-foundation.module.css";
import invoiceCreatorStyles from "@/shared/document-creator/invoice-creator.module.css";
import stampStyles from "@/shared/styles/decision-stamp.module.css";
import mobileCardStyles from "@/shared/document-creator/mobile-line-card.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LineValidation = {
  issues: Array<{ localId: number; message: string }>;
  issuesByLocalId: Map<number, string[]>;
};

export type InvoicesWorkspacePanelProps = {
  // Layout
  isMobile: boolean;

  // RBAC
  canMutateInvoices: boolean;

  // Workspace context
  workspaceSourceInvoice: InvoiceRecord | null;
  workspaceIsLocked: boolean;
  workspaceContext: string;
  workspaceBadgeLabel: string;
  workspaceBadgeClass: string;
  editingDraftInvoiceId: number | null;

  // Toolbar actions
  onStartNewDraft: () => void;
  onDuplicateIntoDraft: () => void;

  // Toolbar status message
  statusMessageAtToolbar: boolean;
  statusMessage: string;

  // Creator ref (for flash animation)
  invoiceCreatorRef: RefObject<HTMLDivElement | null>;

  // DocumentCreator adapter
  invoiceCreatorAdapter: DocumentCreatorAdapter<InvoiceRecord, CreatorLineDraft, InvoiceFormState>;
  invoiceDraftFormState: InvoiceFormState;

  // Branding
  senderDisplayName: string;
  senderEmail: string;
  senderAddressLines: string[];
  senderLogoUrl: string;

  // Project context
  selectedProject: ProjectRecord | null;

  // Invoice number
  workspaceInvoiceNumber: string;

  // Date fields
  issueDate: string;
  onIssueDateChange: (value: string) => void;
  dueDate: string;
  onDueDateChange: (value: string) => void;

  // Line items
  lineItems: InvoiceLineInput[];
  lineValidation: LineValidation;
  costCodes: CostCode[];
  onAddLineItem: () => void;
  onRemoveLineItem: (localId: number) => void;
  onUpdateLineItem: (localId: number, key: keyof Omit<InvoiceLineInput, "localId">, value: string) => void;

  // Totals
  draftLineSubtotal: number;
  draftTaxTotal: number;
  draftTotal: number;
  taxPercent: string;
  onTaxPercentChange: (value: string) => void;

  // Submit
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;

  // Creator status message
  statusMessageAtCreator: boolean;

  // Terms
  termsText: string;
  organizationInvoiceDefaults: OrganizationInvoiceDefaults | null;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InvoicesWorkspacePanel({
  isMobile,
  canMutateInvoices,
  workspaceSourceInvoice,
  workspaceIsLocked,
  workspaceContext,
  workspaceBadgeLabel,
  workspaceBadgeClass,
  editingDraftInvoiceId,
  onStartNewDraft,
  onDuplicateIntoDraft,
  statusMessageAtToolbar,
  statusMessage,
  invoiceCreatorRef,
  invoiceCreatorAdapter,
  invoiceDraftFormState,
  senderDisplayName,
  senderEmail,
  senderAddressLines,
  senderLogoUrl,
  selectedProject,
  workspaceInvoiceNumber,
  issueDate,
  onIssueDateChange,
  dueDate,
  onDueDateChange,
  lineItems,
  lineValidation,
  costCodes,
  onAddLineItem,
  onRemoveLineItem,
  onUpdateLineItem,
  draftLineSubtotal,
  draftTaxTotal,
  draftTotal,
  taxPercent,
  onTaxPercentChange,
  onSubmit,
  statusMessageAtCreator,
  termsText,
  organizationInvoiceDefaults,
}: InvoicesWorkspacePanelProps) {
  return (
    <div className={styles.workspace}>
      {canMutateInvoices ? (
        <div className={styles.workspaceToolbar}>
          <div className={styles.workspaceContext}>
            <span className={styles.workspaceContextLabel}>
              {!workspaceSourceInvoice ? "Creating" : workspaceIsLocked ? "Viewing" : "Editing"}
            </span>
            <div className={styles.workspaceContextValueRow}>
              <strong>{workspaceContext}</strong>
              <span className={`${styles.statusBadge} ${workspaceBadgeClass}`}>{workspaceBadgeLabel}</span>
            </div>
          </div>
          <div className={styles.workspaceToolbarActions}>
            <button
              type="button"
              className={styles.toolbarPrimaryButton}
              onClick={onStartNewDraft}
            >
              {workspaceSourceInvoice ? "New Invoice" : "Reset"}
            </button>
            {workspaceSourceInvoice ? (
              <button
                type="button"
                className={styles.toolbarSecondaryButton}
                onClick={onDuplicateIntoDraft}
              >
                Duplicate Invoice
              </button>
            ) : null}
          </div>
          {statusMessageAtToolbar ? (
            <p className={creatorStyles.actionSuccess}>{statusMessage}</p>
          ) : null}
        </div>
      ) : null}
      <div ref={invoiceCreatorRef}>
        <DocumentCreator
          adapter={invoiceCreatorAdapter}
          document={null}
          formState={invoiceDraftFormState}
          className={`${creatorStyles.sheet} ${invoiceCreatorStyles.invoiceCreatorSheet} ${workspaceIsLocked ? `${invoiceCreatorStyles.invoiceCreatorSheetLocked} ${creatorStyles.sheetReadOnly}` : ""}`}
          sectionClassName={invoiceCreatorStyles.invoiceCreatorSection}
          onSubmit={onSubmit}
          sections={[{ slot: "context" }]}
          renderers={{
            context: () => (
              <>
              <div className={creatorStyles.sheetHeader}>
                <div className={invoiceCreatorStyles.invoicePartyStack}>
                  <div className={creatorStyles.fromBlock}>
                    <span className={creatorStyles.blockLabel}>From</span>
                    <p className={creatorStyles.blockText}>
                      {senderDisplayName}
                    </p>
                    {senderAddressLines.length
                      ? senderAddressLines.map((line, index) => (
                          <p key={`${line}-${index}`} className={creatorStyles.blockMuted}>
                            {line}
                          </p>
                        ))
                      : (
                        <p className={creatorStyles.blockMuted}>
                          Set sender address in Organization settings.
                        </p>
                      )}
                  </div>
                  <div className={creatorStyles.toBlock}>
                    <span className={creatorStyles.blockLabel}>To</span>
                    <p className={creatorStyles.blockText}>
                      {selectedProject?.customer_display_name}
                    </p>
                    <p className={creatorStyles.blockMuted}>
                      {selectedProject
                        ? `#${selectedProject.id} ${selectedProject.name}`
                        : ""}
                    </p>
                  </div>
                </div>
                <div className={creatorStyles.headerRight}>
                  <div className={`${creatorStyles.logoBox} ${senderLogoUrl ? creatorStyles.logoBoxHasImage : ""}`}>
                    {senderLogoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo
                      <img
                        className={creatorStyles.logoImage}
                        src={senderLogoUrl}
                        alt={`${senderDisplayName || "Company"} logo`}
                      />
                    ) : "No logo set"}
                  </div>
                  <div className={creatorStyles.sheetTitle}>Invoice</div>
                </div>
              </div>

                <div className={creatorStyles.metaBlock}>
                  <div className={creatorStyles.metaTitle}>Invoice Details</div>
                  <div className={creatorStyles.metaLine}>
                    <span>Invoice #</span>
                    <div className={invoiceCreatorStyles.invoiceNumberContext}>
                      <input
                        className={`${creatorStyles.fieldInput} ${invoiceCreatorStyles.invoiceNumberInput}`}
                        value={workspaceInvoiceNumber}
                        readOnly
                        disabled
                        autoComplete="one-time-code"
                        aria-label="Invoice number"
                      />
                      {!workspaceSourceInvoice ? (
                        <span
                          className={`${invoiceCreatorStyles.invoiceNumberIndicator} ${invoiceCreatorStyles.invoiceNumberIndicatorGenerated}`}
                        >
                          New
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <label className={creatorStyles.inlineField}>
                    Issue date
                    <input
                      className={`${creatorStyles.fieldInput} ${invoiceCreatorStyles.invoiceLockableControl}`}
                      type="date"
                      value={issueDate}
                      onChange={(event) => onIssueDateChange(event.target.value)}
                      required
                      disabled={workspaceIsLocked}
                    />
                  </label>
                  <label className={creatorStyles.inlineField}>
                    Due date
                    <input
                      className={`${creatorStyles.fieldInput} ${invoiceCreatorStyles.invoiceLockableControl}`}
                      type="date"
                      value={dueDate}
                      onChange={(event) => onDueDateChange(event.target.value)}
                      required
                      disabled={workspaceIsLocked}
                    />
                  </label>
                </div>

              <div className={invoiceCreatorStyles.invoiceLineSectionIntro}>
                <h3>Line Items</h3>
              </div>
              {workspaceIsLocked ? (
                <div className={styles.lockedLineTableWrap}>
                <ReadOnlyLineTable
                  columns={["Cost Code", "Description", "Qty", "Unit", "Unit Price", "Amount"]}
                  rows={lineItems.map((line) => {
                    const lineAmount = parseAmount(line.quantity) * parseAmount(line.unitPrice);
                    return {
                      key: line.localId,
                      cells: [
                        costCodes.find((c) => String(c.id) === line.costCode)?.code || "—",
                        line.description || "—",
                        line.quantity,
                        line.unit,
                        `$${line.unitPrice}`,
                        `$${formatDecimal(lineAmount)}`,
                      ],
                    };
                  })}
                  emptyMessage="No line items."
                  mobileColumnLayout={[
                    { order: 0, span: "full" },
                    { order: 1, span: "full" },
                    { order: 2, span: "half" },
                    { order: 3, span: "half" },
                    { order: 4, span: "half" },
                    { order: 5, span: "half", align: "right" },
                  ]}
                />
                </div>
              ) : isMobile ? (
                <div className={mobileCardStyles.cardList}>
                  {lineItems.map((line, index) => {
                    const lineAmount = parseAmount(line.quantity) * parseAmount(line.unitPrice);
                    const rowIssues = lineValidation.issuesByLocalId.get(line.localId) ?? [];
                    return (
                      <MobileLineItemCard
                        key={line.localId}
                        index={index}
                        readOnly={false}
                        isFirst={index === 0}
                        isLast={index === lineItems.length - 1}
                        onRemove={() => onRemoveLineItem(line.localId)}
                        validationError={rowIssues.length ? `Row ${index + 1}: ${rowIssues.join(" ")}` : undefined}
                        fields={[
                          {
                            label: "Description",
                            key: "description",
                            span: "full",
                            render: () => (
                              <input
                                className={mobileCardStyles.fieldInput}
                                value={line.description}
                                onChange={(event) => onUpdateLineItem(line.localId, "description", event.target.value)}
                              />
                            ),
                          },
                          {
                            label: "Cost Code",
                            key: "costCode",
                            span: "full",
                            render: () => (
                              <CostCodeCombobox
                                costCodes={costCodes}
                                value={line.costCode}
                                onChange={(nextValue) => onUpdateLineItem(line.localId, "costCode", nextValue)}
                                ariaLabel="Cost code"
                                allowEmptySelection
                                emptySelectionLabel="No cost code (optional)"
                                placeholder="Search cost code"
                              />
                            ),
                          },
                          {
                            label: "Qty",
                            key: "quantity",
                            render: () => (
                              <input
                                className={mobileCardStyles.fieldInput}
                                value={line.quantity}
                                onChange={(event) => onUpdateLineItem(line.localId, "quantity", event.target.value)}
                                inputMode="decimal"
                              />
                            ),
                          },
                          {
                            label: "Unit",
                            key: "unit",
                            render: () => (
                              <input
                                className={mobileCardStyles.fieldInput}
                                value={line.unit}
                                onChange={(event) => onUpdateLineItem(line.localId, "unit", event.target.value)}
                              />
                            ),
                          },
                          {
                            label: "Unit Price",
                            key: "unitPrice",
                            render: () => (
                              <input
                                className={mobileCardStyles.fieldInput}
                                value={line.unitPrice}
                                onChange={(event) => onUpdateLineItem(line.localId, "unitPrice", event.target.value)}
                                inputMode="decimal"
                              />
                            ),
                          },
                          {
                            label: "Amount",
                            key: "amount",
                            render: () => (
                              <span className={mobileCardStyles.fieldStatic}>
                                ${formatDecimal(lineAmount)}
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
                  <div className={invoiceCreatorStyles.invoiceLineHeader}>
                    <span>Cost Code</span>
                    <span>Description</span>
                    <span>Qty</span>
                    <span>Unit</span>
                    <span>Unit price</span>
                    <span>Amount</span>
                    <span>Actions</span>
                  </div>
                  {lineItems.map((line, index) => {
                    const lineAmount = parseAmount(line.quantity) * parseAmount(line.unitPrice);
                    const rowIssues = lineValidation.issuesByLocalId.get(line.localId) ?? [];
                    return (
                      <div
                        key={line.localId}
                        className={`${invoiceCreatorStyles.invoiceLineRow} ${index % 2 === 1 ? invoiceCreatorStyles.invoiceLineRowAlt : ""} ${rowIssues.length ? creatorStyles.lineRowInvalid : ""}`}
                      >
                        <div>
                          <span className={creatorStyles.printOnly}>
                            {costCodes.find((c) => String(c.id) === line.costCode)?.code || "—"}
                          </span>
                          <span className={creatorStyles.screenOnly}>
                            <CostCodeCombobox
                              costCodes={costCodes}
                              value={line.costCode}
                              onChange={(nextValue) => onUpdateLineItem(line.localId, "costCode", nextValue)}
                              ariaLabel="Cost code"
                              allowEmptySelection
                              emptySelectionLabel="No cost code (optional)"
                              placeholder="Search cost code"
                            />
                          </span>
                        </div>
                        <input
                          className={`${creatorStyles.lineInput} ${invoiceCreatorStyles.invoiceLockableControl}`}
                          value={line.description}
                          onChange={(event) =>
                            onUpdateLineItem(line.localId, "description", event.target.value)
                          }
                        />
                        <input
                          className={`${creatorStyles.lineInput} ${invoiceCreatorStyles.invoiceLockableControl}`}
                          value={line.quantity}
                          onChange={(event) =>
                            onUpdateLineItem(line.localId, "quantity", event.target.value)
                          }
                          inputMode="decimal"
                        />
                        <input
                          className={`${creatorStyles.lineInput} ${invoiceCreatorStyles.invoiceLockableControl}`}
                          value={line.unit}
                          onChange={(event) => onUpdateLineItem(line.localId, "unit", event.target.value)}
                        />
                        <input
                          className={`${creatorStyles.lineInput} ${invoiceCreatorStyles.invoiceLockableControl}`}
                          value={line.unitPrice}
                          onChange={(event) =>
                            onUpdateLineItem(line.localId, "unitPrice", event.target.value)
                          }
                          inputMode="decimal"
                        />
                        <span className={`${creatorStyles.amountCell} ${invoiceCreatorStyles.invoiceReadAmount}`}>
                          ${formatDecimal(lineAmount)}
                        </span>
                        <div className={invoiceCreatorStyles.invoiceLineActionsCell}>
                          <button
                            type="button"
                            className={creatorStyles.smallButton}
                            onClick={() => onRemoveLineItem(line.localId)}
                          >
                            Remove
                          </button>
                        </div>
                        {rowIssues.length ? (
                          <p className={creatorStyles.lineIssue}>
                            Row {index + 1}: {rowIssues.join(" ")}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}

              {!workspaceIsLocked ? (
                <div className={invoiceCreatorStyles.invoiceLineActions}>
                  <button
                    type="button"
                    className={creatorStyles.secondaryButton}
                    onClick={onAddLineItem}
                  >
                    Add Line Item
                  </button>
                </div>
              ) : null}

              <div className={invoiceCreatorStyles.invoiceSheetFooter}>
                <div className={invoiceCreatorStyles.invoiceTotalsColumn}>
                  <div className={creatorStyles.summary}>
                    <div className={creatorStyles.summaryRow}>
                      <span>Subtotal</span>
                      <strong>${formatDecimal(draftLineSubtotal)}</strong>
                    </div>
                    <div className={creatorStyles.summaryRow}>
                      <span>Sales Tax</span>
                      <span className={creatorStyles.summaryTaxLine}>
                        <label className={creatorStyles.summaryTaxRate}>
                          <input
                            className={`${creatorStyles.summaryTaxInput} ${invoiceCreatorStyles.invoiceLockableControl}`}
                            value={taxPercent}
                            onChange={(event) => onTaxPercentChange(event.target.value)}
                            inputMode="decimal"
                            disabled={workspaceIsLocked}
                          />
                          <span className={creatorStyles.summaryTaxSuffix}>%</span>
                        </label>
                        <span className={creatorStyles.summaryTaxAmount}>
                          ${formatDecimal(draftTaxTotal)}
                        </span>
                      </span>
                    </div>
                    <div className={`${creatorStyles.summaryRow} ${creatorStyles.summaryTotal}`}>
                      <span>Total</span>
                      <strong>${formatDecimal(draftTotal)}</strong>
                    </div>
                  </div>
                  {canMutateInvoices && !workspaceIsLocked ? (
                    <>
                      {statusMessageAtCreator ? (
                        <p className={`${creatorStyles.actionSuccess} ${invoiceCreatorStyles.invoiceCreateStatusMessage}`}>
                          {statusMessage}
                        </p>
                      ) : null}
                      <div className={invoiceCreatorStyles.invoiceCreateActions}>
                        <button
                          type="submit"
                          className={`${creatorStyles.primaryButton} ${invoiceCreatorStyles.invoiceCreatePrimary}`}
                        >
                          {editingDraftInvoiceId ? "Save Draft" : "Create Invoice"}
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>

              <div className={creatorStyles.terms}>
                <h4>Terms and Conditions</h4>
                {(termsText || organizationInvoiceDefaults?.invoice_terms_and_conditions || "Not set")
                  .split("\n")
                  .filter((line) => line.trim())
                  .map((line, index) => (
                    <p key={`${line}-${index}`}>{line}</p>
                  ))}
              </div>

              <div className={creatorStyles.footer}>
                <span>{senderDisplayName || "Your Company"}</span>
                <span>{senderEmail || "Help email not set"}</span>
                <span>{workspaceInvoiceNumber ? `Invoice ${workspaceInvoiceNumber}` : "New Invoice Draft"}</span>
              </div>
              </>
            ),
            header: () => null,
            meta: () => null,
            line_items: () => null,
            totals: () => null,
            status: () => null,
            status_events: () => null,
            footer: () => null,
          }}
        />
      </div>
      {workspaceSourceInvoice?.status === "paid" ? (
        <div className={`${stampStyles.decisionStamp} ${stampStyles.decisionStampPaid}`}>
          <p className={stampStyles.decisionStampLabel}>Paid</p>
        </div>
      ) : null}

    </div>
  );
}
