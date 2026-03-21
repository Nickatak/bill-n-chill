"use client";

/**
 * Change orders console -- the primary internal workspace for managing change
 * orders within a project. Orchestrates hook-provided state for estimate-linked
 * revision browsing, draft creation/editing, status transitions with
 * quick-status pills, audit event history, and cost-code-based line-item creators.
 *
 * Parent: ProjectChangeOrdersPage (via `app/projects/[projectId]/change-orders/page.tsx`)
 *
 * ## Page layout
 *
 * ┌──────────────────────────────────────────────────────┐
 * │ actionMessage banner (error/info only)               │
 * │ read-only role hint (when !canMutateChangeOrders)    │
 * ├──────────────────────────────────────────────────────┤
 * │ ChangeOrdersViewerPanel                              │
 * │  (estimate rail, CO list, status pills, audit log)   │
 * ├──────────────────────────────────────────────────────┤
 * │ ChangeOrdersWorkspacePanel                           │
 * │  (create form + edit form, line items, branding)     │
 * └──────────────────────────────────────────────────────┘
 *
 * ## Hook dependency graph
 *
 * useChangeOrderProjectData  ← auth, scoped IDs
 *   └→ useChangeOrderForm    ← (no deps on other hooks)
 *        └→ useChangeOrderViewer  ← project data + form selection + policy
 *
 * ## Functions (local orchestration)
 *
 * - addNewLine / addEditLine          — line add with min-line error clearing
 * - removeNewLine / removeEditLine    — line remove with min-line enforcement
 * - handleStartNewChangeOrder         — reset workspace to create mode
 * - handleCreateChangeOrder           — POST new CO, refresh list, hydrate edit
 * - handleUpdateChangeOrder           — PATCH existing CO, refresh list
 * - handleCloneRevision               — POST clone, refresh list, hydrate edit
 * - handleQuickUpdateStatus           — PATCH status transition or resend
 * - handleAddChangeOrderStatusNote    — PATCH status note (no status change)
 * - handleSelectViewerEstimate        — estimate rail click handler
 *
 * ## Effects
 *
 * - Bootstrap: loadProjects on token change (via project-data hook)
 * - Printable: sync printable state with selectedChangeOrderId
 * - Auto-title: sync newTitle from project name when not manually edited
 * - Viewer sync: re-hydrate edit form when selected CO leaves the visible set
 * - Org defaults: sync newTermsText when org defaults load
 *
 * ## Orchestration (in JSX)
 *
 * Renders ChangeOrdersViewerPanel and ChangeOrdersWorkspacePanel, threading
 * hook-provided state and local handlers as props. No domain logic in the
 * template — all behavior lives in hooks or local handler functions.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useCreatorFlash } from "@/shared/hooks/use-creator-flash";
import { formatDecimal } from "@/shared/money-format";
import {
  coLabel,
  defaultChangeOrderTitle,
  readChangeOrderApiError,
} from "../helpers";
import { apiBaseUrl } from "@/shared/api/base";
import { usePolicyContract } from "@/shared/hooks/use-policy-contract";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import type {
  ApiResponse,
  ChangeOrderPolicyContract,
  ChangeOrderRecord,
} from "../types";
import {
  CHANGE_ORDER_STATUS_LABELS_FALLBACK,
  CHANGE_ORDER_STATUSES_FALLBACK,
  CHANGE_ORDER_ALLOWED_STATUS_TRANSITIONS_FALLBACK,
  CHANGE_ORDER_MIN_LINE_ITEMS_ERROR,
  statusLabel,
  toLinePayload,
} from "./change-orders-display";
import { usePrintable } from "@/shared/shell/printable-context";
import styles from "./change-orders-console.module.css";
import creatorStyles from "@/shared/document-creator/creator-foundation.module.css";
import {
  resolveOrganizationBranding,
} from "@/shared/document-creator";
import {
  fetchChangeOrderPolicyContract,
} from "../api";
import { useMediaQuery } from "@/shared/hooks/use-media-query";
import { ChangeOrdersViewerPanel } from "./change-orders-viewer-panel";
import { ChangeOrdersWorkspacePanel } from "./change-orders-workspace-panel";
import { useChangeOrderProjectData } from "../hooks/use-change-order-project-data";
import { useChangeOrderForm } from "../hooks/use-change-order-form";
import { useChangeOrderViewer } from "../hooks/use-change-order-viewer";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type ChangeOrdersConsoleProps = {
  scopedProjectId?: number | null;
  initialOriginEstimateId?: number | null;
};


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Internal change-orders workspace: estimate-linked viewer, dual creators (create + edit), and status lifecycle. */
export function ChangeOrdersConsole({
  scopedProjectId: scopedProjectIdProp = null,
  initialOriginEstimateId: initialOriginEstimateIdProp = null,
}: ChangeOrdersConsoleProps) {
  const isMobile = useMediaQuery("(max-width: 700px)");
  const { token: authToken, role, capabilities } = useSharedSessionAuth();
  const scopedProjectId = scopedProjectIdProp;
  const initialOriginEstimateId = initialOriginEstimateIdProp;

  // -------------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------------

  const projectData = useChangeOrderProjectData({
    authToken,
    scopedProjectId,
    initialOriginEstimateId,
  });

  const form = useChangeOrderForm();

  const { statusLabels: changeOrderStatusLabels, allowedTransitions: changeOrderAllowedTransitions } =
    usePolicyContract<ChangeOrderPolicyContract>({
      fetchContract: fetchChangeOrderPolicyContract,
      fallbackStatuses: CHANGE_ORDER_STATUSES_FALLBACK,
      fallbackLabels: CHANGE_ORDER_STATUS_LABELS_FALLBACK,
      fallbackTransitions: CHANGE_ORDER_ALLOWED_STATUS_TRANSITIONS_FALLBACK,
      baseUrl: apiBaseUrl,
      authToken,
    });

  const viewer = useChangeOrderViewer({
    changeOrders: projectData.changeOrders,
    projectEstimates: projectData.projectEstimates,
    originEstimateOriginalTotals: projectData.originEstimateOriginalTotals,
    projectAuditEvents: projectData.projectAuditEvents,
    selectedProjectId: projectData.selectedProjectId,
    selectedViewerEstimateId: projectData.selectedViewerEstimateId,
    selectedChangeOrderId: form.selectedChangeOrderId,
    changeOrderStatusLabels,
    changeOrderAllowedTransitions,
    capabilities,
  });

  const { ref: createCreatorRef, flash: flashCreate } = useCreatorFlash();
  const { ref: editCreatorRef, flash: flashEdit } = useCreatorFlash();
  const { setPrintable } = usePrintable();

  // UI section toggles (thin — kept in console)
  const [isViewerExpanded, setIsViewerExpanded] = useState(true);
  const [isStatusSectionOpen, setIsStatusSectionOpen] = useState(true);
  const [isHistorySectionOpen, setIsHistorySectionOpen] = useState(false);
  const [isLineItemsSectionOpen, setIsLineItemsSectionOpen] = useState(true);
  const [isOriginLineItemsSectionOpen, setIsOriginLineItemsSectionOpen] = useState(false);

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

  const senderBranding = resolveOrganizationBranding(projectData.organizationDefaults);
  const senderName = senderBranding.senderDisplayName;
  const senderEmail = senderBranding.helpEmail;
  const senderAddressLines = senderBranding.senderAddressLines;
  const senderLogoUrl = senderBranding.logoUrl;
  const defaultChangeOrderTerms = (projectData.organizationDefaults?.change_order_terms_and_conditions || "").trim();

  const workspaceContext = viewer.selectedChangeOrder
    ? `${coLabel(viewer.selectedChangeOrder)} · ${viewer.selectedChangeOrder.title || "Untitled"}`
    : "New change order draft";
  const workspaceBadgeLabel = !viewer.selectedChangeOrder
    ? "CREATING"
    : viewer.isSelectedChangeOrderEditable
      ? "EDITING"
      : "READ-ONLY";
  const workspaceBadgeClass = !viewer.selectedChangeOrder
    ? styles.editStatusDraft
    : viewer.isSelectedChangeOrderEditable
      ? styles.editStatusDraft
      : editStatusBadgeClass(viewer.selectedChangeOrder.status);

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  /** Effect: Printable — sync printable state with selectedChangeOrderId. */
  useEffect(() => {
    setPrintable(!!form.selectedChangeOrderId);
    return () => setPrintable(false);
  }, [form.selectedChangeOrderId, setPrintable]);

  /** Effect: Bootstrap — fetch projects and cascade into all data loads. */
  useEffect(() => {
    if (!authToken) {
      return;
    }
    const run = window.setTimeout(() => {
      void projectData.loadProjects({
        onChangeOrdersLoaded: (changeOrderRows, initEstId) => {
          const initialCO = initEstId
            ? changeOrderRows.find((co) => co.origin_estimate === initEstId)
            : changeOrderRows[0];
          form.hydrateEditForm(initialCO ?? changeOrderRows[0]);
        },
        onChangeOrdersError: () => {
          form.hydrateEditForm(undefined);
        },
        onProjectSwitch: () => {
          form.resetNewLines();
        },
      });
    }, 0);
    return () => window.clearTimeout(run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectData.loadProjects, authToken]);

  /** Effect: Sync newTermsText when org defaults load. */
  useEffect(() => {
    if (projectData.organizationDefaults?.change_order_terms_and_conditions) {
      form.setNewTermsText((current) =>
        current || projectData.organizationDefaults!.change_order_terms_and_conditions || "",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectData.organizationDefaults]);

  /** Effect: Auto-title — sync newTitle from project name when not manually edited. */
  useEffect(() => {
    if (form.newTitleManuallyEdited) {
      return;
    }
    const run = window.setTimeout(() => {
      form.setNewTitle(defaultChangeOrderTitle(projectData.selectedProjectName));
    }, 0);
    return () => window.clearTimeout(run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.newTitleManuallyEdited, projectData.selectedProjectName]);

  /** Effect: Viewer sync — re-hydrate edit form when selected CO leaves the visible set. */
  useEffect(() => {
    // Keep "create new" mode sticky when the user intentionally clears selection.
    if (!form.selectedChangeOrderId) {
      return;
    }
    if (!viewer.viewerChangeOrders.length) {
      return;
    }
    const selectedStillVisible = viewer.viewerChangeOrders.some(
      (changeOrder) => String(changeOrder.id) === form.selectedChangeOrderId,
    );
    if (!selectedStillVisible) {
      const run = window.setTimeout(() => {
        form.hydrateEditForm(viewer.viewerChangeOrders[0]);
      }, 0);
      return () => window.clearTimeout(run);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.hydrateEditForm, form.selectedChangeOrderId, viewer.viewerChangeOrders]);

  // -------------------------------------------------------------------------
  // Display helpers (CSS-dependent — kept in component; pure helpers in change-orders-display.ts)
  // -------------------------------------------------------------------------

  function editStatusBadgeClass(status: string): string {
    const key = `editStatus${status
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("")}`;
    return styles[key] ?? styles.editStatusDraft;
  }

  // -------------------------------------------------------------------------
  // Line item handlers
  // -------------------------------------------------------------------------

  /** Append a new blank line, clearing a min-line error if present. */
  function addNewLine() {
    if (projectData.actionTone === "error" && projectData.actionMessage === CHANGE_ORDER_MIN_LINE_ITEMS_ERROR) projectData.setFeedback("");
    form.addNewLineRaw();
  }
  function addEditLine() {
    if (projectData.actionTone === "error" && projectData.actionMessage === CHANGE_ORDER_MIN_LINE_ITEMS_ERROR) projectData.setFeedback("");
    form.addEditLineRaw();
  }

  /** Remove a line item, enforcing the minimum of one line. */
  function removeNewLine(localId: number) {
    if (!form.removeNewLineRaw(localId)) projectData.setFeedback(CHANGE_ORDER_MIN_LINE_ITEMS_ERROR, "error");
  }
  function removeEditLine(localId: number) {
    if (!form.removeEditLineRaw(localId)) projectData.setFeedback(CHANGE_ORDER_MIN_LINE_ITEMS_ERROR, "error");
  }

  // -------------------------------------------------------------------------
  // Submit & mutation handlers
  // -------------------------------------------------------------------------

  /** Reset the workspace to a fresh "new change order" draft. */
  function handleStartNewChangeOrder() {
    form.hydrateEditForm(undefined);
    form.resetCreateForm(projectData.selectedProjectName, defaultChangeOrderTerms);
    projectData.setFeedback("Ready for a new change order draft.", "info");
    flashCreate();
  }

  /** Handle form submission for creating a new change order draft. */
  async function handleCreateChangeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!viewer.canMutateChangeOrders) {
      projectData.setFeedback(`Role ${role} is read-only for change order mutations.`, "error");
      return;
    }
    const projectId = Number(projectData.selectedProjectId);
    if (!projectId) {
      projectData.setFeedback("Select a project first.", "error");
      return;
    }

    const hasMissingCostCode = form.newLineItems.some((line) => !line.costCodeId.trim());
    if (hasMissingCostCode) {
      projectData.setFeedback("Every line item must have a cost code.", "error");
      return;
    }

    projectData.setFeedback("");
    try {
      const response = await fetch(
        `${apiBaseUrl}/projects/${projectId}/change-orders/`,
        {
          method: "POST",
          headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
          body: JSON.stringify({
            title: form.newTitle,
            reason: form.newReason,
            terms_text: form.newTermsText,
            amount_delta: formatDecimal(form.newLineDeltaTotal),
            days_delta: form.newLineDaysTotal,
            origin_estimate: projectData.selectedViewerEstimateId ? Number(projectData.selectedViewerEstimateId) : null,
            line_items: toLinePayload(form.newLineItems),
          }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        projectData.setFeedback(readChangeOrderApiError(payload, "Create change order failed."), "error");
        return;
      }
      const created = payload.data as ChangeOrderRecord;

      const { rows } = await projectData.fetchProjectChangeOrders(projectId);

      if (rows) {
        projectData.setChangeOrders(rows);
        const persisted = rows.find((row) => row.id === created.id);
        form.hydrateEditForm(persisted ?? created);
        await projectData.loadProjectAuditEvents(projectId);
      } else {
        projectData.setChangeOrders((current) => [created, ...current]);
        form.hydrateEditForm(created);
        await projectData.loadProjectAuditEvents(projectId);
      }
      projectData.setFeedback(`Created change order #${created.id}.`, "success");
      form.resetCreateForm(projectData.selectedProjectName, defaultChangeOrderTerms);
      flashCreate();
    } catch {
      projectData.setFeedback("Could not reach change order create endpoint.", "error");
    }
  }

  /** Clone the selected change order as a new draft revision. */
  async function handleCloneRevision() {
    if (!viewer.canMutateChangeOrders) {
      projectData.setFeedback(`Role ${role} is read-only for change order mutations.`, "error");
      return;
    }
    const changeOrderId = Number(form.selectedChangeOrderId);
    if (!changeOrderId) {
      projectData.setFeedback("Select a change order first.", "error");
      return;
    }
    const projectId = Number(projectData.selectedProjectId);
    if (!projectId) {
      projectData.setFeedback("Select a project first.", "error");
      return;
    }

    projectData.setFeedback("");
    try {
      const response = await fetch(`${apiBaseUrl}/change-orders/${changeOrderId}/clone-revision/`, {
        method: "POST",
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        projectData.setFeedback(readChangeOrderApiError(payload, "Clone revision failed."), "error");
        return;
      }
      const created = payload.data as ChangeOrderRecord;
      const { rows } = await projectData.fetchProjectChangeOrders(projectId);

      if (rows) {
        projectData.setChangeOrders(rows);
        const persisted = rows.find((row) => row.id === created.id);
        form.hydrateEditForm(persisted ?? created);
        await projectData.loadProjectAuditEvents(projectId);
      }
      projectData.setFeedback(`Duplicated as ${coLabel(created)}.`, "success");
      flashEdit();
    } catch {
      projectData.setFeedback("Could not reach clone revision endpoint.", "error");
    }
  }

  /** Handle form submission for saving edits to an existing draft change order. */
  async function handleUpdateChangeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!viewer.canMutateChangeOrders) {
      projectData.setFeedback(`Role ${role} is read-only for change order mutations.`, "error");
      return;
    }
    const changeOrderId = Number(form.selectedChangeOrderId);
    if (!changeOrderId) {
      projectData.setFeedback("Select a change order first.", "error");
      return;
    }
    if (!viewer.selectedChangeOrder) {
      projectData.setFeedback("Selected change order could not be resolved.", "error");
      return;
    }

    const hasMissingCostCode = form.editLineItems.some((line) => !line.costCodeId.trim());
    if (hasMissingCostCode) {
      projectData.setFeedback("Every line item must have a cost code.", "error");
      return;
    }

    projectData.setFeedback("");
    try {
      const response = await fetch(
        `${apiBaseUrl}/change-orders/${changeOrderId}/`,
        {
          method: "PATCH",
          headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
          body: JSON.stringify({
            title: form.editTitle,
            reason: form.editReason,
            terms_text: form.editTermsText,
            amount_delta: formatDecimal(form.editLineDeltaTotal),
            days_delta: form.editLineDaysTotal,
            status: viewer.selectedChangeOrder.status,
            line_items: toLinePayload(form.editLineItems),
          }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        projectData.setFeedback(readChangeOrderApiError(payload, "Save change order failed."), "error");
        return;
      }
      const updated = payload.data as ChangeOrderRecord;
      const projectId = Number(projectData.selectedProjectId);
      const { rows } = await projectData.fetchProjectChangeOrders(projectId);
      if (rows) {
        projectData.setChangeOrders(rows);
        const persisted = rows.find((row) => row.id === updated.id);
        form.hydrateEditForm(persisted ?? updated);
        await projectData.loadProjectAuditEvents(projectId);
        projectData.setFeedback(`Saved change order ${coLabel(updated)} (${statusLabel(updated.status, changeOrderStatusLabels)}).`, "success");
      } else {
        projectData.setChangeOrders((current) =>
          current.map((row) => (row.id === updated.id ? updated : row)),
        );
        form.hydrateEditForm(updated);
        await projectData.loadProjectAuditEvents(projectId);
        projectData.setFeedback(`Saved change order ${coLabel(updated)} (${statusLabel(updated.status, changeOrderStatusLabels)}).`, "success");
      }
    } catch {
      projectData.setFeedback("Could not reach change order detail endpoint.", "error");
    }
  }

  /** Apply a quick status transition (or resend) to the selected viewer change order. */
  async function handleQuickUpdateStatus() {
    if (!viewer.canMutateChangeOrders) {
      projectData.setFeedback(`Role ${role} is read-only for change order mutations.`, "error");
      return;
    }
    const projectId = Number(projectData.selectedProjectId);
    if (!viewer.selectedViewerChangeOrder || !form.quickStatus) {
      projectData.setFeedback("Select a change order and next status first.", "error");
      return;
    }
    if (!projectId) {
      projectData.setFeedback("Select a project first.", "error");
      return;
    }

    const isResend =
      viewer.selectedViewerChangeOrder.status === form.quickStatus && form.quickStatus === "pending_approval";

    projectData.setFeedback("");
    try {
      const response = await fetch(
        `${apiBaseUrl}/change-orders/${viewer.selectedViewerChangeOrder.id}/`,
        {
          method: "PATCH",
          headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
          body: JSON.stringify({ status: form.quickStatus, status_note: form.quickStatusNote }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        projectData.setFeedback(readChangeOrderApiError(payload, "Status update failed."), "error");
        return;
      }
      const updated = payload.data as ChangeOrderRecord;
      const { rows } = await projectData.fetchProjectChangeOrders(projectId);
      if (rows) {
        projectData.setChangeOrders(rows);
        const persisted = rows.find((row) => row.id === updated.id);
        form.hydrateEditForm(persisted ?? updated);
        await projectData.loadProjectAuditEvents(projectId);
      } else {
        projectData.setChangeOrders((current) =>
          current.map((row) => (row.id === updated.id ? updated : row)),
        );
        form.hydrateEditForm(updated);
        await projectData.loadProjectAuditEvents(projectId);
      }
      const emailNote = form.quickStatus === "pending_approval" && payload.email_sent === false ? " No email sent — customer has no email on file." : "";
      if (isResend) {
        projectData.setFeedback(`Re-sent ${coLabel(updated)} for approval. History updated.${emailNote}`, "success");
      } else {
        projectData.setFeedback(`Updated ${coLabel(updated)} to ${statusLabel(updated.status, changeOrderStatusLabels)}. History updated.${emailNote}`, "success");
      }
      form.setQuickStatus("");
      form.setQuickStatusNote("");
    } catch {
      projectData.setFeedback("Could not reach change order detail endpoint.", "error");
    }
  }

  /** Append a status note without changing the change order's current status. */
  async function handleAddChangeOrderStatusNote() {
    if (!viewer.canMutateChangeOrders) {
      projectData.setFeedback(`Role ${role} is read-only for change order mutations.`, "error");
      return;
    }
    const projectId = Number(projectData.selectedProjectId);
    if (!viewer.selectedViewerChangeOrder) {
      projectData.setFeedback("Select a change order first.", "error");
      return;
    }
    if (!projectId) {
      projectData.setFeedback("Select a project first.", "error");
      return;
    }
    if (!form.quickStatusNote.trim()) {
      projectData.setFeedback("Enter a status note first.", "error");
      return;
    }

    projectData.setFeedback("");
    try {
      const response = await fetch(
        `${apiBaseUrl}/change-orders/${viewer.selectedViewerChangeOrder.id}/`,
        {
          method: "PATCH",
          headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
          body: JSON.stringify({ status_note: form.quickStatusNote }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        projectData.setFeedback(readChangeOrderApiError(payload, "Status note update failed."), "error");
        return;
      }
      const updated = payload.data as ChangeOrderRecord;
      const { rows } = await projectData.fetchProjectChangeOrders(projectId);
      if (rows) {
        projectData.setChangeOrders(rows);
        const persisted = rows.find((row) => row.id === updated.id);
        form.hydrateEditForm(persisted ?? updated);
        await projectData.loadProjectAuditEvents(projectId);
      } else {
        projectData.setChangeOrders((current) =>
          current.map((row) => (row.id === updated.id ? updated : row)),
        );
        form.hydrateEditForm(updated);
        await projectData.loadProjectAuditEvents(projectId);
      }
      form.setQuickStatusNote("");
      projectData.setFeedback(`Added status note on ${coLabel(updated)}. History updated.`, "success");
    } catch {
      projectData.setFeedback("Could not reach change order detail endpoint.", "error");
    }
  }

  // -------------------------------------------------------------------------
  // Viewer callbacks
  // -------------------------------------------------------------------------

  /** Handle CO selection from the viewer list: hydrate edit form and clear feedback. */
  const handleSelectChangeOrder = useCallback((changeOrder: ChangeOrderRecord | undefined) => {
    if (changeOrder) {
      projectData.setFeedback("");
      if (changeOrder.origin_estimate) {
        projectData.setSelectedViewerEstimateId(String(changeOrder.origin_estimate));
      }
    }
    form.hydrateEditForm(changeOrder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.hydrateEditForm, projectData.setFeedback, projectData.setSelectedViewerEstimateId]);

  /** Handle estimate rail selection: update viewer estimate and sync the edit form. */
  const handleSelectViewerEstimate = useCallback((nextEstimateId: string) => {
    projectData.setSelectedViewerEstimateId(nextEstimateId);
    const related = viewer.sortCOs(
      projectData.changeOrders.filter(
        (changeOrder) => String(changeOrder.origin_estimate) === nextEstimateId,
      ),
    );
    if (!related.length) {
      form.hydrateEditForm(undefined);
      return;
    }
    const selectedStillValid = related.some(
      (changeOrder) => String(changeOrder.id) === form.selectedChangeOrderId,
    );
    if (!selectedStillValid) {
      form.hydrateEditForm(related[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectData.changeOrders, form.hydrateEditForm, form.selectedChangeOrderId, viewer.sortCOs]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <section>
      {projectData.actionMessage && projectData.actionTone !== "success" ? (
        <p
          className={
            projectData.actionTone === "error"
              ? creatorStyles.actionError
              : creatorStyles.inlineHint
          }
        >
          {projectData.actionMessage}
        </p>
      ) : null}
      {!viewer.canMutateChangeOrders ? (
        <p className={styles.roleReadOnlyNote}>
          Role `{role}` can view change orders but cannot create or update.
        </p>
      ) : null}

      <ChangeOrdersViewerPanel
        isMobile={isMobile}
        isViewerExpanded={isViewerExpanded}
        setIsViewerExpanded={setIsViewerExpanded}
        selectedProjectId={projectData.selectedProjectId}
        selectedProjectName={projectData.selectedProjectName}
        selectedProjectCustomerEmail={projectData.selectedProjectCustomerEmail}
        projectEstimates={projectData.projectEstimates}
        selectedViewerEstimateId={projectData.selectedViewerEstimateId}
        changeOrders={projectData.changeOrders}
        originEstimateOriginalTotals={projectData.originEstimateOriginalTotals}
        onSelectEstimate={handleSelectViewerEstimate}
        selectedViewerEstimate={viewer.selectedViewerEstimate}
        viewerChangeOrders={viewer.viewerChangeOrders}
        paginatedChangeOrders={viewer.paginatedChangeOrders}
        selectedChangeOrderId={form.selectedChangeOrderId}
        coPage={viewer.coPage}
        coTotalPages={viewer.coTotalPages}
        coTotalCount={viewer.coTotalCount}
        setCoPage={viewer.setCoPage}
        onSelectChangeOrder={handleSelectChangeOrder}
        projectAuditEvents={projectData.projectAuditEvents}
        changeOrderStatusLabels={changeOrderStatusLabels}
        selectedViewerChangeOrder={viewer.selectedViewerChangeOrder}
        selectedViewerWorkingTotals={viewer.selectedViewerWorkingTotals}
        approvedCOsForSelectedEstimate={viewer.approvedCOsForSelectedEstimate}
        canMutateChangeOrders={viewer.canMutateChangeOrders}
        quickStatusOptions={viewer.quickStatusOptions}
        quickStatus={form.quickStatus}
        setQuickStatus={form.setQuickStatus}
        quickStatusNote={form.quickStatusNote}
        setQuickStatusNote={form.setQuickStatusNote}
        onQuickUpdateStatus={handleQuickUpdateStatus}
        onAddChangeOrderStatusNote={handleAddChangeOrderStatusNote}
        actionMessage={projectData.actionMessage}
        actionTone={projectData.actionTone}
        isStatusSectionOpen={isStatusSectionOpen}
        setIsStatusSectionOpen={setIsStatusSectionOpen}
        isHistorySectionOpen={isHistorySectionOpen}
        setIsHistorySectionOpen={setIsHistorySectionOpen}
        isLineItemsSectionOpen={isLineItemsSectionOpen}
        setIsLineItemsSectionOpen={setIsLineItemsSectionOpen}
        isOriginLineItemsSectionOpen={isOriginLineItemsSectionOpen}
        setIsOriginLineItemsSectionOpen={setIsOriginLineItemsSectionOpen}
        selectedChangeOrderStatusEvents={viewer.selectedChangeOrderStatusEvents}
        showAllEvents={form.showAllEvents}
        setShowAllEvents={form.setShowAllEvents}
      />


      {projectData.projectEstimates.length === 0 && !viewer.selectedChangeOrder ? (
        <p className={styles.viewerHint}>
          Approve an estimate on this project first to start creating change orders.
        </p>
      ) : (
      <>
      <ChangeOrdersWorkspacePanel
        isMobile={isMobile}
        selectedProjectId={projectData.selectedProjectId}
        selectedViewerEstimateId={projectData.selectedViewerEstimateId}
        selectedViewerEstimate={viewer.selectedViewerEstimate}
        projectEstimates={projectData.projectEstimates}
        selectedChangeOrder={viewer.selectedChangeOrder}
        selectedViewerChangeOrder={viewer.selectedViewerChangeOrder}
        isSelectedChangeOrderEditable={viewer.isSelectedChangeOrderEditable}
        workspaceContext={workspaceContext}
        workspaceBadgeLabel={workspaceBadgeLabel}
        workspaceBadgeClass={workspaceBadgeClass}
        onStartNew={handleStartNewChangeOrder}
        onCloneRevision={handleCloneRevision}
        canMutateChangeOrders={viewer.canMutateChangeOrders}
        role={role}
        actionMessage={projectData.actionMessage}
        actionTone={projectData.actionTone}
        senderName={senderName}
        senderEmail={senderEmail}
        senderAddressLines={senderAddressLines}
        senderLogoUrl={senderLogoUrl}
        createCreatorRef={createCreatorRef}
        changeOrderCreatorAdapter={viewer.changeOrderCreatorAdapter}
        createChangeOrderCreatorFormState={form.createChangeOrderCreatorFormState}
        newTitle={form.newTitle}
        onNewTitleChange={(value) => { form.setNewTitle(value); form.setNewTitleManuallyEdited(true); }}
        newReason={form.newReason}
        onNewReasonChange={form.setNewReason}
        newTermsText={form.newTermsText}
        defaultChangeOrderTerms={defaultChangeOrderTerms}
        newLineItems={form.newLineItems}
        newLineValidation={form.newLineValidation}
        newLineDeltaTotal={form.newLineDeltaTotal}
        newLineDaysTotal={form.newLineDaysTotal}
        costCodes={projectData.costCodes}
        isCreateSubmitDisabled={viewer.isCreateSubmitDisabled}
        onCreateSubmit={handleCreateChangeOrder}
        onAddNewLine={addNewLine}
        onRemoveNewLine={removeNewLine}
        onUpdateNewLine={form.updateNewLine}
        onMoveNewLine={form.moveNewLine}
        editCreatorRef={editCreatorRef}
        editChangeOrderCreatorFormState={form.editChangeOrderCreatorFormState}
        editTitle={form.editTitle}
        onEditTitleChange={form.setEditTitle}
        editReason={form.editReason}
        onEditReasonChange={form.setEditReason}
        editTermsText={form.editTermsText}
        editLineItems={form.editLineItems}
        editLineValidation={form.editLineValidation}
        editLineDeltaTotal={form.editLineDeltaTotal}
        editLineDaysTotal={form.editLineDaysTotal}
        isEditSubmitDisabled={viewer.isEditSubmitDisabled}
        onEditSubmit={handleUpdateChangeOrder}
        onAddEditLine={addEditLine}
        onRemoveEditLine={removeEditLine}
        onUpdateEditLine={form.updateEditLine}
        onMoveEditLine={form.moveEditLine}
        approvedCOsForSelectedEstimate={viewer.approvedCOsForSelectedEstimate}
        isOriginLineItemsSectionOpen={isOriginLineItemsSectionOpen}
        setIsOriginLineItemsSectionOpen={setIsOriginLineItemsSectionOpen}
        currentAcceptedTotal={viewer.currentAcceptedTotal}
        originalEstimateTotal={viewer.originalEstimateTotal}
      />
      </>
      )}
    </section>
  );
}
