/**
 * Workspace panel for the quotes console — toolbar, family-collision
 * prompt, document creator (QuoteSheet), and decision stamp.
 *
 * Pure presentational component: all state and handlers live in the parent
 * QuotesConsole and are passed down as props.
 *
 * Parent: QuotesConsole
 */
"use client";

import { RefObject, useEffect, useRef } from "react";
import type { LineValidationResult } from "../helpers";
import { QuoteSheetV2, type QuoteSheetV2Handle, type OrganizationDocumentDefaults } from "./quote-sheet-v2";
import type {
  BillingPeriodInput,
  CostCode,
  QuoteLineInput,
  QuoteRecord,
  QuoteSectionRecord,
  ProjectRecord,
} from "../types";
import styles from "./quotes-console.module.css";
import stampStyles from "@/shared/styles/decision-stamp.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QuoteFamilyCollisionPrompt = {
  title: string;
  latestQuoteId: number | null;
  latestVersion: number | null;
  familySize: number | null;
};

export type QuotesWorkspacePanelProps = {
  // Workspace context
  workspaceContextLabel: string;
  workspaceContext: string;
  workspaceBadgeClass: string;
  workspaceBadgeLabel: string;
  selectedQuote: QuoteRecord | null;

  // Toolbar actions
  onStartNew: () => void;
  onDuplicateAsNew: () => void;

  // Action feedback
  actionMessage: string;
  actionTone: string;

  // Title lock (from duplicate-as-new)
  titleLocked: boolean;
  duplicateHint: string;
  selectedProject: ProjectRecord | null;

  // Family collision prompt
  familyCollisionPrompt: QuoteFamilyCollisionPrompt | null;
  quoteTitle: string;
  selectedProjectId: string;
  onConfirmCollision: (projectId: number, title: string) => void;
  onDismissCollision: () => void;

  // Read-only hint
  canMutateQuotes: boolean;
  role: string;

  // Creator (QuoteSheetV2 pass-through)
  quoteComposerRef: RefObject<HTMLDivElement | null>;
  sheetRef: RefObject<QuoteSheetV2Handle | null>;
  organizationDefaults: OrganizationDocumentDefaults | null;
  quoteId: string;
  quoteDate: string;
  validThrough: string;
  termsText: string;
  notesText: string;
  taxPercent: string;
  contingencyPercent: string;
  contingencyAmount: number;
  overheadProfitPercent: string;
  overheadProfitAmount: number;
  insurancePercent: string;
  insuranceAmount: number;
  lineItems: QuoteLineInput[];
  lineTotals: number[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  costCodes: CostCode[];
  canSubmit: boolean;
  isSubmitting: boolean;
  isEditingDraft: boolean;
  readOnly: boolean;
  formErrorMessage: string;
  formSuccessMessage: string;
  lineValidation: LineValidationResult;
  apiSections?: QuoteSectionRecord[];
  billingPeriods: BillingPeriodInput[];
  onBillingPeriodsChange?: (periods: BillingPeriodInput[]) => void;
  billingPeriodsError?: string;
  onTitleChange: (title: string) => void;
  onValidThroughChange: (value: string) => void;
  onTaxPercentChange: (value: string) => void;
  onContingencyPercentChange: (value: string) => void;
  onOverheadProfitPercentChange: (value: string) => void;
  onInsurancePercentChange: (value: string) => void;
  onNotesTextChange: (value: string) => void;
  onLineItemChange: (localId: number, key: keyof Omit<QuoteLineInput, "localId">, value: string) => void;
  onAddLineItem: () => void;
  onRemoveLineItem: (localId: number) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QuotesWorkspacePanel({
  workspaceContextLabel,
  workspaceContext,
  workspaceBadgeClass,
  workspaceBadgeLabel,
  selectedQuote,
  onStartNew,
  onDuplicateAsNew,
  actionMessage,
  actionTone,
  titleLocked,
  duplicateHint,
  selectedProject,
  familyCollisionPrompt,
  quoteTitle,
  selectedProjectId,
  onConfirmCollision,
  onDismissCollision,
  canMutateQuotes,
  role,
  quoteComposerRef,
  sheetRef,
  organizationDefaults,
  quoteId,
  quoteDate,
  validThrough,
  termsText,
  notesText,
  taxPercent,
  contingencyPercent,
  contingencyAmount,
  overheadProfitPercent,
  overheadProfitAmount,
  insurancePercent,
  insuranceAmount,
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
  formErrorMessage,
  formSuccessMessage,
  lineValidation,
  apiSections,
  billingPeriods,
  onBillingPeriodsChange,
  billingPeriodsError,
  onTitleChange,
  onValidThroughChange,
  onTaxPercentChange,
  onContingencyPercentChange,
  onOverheadProfitPercentChange,
  onInsurancePercentChange,
  onNotesTextChange,
  onLineItemChange,
  onAddLineItem,
  onRemoveLineItem,
  onSubmit,
}: QuotesWorkspacePanelProps) {
  const collisionDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = collisionDialogRef.current;
    if (!dialog) return;
    if (familyCollisionPrompt && !dialog.open) {
      dialog.showModal();
    } else if (!familyCollisionPrompt && dialog.open) {
      dialog.close();
    }
  }, [familyCollisionPrompt]);

  return (
    <>
      <section className={styles.composerPrep}>
        <div className={styles.workspaceToolbar}>
          <div className={styles.workspaceContext}>
            <span className={styles.workspaceContextLabel}>{workspaceContextLabel}</span>
            <div className={styles.workspaceContextValueRow}>
              <strong>{workspaceContext}</strong>
              <span className={`${styles.versionStatus} ${workspaceBadgeClass}`}>
                {workspaceBadgeLabel}
              </span>
            </div>
            <p className={styles.workspaceToolbarHint}>
              New Quote opens a fresh draft workspace. Duplicate copies the selected quote into the create form.
            </p>
          </div>
          <div className={`${styles.lifecycleActions} ${styles.composerPrepActions} ${styles.workspaceToolbarActions}`}>
            <button type="button" className={styles.toolbarPrimaryButton} onClick={onStartNew}>
              {selectedQuote ? "New Quote" : "Reset"}
            </button>
            {selectedQuote ? (
              <button
                type="button"
                className={styles.toolbarSecondaryButton}
                onClick={onDuplicateAsNew}
              >
                Duplicate Quote
              </button>
            ) : null}
          </div>
        </div>
        {actionMessage && actionTone !== "success" ? <p className={`${styles.actionError} ${styles.composerPrepMessage}`}>{actionMessage}</p> : null}
        <dialog ref={collisionDialogRef} className={styles.duplicateDialog}>
          {familyCollisionPrompt ? (
            <>
              <p className={styles.inlineHint}>
                A family titled <strong>{familyCollisionPrompt.title}</strong> already exists
                {familyCollisionPrompt.latestVersion
                  ? ` (latest v${familyCollisionPrompt.latestVersion})`
                  : ""}
                . Creating now will add a new version to that family.
              </p>
              <div className={styles.lifecycleActions}>
                <button
                  type="button"
                  className={`${styles.lifecycleActionButton} ${styles.lifecycleActionButtonPrimary}`}
                  onClick={() => {
                    const projectId = Number(selectedProjectId);
                    const trimmedTitle = quoteTitle.trim();
                    if (projectId && trimmedTitle) {
                      onConfirmCollision(projectId, trimmedTitle);
                    }
                  }}
                >
                  Create Revision In Existing Family
                </button>
                <button
                  type="button"
                  className={styles.lifecycleActionButton}
                  onClick={onDismissCollision}
                >
                  Use Different Title
                </button>
              </div>
            </>
          ) : null}
        </dialog>
      </section>

      {!canMutateQuotes ? (
        <p className={styles.inlineHint}>Role `{role}` can view quotes but cannot create or update.</p>
      ) : null}

      <div ref={quoteComposerRef}>
        <QuoteSheetV2
          ref={sheetRef}
          project={selectedProject}
          organizationDefaults={organizationDefaults}
          quoteId={quoteId}
          quoteTitle={quoteTitle}
          quoteDate={quoteDate}
          validThrough={validThrough}
          termsText={termsText}
          notesText={notesText}
          taxPercent={taxPercent}
          contingencyPercent={contingencyPercent}
          contingencyAmount={contingencyAmount}
          overheadProfitPercent={overheadProfitPercent}
          overheadProfitAmount={overheadProfitAmount}
          insurancePercent={insurancePercent}
          insuranceAmount={insuranceAmount}
          lineItems={lineItems}
          lineTotals={lineTotals}
          subtotal={subtotal}
          taxAmount={taxAmount}
          totalAmount={totalAmount}
          costCodes={costCodes}
          canSubmit={canSubmit}
          isSubmitting={isSubmitting}
          isEditingDraft={isEditingDraft}
          readOnly={readOnly}
          titleLocked={titleLocked}
          duplicateHint={duplicateHint}
          formErrorMessage={formErrorMessage}
          formSuccessMessage={formSuccessMessage}
          lineValidation={lineValidation}
          apiSections={apiSections}
          billingPeriods={billingPeriods}
          onBillingPeriodsChange={onBillingPeriodsChange}
          billingPeriodsError={billingPeriodsError}
          onTitleChange={onTitleChange}
          onValidThroughChange={onValidThroughChange}
          onTaxPercentChange={onTaxPercentChange}
          onContingencyPercentChange={onContingencyPercentChange}
          onOverheadProfitPercentChange={onOverheadProfitPercentChange}
          onInsurancePercentChange={onInsurancePercentChange}
          onNotesTextChange={onNotesTextChange}
          onLineItemChange={onLineItemChange}
          onAddLineItem={onAddLineItem}
          onRemoveLineItem={onRemoveLineItem}
          onSubmit={onSubmit}
        />
        {selectedQuote && (selectedQuote.status === "approved" || selectedQuote.status === "rejected") ? (
          <div
            className={`${stampStyles.decisionStamp} ${
              selectedQuote.status === "approved" ? stampStyles.decisionStampApproved
              : stampStyles.decisionStampRejected
            }`}
          >
            <p className={stampStyles.decisionStampLabel}>
              {selectedQuote.status === "approved" ? "Approved" : "Rejected"}
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}
