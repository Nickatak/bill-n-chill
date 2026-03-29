/**
 * Workspace panel for the change-orders console -- toolbar, create form,
 * edit form (DocumentCreator), contract breakdown, and decision stamp.
 *
 * Pure presentational component: all state and handlers live in the parent
 * ChangeOrdersConsole and are passed down as props.
 *
 * Parent: ChangeOrdersConsole
 */
"use client";

import { FormEvent, RefObject } from "react";
import { formatDecimal } from "@/shared/money-format";
import { DocumentCreator } from "@/shared/document-creator";
import type { DocumentCreatorAdapter, CreatorLineDraft } from "@/shared/document-creator/types";
import { ChangeOrderSheetV2, type ChangeOrderSheetV2Handle } from "./change-order-sheet-v2";
import { ReadOnlyLineTable, readOnlyLineTableStyles as roTableStyles } from "@/shared/document-viewer/read-only-line-table";
import type {
  ChangeOrderLineInput,
  ChangeOrderRecord,
  CostCodeOption,
  OriginEstimateRecord,
} from "../types";
import type { ChangeOrderFormState } from "../document-adapter";
import styles from "./change-orders-console.module.css";
import creatorStyles from "@/shared/document-creator/creator-foundation.module.css";
import changeOrderCreatorStyles from "@/shared/document-creator/change-order-creator.module.css";
import stampStyles from "@/shared/styles/decision-stamp.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LineValidationResult = {
  issues: Array<{ localId: number; rowNumber: number; message: string }>;
  issuesByLocalId: Map<number, string[]>;
};

export type ChangeOrdersWorkspacePanelProps = {
  // Sheet refs (imperative handles for DnD order payloads)
  createSheetRef: RefObject<ChangeOrderSheetV2Handle | null>;
  editSheetRef: RefObject<ChangeOrderSheetV2Handle | null>;

  // Project/estimate context
  selectedProjectId: string;
  selectedViewerEstimateId: string;
  selectedViewerEstimate: OriginEstimateRecord | null;
  projectEstimates: OriginEstimateRecord[];

  // Workspace context
  selectedChangeOrder: ChangeOrderRecord | null;
  selectedViewerChangeOrder: ChangeOrderRecord | null;
  isSelectedChangeOrderEditable: boolean;
  workspaceContext: string;
  workspaceBadgeLabel: string;
  workspaceBadgeClass: string;

  // Toolbar actions
  onStartNew: () => void;
  onDuplicateAsNew: () => void;
  canMutateChangeOrders: boolean;
  role: string;

  // Action feedback
  actionMessage: string;
  actionTone: string;

  // Branding
  senderName: string;
  senderEmail: string;
  senderAddressLines: string[];
  senderLogoUrl: string;

  // Create form
  createCreatorRef: RefObject<HTMLDivElement | null>;
  changeOrderCreatorAdapter: DocumentCreatorAdapter<ChangeOrderRecord, CreatorLineDraft, ChangeOrderFormState>;
  createChangeOrderCreatorFormState: ChangeOrderFormState;
  newTitle: string;
  onNewTitleChange: (value: string) => void;
  newReason: string;
  onNewReasonChange: (value: string) => void;
  newTermsText: string;
  defaultChangeOrderTerms: string;
  newLineItems: ChangeOrderLineInput[];
  newLineValidation: LineValidationResult;
  newLineDeltaTotal: number;
  newLineDaysTotal: number;
  costCodes: CostCodeOption[];
  isCreateSubmitDisabled: boolean;
  onCreateSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onAddNewLine: () => void;
  onRemoveNewLine: (localId: number) => void;
  onUpdateNewLine: (localId: number, updates: Partial<ChangeOrderLineInput>) => void;

  // Edit form
  editCreatorRef: RefObject<HTMLDivElement | null>;
  editChangeOrderCreatorFormState: ChangeOrderFormState;
  editTitle: string;
  onEditTitleChange: (value: string) => void;
  editReason: string;
  onEditReasonChange: (value: string) => void;
  editTermsText: string;
  editLineItems: ChangeOrderLineInput[];
  editLineValidation: LineValidationResult;
  editLineDeltaTotal: number;
  editLineDaysTotal: number;
  isEditSubmitDisabled: boolean;
  onEditSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onAddEditLine: () => void;
  onRemoveEditLine: (localId: number) => void;
  onUpdateEditLine: (localId: number, updates: Partial<ChangeOrderLineInput>) => void;

  // Contract breakdown
  approvedCOsForSelectedEstimate: ChangeOrderRecord[];
  isOriginLineItemsSectionOpen: boolean;
  setIsOriginLineItemsSectionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  currentAcceptedTotal: string | null;
  originalEstimateTotal: string | null;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChangeOrdersWorkspacePanel({
  createSheetRef,
  editSheetRef,
  selectedProjectId,
  selectedViewerEstimateId,
  selectedViewerEstimate,
  projectEstimates,
  selectedChangeOrder,
  selectedViewerChangeOrder,
  isSelectedChangeOrderEditable,
  workspaceContext,
  workspaceBadgeLabel,
  workspaceBadgeClass,
  onStartNew,
  onDuplicateAsNew,
  canMutateChangeOrders,
  role,
  actionMessage,
  actionTone,
  senderName,
  senderEmail,
  senderAddressLines,
  senderLogoUrl,
  createCreatorRef,
  changeOrderCreatorAdapter,
  createChangeOrderCreatorFormState,
  newTitle,
  onNewTitleChange,
  newReason,
  onNewReasonChange,
  newTermsText,
  defaultChangeOrderTerms,
  newLineItems,
  newLineValidation,
  newLineDeltaTotal,
  newLineDaysTotal,
  costCodes,
  isCreateSubmitDisabled,
  onCreateSubmit,
  onAddNewLine,
  onRemoveNewLine,
  onUpdateNewLine,
  editCreatorRef,
  editChangeOrderCreatorFormState,
  editTitle,
  onEditTitleChange,
  editReason,
  onEditReasonChange,
  editTermsText,
  editLineItems,
  editLineValidation,
  editLineDeltaTotal,
  editLineDaysTotal,
  isEditSubmitDisabled,
  onEditSubmit,
  onAddEditLine,
  onRemoveEditLine,
  onUpdateEditLine,
  approvedCOsForSelectedEstimate,
  isOriginLineItemsSectionOpen,
  setIsOriginLineItemsSectionOpen,
  currentAcceptedTotal,
  originalEstimateTotal,
}: ChangeOrdersWorkspacePanelProps) {

  // -------------------------------------------------------------------------
  // Contract breakdown renderer
  // -------------------------------------------------------------------------

  function renderContractBreakdown(opts?: { style?: React.CSSProperties }) {
    if (!selectedViewerEstimate) return null;
    const hasEstimateLines = selectedViewerEstimate.line_items.length > 0;
    const hasApprovedCOs = approvedCOsForSelectedEstimate.length > 0;
    if (!hasEstimateLines && !hasApprovedCOs) return null;

    return (
      <div className={styles.viewerSection} style={opts?.style}>
        <button
          type="button"
          className={styles.viewerSectionToggle}
          onClick={() => setIsOriginLineItemsSectionOpen((v) => !v)}
          aria-expanded={isOriginLineItemsSectionOpen}
        >
          <h4>Contract Breakdown</h4>
          <span className={styles.viewerSectionArrow}>▼</span>
        </button>
        {isOriginLineItemsSectionOpen ? (
          <div className={styles.viewerSectionContent}>
            {hasEstimateLines ? (
              <ReadOnlyLineTable
                caption={`Approved Estimate: ${selectedViewerEstimate.title} v${selectedViewerEstimate.version}`}
                columns={["Cost code", "Description", "Qty", "Unit", "Unit cost", "Markup %", "Line total"]}
                rows={selectedViewerEstimate.line_items.map((line) => {
                  const qty = Number(line.quantity || 0);
                  const unitCost = Number(line.unit_price || 0);
                  const unit = line.unit || "ea";
                  const costCodeLabel = [line.cost_code_code, line.cost_code_name].filter(Boolean).join(" — ") || "—";
                  return {
                    key: line.id,
                    cells: [
                      costCodeLabel,
                      line.description || "—",
                      qty.toFixed(2),
                      unit,
                      `$${unitCost.toFixed(2)}`,
                      `${line.markup_percent}%`,
                      <>
                        <span className={roTableStyles.mobileBreakdown}>
                          {qty.toFixed(2)} {unit} × ${unitCost.toFixed(2)}
                        </span>
                        <span>${line.line_total}</span>
                      </>,
                    ],
                  };
                })}
                mobileColumnLayout={[
                  { order: 0, span: "full" },
                  { order: 1, span: "full" },
                  { order: 2, span: "half", hidden: true },
                  { order: 3, span: "half", hidden: true },
                  { order: 4, span: "half", hidden: true },
                  { order: 5, span: "half" },
                  { order: 6, span: "full", align: "right" },
                ]}
                afterTable={
                  <div className={styles.viewerMetaRow}>
                    <span className={styles.viewerMetaLabel}>Estimate grand total</span>
                    <strong>${selectedViewerEstimate.grand_total}</strong>
                  </div>
                }
              />
            ) : null}

            {hasApprovedCOs ? (
              <ReadOnlyLineTable
                caption={`Approved Change Orders (${approvedCOsForSelectedEstimate.length})`}
                columns={["CO #", "Cost code", "Description", "Days delta", "Amount delta"]}
                rows={approvedCOsForSelectedEstimate.flatMap((co) =>
                  co.line_items.map((line) => {
                    const costCodeLabel = [line.cost_code_code, line.cost_code_name].filter(Boolean).join(" — ") || "—";
                    return {
                      key: `${co.id}-${line.id}`,
                      cells: [
                        co.title,
                        costCodeLabel,
                        line.description || "—",
                        `${line.days_delta} days`,
                        `$${line.amount_delta}`,
                      ],
                    };
                  }),
                )}
                mobileColumnLayout={[
                  { order: 0, span: "full" },
                  { order: 1, span: "half" },
                  { order: 2, span: "full" },
                  { order: 3, span: "half" },
                  { order: 4, span: "half", align: "right" },
                ]}
                afterTable={
                  <div className={styles.viewerMetaRow}>
                    <span className={styles.viewerMetaLabel}>Net contract total</span>
                    <strong>${currentAcceptedTotal ?? "—"}</strong>
                  </div>
                }
              />
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.workspaceWrap}>
      <div className={styles.formToolbar}>
        <div className={styles.formContext}>
          <span className={styles.formContextLabel}>
            {!selectedChangeOrder ? "Creating" : isSelectedChangeOrderEditable ? "Editing" : "Viewing"}
          </span>
          <div className={styles.formContextValueRow}>
            <strong>{workspaceContext}</strong>
            <span className={`${styles.editStatusBadge} ${workspaceBadgeClass}`}>
              {workspaceBadgeLabel}
            </span>
          </div>
        </div>
        <div className={styles.formToolbarActions}>
          <button
            type="button"
            className={styles.primaryCreateButton}
            onClick={onStartNew}
          >
            {selectedChangeOrder ? "New Change Order" : "Reset"}
          </button>
          {selectedChangeOrder ? (
            <button
              type="button"
              className={styles.cloneRevisionButton}
              onClick={onDuplicateAsNew}
              disabled={!canMutateChangeOrders}
            >
              Duplicate Change Order
            </button>
          ) : null}
        </div>
        {actionMessage && actionTone === "success" && /^Copied\b/i.test(actionMessage) ? (
          <p className={creatorStyles.actionSuccess}>{actionMessage}</p>
        ) : null}
      </div>

      {/* Create form */}
      {!selectedChangeOrder ? (
        <div ref={createCreatorRef}>
          <DocumentCreator
          adapter={changeOrderCreatorAdapter}
          document={null}
          formState={createChangeOrderCreatorFormState}
          className={`${creatorStyles.sheet} ${changeOrderCreatorStyles.workflowSheet} ${changeOrderCreatorStyles.createSheet}`}
          sectionClassName={changeOrderCreatorStyles.changeOrderCreatorSection}
          onSubmit={onCreateSubmit}
          sections={[{ slot: "context" }]}
          renderers={{
            context: () => (
              <>
                <div className={creatorStyles.sheetHeader}>
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
                      <p className={creatorStyles.blockMuted}>
                        Set sender address in Organization settings.
                      </p>
                    )}
                  </div>
                  <div className={creatorStyles.headerRight}>
                    <div className={`${creatorStyles.logoBox} ${senderLogoUrl ? creatorStyles.logoBoxHasImage : ""}`}>
                      {senderLogoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo
                        <img
                          className={creatorStyles.logoImage}
                          src={senderLogoUrl}
                          alt={`${senderName || "Company"} logo`}
                        />
                      ) : "No logo set"}
                    </div>
                    <div className={creatorStyles.sheetTitle}>Change Order</div>
                    <div className={`${creatorStyles.sheetTitleValue} ${creatorStyles.printOnly}`}>
                      {newTitle || "Untitled"}
                    </div>
                    <div className={`${creatorStyles.blockMuted} ${creatorStyles.printOnly}`}>Project #{selectedProjectId || "—"}</div>
                    {selectedViewerEstimate ? (
                      <div className={`${creatorStyles.blockMuted} ${creatorStyles.printOnly}`}>
                        Estimate: {selectedViewerEstimate.title || `#${selectedViewerEstimate.id}`} v{selectedViewerEstimate.version}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className={creatorStyles.metaBlock}>
                  <div className={creatorStyles.metaTitle}>Change Order Details</div>
                  <label className={`${creatorStyles.inlineField} ${changeOrderCreatorStyles.coMetaField} ${creatorStyles.screenOnly}`}>
                    <span className={changeOrderCreatorStyles.coMetaLabel}>Title</span>
                    <input
                      className={`${creatorStyles.fieldInput} ${changeOrderCreatorStyles.coMetaInput}`}
                      value={newTitle}
                      onChange={(event) => onNewTitleChange(event.target.value)}
                      required
                    />
                  </label>
                </div>

                <ChangeOrderSheetV2
                  ref={createSheetRef}
                  changeOrderId=""
                  lineItems={newLineItems}
                  costCodes={costCodes}
                  readOnly={false}
                  lineValidation={newLineValidation}
                  onLineItemChange={onUpdateNewLine}
                  onAddLineItem={onAddNewLine}
                  onRemoveLineItem={onRemoveNewLine}
                />

                {renderContractBreakdown({ style: { marginTop: "var(--space-md)" } })}

                <div className={changeOrderCreatorStyles.coSheetFooter}>
                  <div className={changeOrderCreatorStyles.coTotalsColumn}>
                    <div className={`${creatorStyles.summary} ${changeOrderCreatorStyles.coSummaryCard}`}>
                      <div className={creatorStyles.summaryRow}>
                        <span>Original total</span>
                        <span className={changeOrderCreatorStyles.coSummarySecondaryValue}>
                          {originalEstimateTotal ? `$${originalEstimateTotal}` : "—"}
                        </span>
                      </div>
                      <div className={creatorStyles.summaryRow}>
                        <span>Current total (accepted)</span>
                        <span className={changeOrderCreatorStyles.coSummarySecondaryValue}>
                          {currentAcceptedTotal ? `$${currentAcceptedTotal}` : "—"}
                        </span>
                      </div>
                      <div className={creatorStyles.summaryRow}>
                        <span className={changeOrderCreatorStyles.coSummaryPrimaryLabel}>Cost delta ($)</span>
                        <strong>{formatDecimal(newLineDeltaTotal)}</strong>
                      </div>
                      <div className={creatorStyles.summaryRow}>
                        <span className={changeOrderCreatorStyles.coSummaryPrimaryLabel}>Time delta (days)</span>
                        <strong>{newLineDaysTotal}</strong>
                      </div>
                    </div>
                    <div className={changeOrderCreatorStyles.coSheetFooterActions}>
                      {!selectedViewerEstimateId ? (
                        <p className={`${creatorStyles.inlineHint} ${changeOrderCreatorStyles.coFooterHint}`}>
                          Select an approved origin estimate from the history selector before creating a change
                          order.
                        </p>
                      ) : null}
                      {actionMessage && actionTone === "error" ? (
                        <p className={creatorStyles.actionError}>{actionMessage}</p>
                      ) : null}
                      <div className={changeOrderCreatorStyles.coActionButtonRow}>
                        <button
                          type="submit"
                          className={`${creatorStyles.primaryButton} ${changeOrderCreatorStyles.coFooterPrimaryButton}`}
                          disabled={isCreateSubmitDisabled}
                        >
                          Create Change Order
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={creatorStyles.terms}>
                  <h4>Reason</h4>
                  <textarea
                    className={creatorStyles.termsInput}
                    value={newReason}
                    onChange={(e) => onNewReasonChange(e.target.value)}
                    placeholder="Describe why this change order is needed"
                    rows={3}
                  />
                </div>

                <div className={creatorStyles.terms}>
                  <h4>Terms and Conditions</h4>
                  {(newTermsText || defaultChangeOrderTerms || "Not set")
                    .split("\n")
                    .filter((line) => line.trim())
                    .map((line, index) => (
                      <p key={`${line}-${index}`}>{line}</p>
                    ))}
                </div>

                <div className={creatorStyles.footer}>
                  <span>{senderName || "Your Company"}</span>
                  <span>{senderEmail || "Help email not set"}</span>
                  <span>New Change Order Draft</span>
                </div>
              </>
            ),
          }}
          />
        </div>
      ) : null}

      {/* Edit form */}
      {selectedChangeOrder ? (
        <div ref={editCreatorRef} style={{ margin: "14px 0" }}>
        <DocumentCreator
          adapter={changeOrderCreatorAdapter}
          document={selectedChangeOrder}
          formState={editChangeOrderCreatorFormState}
          className={`${creatorStyles.sheet} ${changeOrderCreatorStyles.workflowSheet} ${changeOrderCreatorStyles.editSheet} ${!isSelectedChangeOrderEditable ? changeOrderCreatorStyles.editSheetLocked : ""}`}
          sectionClassName={changeOrderCreatorStyles.changeOrderCreatorSection}
          onSubmit={onEditSubmit}
          sections={[{ slot: "context" }]}
          renderers={{
            context: () => (
              <>
                <div className={creatorStyles.sheetHeader}>
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
                      <p className={creatorStyles.blockMuted}>
                        Set sender address in Organization settings.
                      </p>
                    )}
                  </div>
                  <div className={creatorStyles.headerRight}>
                    <div className={`${creatorStyles.logoBox} ${senderLogoUrl ? creatorStyles.logoBoxHasImage : ""}`}>
                      {senderLogoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo
                        <img
                          className={creatorStyles.logoImage}
                          src={senderLogoUrl}
                          alt={`${senderName || "Company"} logo`}
                        />
                      ) : "No logo set"}
                    </div>
                    <div className={`${creatorStyles.sheetTitle} ${creatorStyles.screenOnly}`}>Change Order Revision</div>
                    <div className={`${creatorStyles.sheetTitle} ${creatorStyles.printOnly}`}>Change Order</div>
                    <div className={`${creatorStyles.sheetTitleValue} ${creatorStyles.printOnly}`}>
                      {editTitle || "Untitled"}
                    </div>
                    {(() => {
                      const originEst = selectedChangeOrder?.origin_estimate
                        ? projectEstimates.find((e) => e.id === selectedChangeOrder.origin_estimate)
                        : null;
                      return originEst ? (
                        <div className={`${creatorStyles.blockMuted} ${creatorStyles.printOnly}`}>
                          Estimate: {originEst.title || `#${originEst.id}`} v{originEst.version}
                        </div>
                      ) : null;
                    })()}
                  </div>
                </div>

                <div className={creatorStyles.metaBlock}>
                  <div className={creatorStyles.metaTitle}>Change Order Details</div>
                  <label className={`${creatorStyles.inlineField} ${changeOrderCreatorStyles.coMetaField} ${creatorStyles.screenOnly}`}>
                    <span className={changeOrderCreatorStyles.coMetaLabel}>Title</span>
                    <input
                      className={`${creatorStyles.fieldInput} ${changeOrderCreatorStyles.coMetaInput} ${changeOrderCreatorStyles.lockableControl}`}
                      value={editTitle}
                      onChange={(event) => onEditTitleChange(event.target.value)}
                      disabled={!isSelectedChangeOrderEditable}
                      required
                    />
                  </label>
                </div>

                <ChangeOrderSheetV2
                  ref={editSheetRef}
                  changeOrderId={selectedChangeOrder ? String(selectedChangeOrder.id) : ""}
                  lineItems={editLineItems}
                  costCodes={costCodes}
                  readOnly={!isSelectedChangeOrderEditable}
                  lineValidation={editLineValidation}
                  apiSections={selectedChangeOrder?.sections}
                  onLineItemChange={onUpdateEditLine}
                  onAddLineItem={onAddEditLine}
                  onRemoveLineItem={onRemoveEditLine}
                />

                {renderContractBreakdown({ style: { marginTop: "var(--space-md)" } })}

                <div className={changeOrderCreatorStyles.coSheetFooter}>
                  <div className={changeOrderCreatorStyles.coTotalsColumn}>
                    <div className={`${creatorStyles.summary} ${changeOrderCreatorStyles.coSummaryCard}`}>
                      <div className={creatorStyles.summaryRow}>
                        <span>Original total</span>
                        <span className={changeOrderCreatorStyles.coSummarySecondaryValue}>
                          {originalEstimateTotal ? `$${originalEstimateTotal}` : "—"}
                        </span>
                      </div>
                      <div className={creatorStyles.summaryRow}>
                        <span>Current total (accepted)</span>
                        <span className={changeOrderCreatorStyles.coSummarySecondaryValue}>
                          {currentAcceptedTotal ? `$${currentAcceptedTotal}` : "—"}
                        </span>
                      </div>
                      <div className={creatorStyles.summaryRow}>
                        <span className={changeOrderCreatorStyles.coSummaryPrimaryLabel}>Cost delta ($)</span>
                        <strong>{formatDecimal(editLineDeltaTotal)}</strong>
                      </div>
                      <div className={creatorStyles.summaryRow}>
                        <span className={changeOrderCreatorStyles.coSummaryPrimaryLabel}>Time delta (days)</span>
                        <strong>{editLineDaysTotal}</strong>
                      </div>
                    </div>
                    <div className={changeOrderCreatorStyles.coSheetFooterActions}>
                      {actionMessage && actionTone === "success" ? (
                        <p className={creatorStyles.actionSuccess}>{actionMessage}</p>
                      ) : null}
                      {actionMessage && actionTone === "error" ? (
                        <p className={creatorStyles.actionError}>{actionMessage}</p>
                      ) : null}
                      {isSelectedChangeOrderEditable ? (
                        <div className={changeOrderCreatorStyles.coActionButtonRow}>
                          <button
                            type="submit"
                            className={`${creatorStyles.primaryButton} ${changeOrderCreatorStyles.coFooterPrimaryButton}`}
                            disabled={isEditSubmitDisabled}
                          >
                            Save Change Order
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className={creatorStyles.terms}>
                  <h4>Reason</h4>
                  {!isSelectedChangeOrderEditable ? (
                    (editReason || "None")
                      .split("\n")
                      .filter((line) => line.trim())
                      .map((line, index) => <p key={`reason-${index}`}>{line}</p>)
                  ) : (
                    <textarea
                      className={creatorStyles.termsInput}
                      value={editReason}
                      onChange={(e) => onEditReasonChange(e.target.value)}
                      placeholder="Describe why this change order is needed"
                      rows={3}
                    />
                  )}
                </div>

                <div className={creatorStyles.terms}>
                  <h4>Terms and Conditions</h4>
                  {(editTermsText || defaultChangeOrderTerms || "Not set")
                    .split("\n")
                    .filter((line) => line.trim())
                    .map((line, index) => (
                      <p key={`${line}-${index}`}>{line}</p>
                    ))}
                </div>

                <div className={creatorStyles.footer}>
                  <span>{senderName || "Your Company"}</span>
                  <span>{senderEmail || "Help email not set"}</span>
                  <span>
                    {selectedChangeOrder
                      ? `Change Order: ${selectedChangeOrder.title || "Untitled"}`
                      : "Change Order"}
                  </span>
                </div>
              </>
            ),
          }}
        />
        {selectedChangeOrder && (selectedChangeOrder.status === "approved" || selectedChangeOrder.status === "rejected") ? (
          <div
            className={`${stampStyles.decisionStamp} ${
              selectedChangeOrder.status === "approved" ? stampStyles.decisionStampApproved
              : stampStyles.decisionStampRejected
            }`}
          >
            <p className={stampStyles.decisionStampLabel}>
              {selectedChangeOrder.status === "approved" ? "Approved" : "Rejected"}
            </p>
          </div>
        ) : null}
        </div>
      ) : null}
    </div>
  );
}
