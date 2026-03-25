/**
 * Workspace panel for the estimates console — toolbar, family-collision
 * prompt, document creator (EstimateSheet), and decision stamp.
 *
 * Pure presentational component: all state and handlers live in the parent
 * EstimatesConsole and are passed down as props.
 *
 * Parent: EstimatesConsole
 */
"use client";

import { RefObject } from "react";
import type { LineValidationResult } from "../helpers";
import { EstimateSheet, OrganizationDocumentDefaults } from "./estimate-sheet";
import type {
  CostCode,
  EstimateLineInput,
  EstimateRecord,
  ProjectRecord,
} from "../types";
import styles from "./estimates-console.module.css";
import stampStyles from "@/shared/styles/decision-stamp.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LineSortKey = "quantity" | "costCode" | "unitCost" | "markupPercent" | "amount";

type EstimateFamilyCollisionPrompt = {
  title: string;
  latestEstimateId: number | null;
  latestVersion: number | null;
  familySize: number | null;
};

export type EstimatesWorkspacePanelProps = {
  // Workspace context
  workspaceContextLabel: string;
  workspaceContext: string;
  workspaceBadgeClass: string;
  workspaceBadgeLabel: string;
  selectedEstimate: EstimateRecord | null;

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
  familyCollisionPrompt: EstimateFamilyCollisionPrompt | null;
  estimateTitle: string;
  selectedProjectId: string;
  onConfirmCollision: (projectId: number, title: string) => void;
  onDismissCollision: () => void;

  // Read-only hint
  canMutateEstimates: boolean;
  role: string;

  // Creator (EstimateSheet pass-through)
  estimateComposerRef: RefObject<HTMLDivElement | null>;
  organizationDefaults: OrganizationDocumentDefaults | null;
  estimateId: string;
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
  formErrorMessage: string;
  formSuccessMessage: string;
  lineValidation: LineValidationResult;
  lineSortKey: LineSortKey | null;
  lineSortDirection: "asc" | "desc";
  onTitleChange: (title: string) => void;
  onValidThroughChange: (value: string) => void;
  onTaxPercentChange: (value: string) => void;
  onLineItemChange: (localId: number, key: keyof Omit<EstimateLineInput, "localId">, value: string) => void;
  onAddLineItem: () => void;
  onMoveLineItem: (localId: number, direction: "up" | "down") => void;
  onDuplicateLineItem: (localId: number) => void;
  onRemoveLineItem: (localId: number) => void;
  onSortLineItems: (key: LineSortKey) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EstimatesWorkspacePanel({
  workspaceContextLabel,
  workspaceContext,
  workspaceBadgeClass,
  workspaceBadgeLabel,
  selectedEstimate,
  onStartNew,
  onDuplicateAsNew,
  actionMessage,
  actionTone,
  titleLocked,
  duplicateHint,
  selectedProject,
  familyCollisionPrompt,
  estimateTitle,
  selectedProjectId,
  onConfirmCollision,
  onDismissCollision,
  canMutateEstimates,
  role,
  estimateComposerRef,
  organizationDefaults,
  estimateId,
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
  formErrorMessage,
  formSuccessMessage,
  lineValidation,
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
}: EstimatesWorkspacePanelProps) {
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
              New Estimate opens a fresh draft workspace. Duplicate copies the selected estimate into the create form.
            </p>
          </div>
          <div className={`${styles.lifecycleActions} ${styles.composerPrepActions} ${styles.workspaceToolbarActions}`}>
            <button type="button" className={styles.toolbarPrimaryButton} onClick={onStartNew}>
              {selectedEstimate ? "New Estimate" : "Reset"}
            </button>
            {selectedEstimate ? (
              <button
                type="button"
                className={styles.toolbarSecondaryButton}
                onClick={onDuplicateAsNew}
              >
                Duplicate Estimate
              </button>
            ) : null}
          </div>
        </div>
        {actionMessage && actionTone !== "success" ? <p className={`${styles.actionError} ${styles.composerPrepMessage}`}>{actionMessage}</p> : null}
        {familyCollisionPrompt ? (
          <div className={`${styles.duplicatePanel} ${styles.composerPrepPanel}`}>
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
                onClick={() => {
                  const projectId = Number(selectedProjectId);
                  const trimmedTitle = estimateTitle.trim();
                  if (projectId && trimmedTitle) {
                    onConfirmCollision(projectId, trimmedTitle);
                  }
                }}
              >
                Create Revision In Existing Family
              </button>
              <button
                type="button"
                onClick={onDismissCollision}
              >
                Use Different Title
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {!canMutateEstimates ? (
        <p className={styles.inlineHint}>Role `{role}` can view estimates but cannot create or update.</p>
      ) : null}

      <div ref={estimateComposerRef}>
        <EstimateSheet
          project={selectedProject}
          organizationDefaults={organizationDefaults}
          estimateId={estimateId}
          estimateTitle={estimateTitle}
          estimateDate={estimateDate}
          validThrough={validThrough}
          termsText={termsText}
          taxPercent={taxPercent}
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
          lineSortKey={lineSortKey}
          lineSortDirection={lineSortDirection}
          onTitleChange={onTitleChange}
          onValidThroughChange={onValidThroughChange}
          onTaxPercentChange={onTaxPercentChange}
          onLineItemChange={onLineItemChange}
          onAddLineItem={onAddLineItem}
          onMoveLineItem={onMoveLineItem}
          onDuplicateLineItem={onDuplicateLineItem}
          onRemoveLineItem={onRemoveLineItem}
          onSortLineItems={onSortLineItems}
          onSubmit={onSubmit}
        />
        {selectedEstimate && (selectedEstimate.status === "approved" || selectedEstimate.status === "rejected") ? (
          <div
            className={`${stampStyles.decisionStamp} ${
              selectedEstimate.status === "approved" ? stampStyles.decisionStampApproved
              : stampStyles.decisionStampRejected
            }`}
          >
            <p className={stampStyles.decisionStampLabel}>
              {selectedEstimate.status === "approved" ? "Approved" : "Rejected"}
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}
