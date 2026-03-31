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

import { FormEvent, ReactNode, RefObject, useMemo, useState } from "react";
import { DndContext, closestCenter, type DragEndEvent, type Modifier } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { parseAmount, formatDecimal, formatCurrency } from "@/shared/money-format";
import { BillingScheduleEditor } from "@/features/quotes/components/billing-schedule-editor";
import type { BillingPeriodInput } from "@/features/quotes/types";
import { DocumentCreator } from "@/shared/document-creator";
import type { DocumentCreatorAdapter, CreatorLineDraft } from "@/shared/document-creator/types";
import { CostCodeCombobox } from "@/features/quotes/components/cost-code-combobox";
import { ReadOnlyLineTable } from "@/shared/document-viewer/read-only-line-table";
import type {
  CostCode,
  InvoiceLineInput,
  InvoiceRecord,
  OrganizationInvoiceDefaults,
  ProjectRecord,
} from "../types";
import type { SchedulePeriodOption } from "../hooks/use-invoice-data";
import type { InvoiceFormState } from "../document-adapter";
import styles from "./invoices-console.module.css";
import creatorStyles from "@/shared/document-creator/creator-foundation.module.css";
import invoiceCreatorStyles from "@/shared/document-creator/invoice-creator.module.css";
import stampStyles from "@/shared/styles/decision-stamp.module.css";
import lineStyles from "./invoice-line-row.module.css";

// ---------------------------------------------------------------------------
// DnD helpers
// ---------------------------------------------------------------------------

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

function SortableEntry({ id, disabled, children }: {
  id: string;
  disabled?: boolean;
  children: (handleProps: Record<string, unknown>) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  const handleProps = { ...attributes, ...listeners };
  return (
    <div ref={setNodeRef} style={style}>
      {children(handleProps)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LineValidation = {
  issues: Array<{ localId: number; message: string }>;
  issuesByLocalId: Map<number, string[]>;
};

export type InvoicesWorkspacePanelProps = {
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
  onReorderLineItem: (activeId: number, overId: number) => void;

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
  statusTone: string;

  // Terms
  termsText: string;
  organizationInvoiceDefaults: OrganizationInvoiceDefaults | null;

  // Schedule prefill
  schedulePeriodOptions: SchedulePeriodOption[];
  onPrefillFromSchedule: (option: SchedulePeriodOption) => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InvoicesWorkspacePanel({
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
  onReorderLineItem,
  draftLineSubtotal,
  draftTaxTotal,
  draftTotal,
  taxPercent,
  onTaxPercentChange,
  onSubmit,
  statusMessageAtCreator,
  statusTone,
  termsText,
  organizationInvoiceDefaults,
  schedulePeriodOptions,
  onPrefillFromSchedule,
}: InvoicesWorkspacePanelProps) {
  const [scheduleDropdownOpen, setScheduleDropdownOpen] = useState(false);
  const schedule = workspaceSourceInvoice?.payment_schedule;
  const periods = schedule?.periods;
  const schedulePeriods: BillingPeriodInput[] = useMemo(() => {
    if (!periods) return [];
    return periods.map((p, i) => ({
      localId: i,
      description: p.description,
      percent: p.percent,
      dueDate: p.due_date || "",
    }));
  }, [periods]);
  const scheduleTotal = schedule ? parseAmount(schedule.quote_total) : 0;

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
            {schedulePeriodOptions.length > 0 ? (
              <div className={styles.schedulePrefillWrap}>
                <button
                  type="button"
                  className={styles.toolbarSecondaryButton}
                  onClick={() => setScheduleDropdownOpen(!scheduleDropdownOpen)}
                >
                  From Schedule ▾
                </button>
                {scheduleDropdownOpen ? (
                  <div className={styles.schedulePrefillDropdown}>
                    {schedulePeriodOptions.map((option) => (
                      <button
                        key={option.billingPeriodId}
                        type="button"
                        className={styles.schedulePrefillOption}
                        onClick={() => {
                          onPrefillFromSchedule(option);
                          setScheduleDropdownOpen(false);
                        }}
                      >
                        <span className={styles.schedulePrefillLabel}>
                          {option.description || "Untitled period"}
                        </span>
                        <span className={styles.schedulePrefillMeta}>
                          {option.percent}% — {formatCurrency(option.amount)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
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
                  <label className={creatorStyles.inlineField}>
                    Invoice #
                    <input
                      className={`${creatorStyles.fieldInput} ${invoiceCreatorStyles.invoiceNumberInput} ${!workspaceSourceInvoice ? invoiceCreatorStyles.invoiceNumberNew : ""}`}
                      value={workspaceInvoiceNumber}
                      readOnly
                      disabled
                      autoComplete="one-time-code"
                      aria-label="Invoice number"
                    />
                  </label>
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
              ) : (
                <DndContext
                  collisionDetection={closestCenter}
                  onDragEnd={(event: DragEndEvent) => {
                    const { active, over } = event;
                    if (!over || active.id === over.id) return;
                    onReorderLineItem(Number(active.id), Number(over.id));
                  }}
                  modifiers={[verticalOnly]}
                >
                  <SortableContext
                    items={lineItems.map((l) => String(l.localId))}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className={lineStyles.list}>
                      {lineItems.map((line, index) => {
                        const lineAmount = parseAmount(line.quantity) * parseAmount(line.unitPrice);
                        const rowIssues = lineValidation.issuesByLocalId.get(line.localId) ?? [];
                        return (
                          <SortableEntry key={line.localId} id={String(line.localId)}>
                            {(handleProps) => (
                              <div className={`${lineStyles.row} ${rowIssues.length ? lineStyles.rowInvalid : ""}`}>
                                <button type="button" className={lineStyles.removeX} onClick={() => onRemoveLineItem(line.localId)} aria-label="Remove line item">&times;</button>
                                <span className={lineStyles.rowIndex} {...handleProps}>
                                  <span className={lineStyles.dragGrip}>⠿</span> Item {index + 1}
                                </span>
                                <div className={`${lineStyles.field} ${lineStyles.fieldCostCode}`}>
                                  <span className={lineStyles.fieldLabel}>Cost Code</span>
                                  <CostCodeCombobox
                                    costCodes={costCodes}
                                    value={line.costCode}
                                    onChange={(v) => onUpdateLineItem(line.localId, "costCode", v)}
                                    ariaLabel="Cost code"
                                    allowEmptySelection
                                    emptySelectionLabel="No cost code (optional)"
                                    placeholder="Search cost code"
                                  />
                                </div>
                                <div className={`${lineStyles.field} ${lineStyles.fieldDesc}`}>
                                  <span className={lineStyles.fieldLabel}>Description</span>
                                  <input className={lineStyles.fieldInput} aria-label="Description" value={line.description}
                                    onChange={(e) => onUpdateLineItem(line.localId, "description", e.target.value)} required />
                                </div>
                                <div className={`${lineStyles.field} ${lineStyles.fieldQty}`}>
                                  <span className={lineStyles.fieldLabel}>Qty</span>
                                  <input className={lineStyles.fieldInput} aria-label="Quantity" value={line.quantity}
                                    onChange={(e) => onUpdateLineItem(line.localId, "quantity", e.target.value)} inputMode="decimal" required />
                                </div>
                                <div className={`${lineStyles.field} ${lineStyles.fieldUnit}`}>
                                  <span className={lineStyles.fieldLabel}>Unit</span>
                                  <input className={lineStyles.fieldInput} aria-label="Unit" value={line.unit}
                                    onChange={(e) => onUpdateLineItem(line.localId, "unit", e.target.value)} required />
                                </div>
                                <div className={`${lineStyles.field} ${lineStyles.fieldPrice}`}>
                                  <span className={lineStyles.fieldLabel}>Unit Price</span>
                                  <input className={lineStyles.fieldInput} aria-label="Unit price" value={line.unitPrice}
                                    onChange={(e) => onUpdateLineItem(line.localId, "unitPrice", e.target.value)} inputMode="decimal" required />
                                </div>
                                <div className={`${lineStyles.field} ${lineStyles.fieldAmount}`}>
                                  <span className={lineStyles.fieldLabel}>Amount</span>
                                  <span className={lineStyles.amountValue}>${formatDecimal(lineAmount)}</span>
                                </div>
                                {rowIssues.length ? (
                                  <p className={lineStyles.validationError}>Row {index + 1}: {rowIssues.join(" ")}</p>
                                ) : null}
                              </div>
                            )}
                          </SortableEntry>
                        );
                      })}
                    </div>
                  </SortableContext>
                </DndContext>
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
                  {statusMessageAtCreator ? (
                    <p className={`${invoiceCreatorStyles.invoiceCreateStatusMessage} ${
                      statusTone === "error"
                        ? creatorStyles.actionError
                        : creatorStyles.actionSuccess
                    }`}>
                      {statusMessage}
                    </p>
                  ) : null}
                  {canMutateInvoices && !workspaceIsLocked ? (
                    <div className={invoiceCreatorStyles.invoiceCreateActions}>
                      <button
                        type="submit"
                        className={`${creatorStyles.primaryButton} ${invoiceCreatorStyles.invoiceCreatePrimary}`}
                      >
                        {editingDraftInvoiceId ? "Save Draft" : "Create Invoice"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              {schedulePeriods.length > 0 ? (
                <BillingScheduleEditor
                  periods={schedulePeriods}
                  quoteTotal={scheduleTotal}
                  readOnly
                />
              ) : null}

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
