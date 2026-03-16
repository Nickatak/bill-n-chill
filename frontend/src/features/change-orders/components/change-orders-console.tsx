"use client";

/**
 * Change orders console -- the primary internal workspace for managing change
 * orders within a project. Provides estimate-linked revision browsing,
 * draft creation/editing, status transitions with quick-status pills, audit
 * event history, and cost-code-based line-item creators.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useCreatorFlash } from "@/shared/hooks/use-creator-flash";
import { parseAmount, formatDecimal } from "@/shared/money-format";
import {
  coLabel,
  defaultChangeOrderTitle,
  emptyLine,
  readChangeOrderApiError,
  validateLineItems,
} from "../helpers";
import {
  defaultApiBaseUrl,
  fetchChangeOrderPolicyContract,
  normalizeApiBaseUrl,
} from "../api";
import { usePolicyContract } from "@/shared/hooks/use-policy-contract";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { canDo } from "@/shared/session/rbac";
import {
  ApiResponse,
  AuditEventRecord,
  ChangeOrderLineInput,
  ChangeOrderPolicyContract,
  ChangeOrderRecord,
  CostCodeOption,
  OrganizationDocumentDefaults,
  OriginEstimateLineItem,
  OriginEstimateRecord,
} from "../types";
import {
  CHANGE_ORDER_STATUS_LABELS_FALLBACK,
  CHANGE_ORDER_STATUSES_FALLBACK,
  CHANGE_ORDER_ALLOWED_STATUS_TRANSITIONS_FALLBACK,
  CHANGE_ORDER_MIN_LINE_ITEMS_ERROR,
  statusLabel,
  currentApprovedBudgetTotalForEstimate,
  originalBudgetTotalForEstimate,
  toLinePayload,
} from "./change-orders-display";
import { usePrintable } from "@/shared/shell/printable-context";
import styles from "./change-orders-console.module.css";
import creatorStyles from "@/shared/document-creator/creator-foundation.module.css";
import {
  resolveOrganizationBranding,
} from "@/shared/document-creator";
import {
  createChangeOrderDocumentAdapter,
  ChangeOrderFormState,
  toChangeOrderStatusPolicy,
} from "../document-adapter";
import { useMediaQuery } from "@/shared/hooks/use-media-query";
import { useLineItems } from "@/shared/hooks/use-line-items";
import { useClientPagination } from "@/shared/hooks/use-client-pagination";
import { ChangeOrdersViewerPanel } from "./change-orders-viewer-panel";
import { ChangeOrdersWorkspacePanel } from "./change-orders-workspace-panel";

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
  const { token, role, capabilities } = useSharedSessionAuth();
  const [actionMessage, setActionMessage] = useState("");
  const [actionTone, setActionTone] = useState<"error" | "success" | "info">("info");

  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [changeOrders, setChangeOrders] = useState<ChangeOrderRecord[]>([]);
  const [selectedChangeOrderId, setSelectedChangeOrderId] = useState("");
  const [selectedViewerEstimateId, setSelectedViewerEstimateId] = useState("");
  const [isViewerExpanded, setIsViewerExpanded] = useState(true);
  const [costCodes, setCostCodes] = useState<CostCodeOption[]>([]);
  const [originEstimateOriginalTotals, setOriginEstimateOriginalTotals] = useState<
    Record<number, number>
  >({});
  const [projectEstimates, setProjectEstimates] = useState<OriginEstimateRecord[]>([]);
  const [projectAuditEvents, setProjectAuditEvents] = useState<AuditEventRecord[]>([]);
  const {
    items: newLineItems,
    add: addNewLineRaw, remove: removeNewLineRaw,
    update: updateNewLine, move: moveNewLine, reset: resetNewLines,
  } = useLineItems<ChangeOrderLineInput>({ createEmpty: emptyLine });
  const {
    items: editLineItems, setItems: setEditLineItems,
    setNextId: setEditLineNextLocalId,
    add: addEditLineRaw, remove: removeEditLineRaw,
    update: updateEditLine, move: moveEditLine, reset: resetEditLines,
  } = useLineItems<ChangeOrderLineInput>({ createEmpty: emptyLine });
  const [selectedProjectName, setSelectedProjectName] = useState("");
  const [selectedProjectCustomerEmail, setSelectedProjectCustomerEmail] = useState("");
  const [organizationDefaults, setOrganizationDefaults] =
    useState<OrganizationDocumentDefaults | null>(null);

  const [newTitle, setNewTitle] = useState("Change Order");
  const [newTitleManuallyEdited, setNewTitleManuallyEdited] = useState(false);
  const [newReason, setNewReason] = useState("");
  const [newTermsText, setNewTermsText] = useState("");

  const [editTitle, setEditTitle] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editTermsText, setEditTermsText] = useState("");
  const [quickStatus, setQuickStatus] = useState("");
  const [quickStatusNote, setQuickStatusNote] = useState("");
  const [isStatusSectionOpen, setIsStatusSectionOpen] = useState(true);
  const [isHistorySectionOpen, setIsHistorySectionOpen] = useState(false);
  const [isLineItemsSectionOpen, setIsLineItemsSectionOpen] = useState(true);
  const [isOriginLineItemsSectionOpen, setIsOriginLineItemsSectionOpen] = useState(false);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const { statusLabels: changeOrderStatusLabels, allowedTransitions: changeOrderAllowedTransitions } =
    usePolicyContract<ChangeOrderPolicyContract>({
      fetchContract: fetchChangeOrderPolicyContract,
      fallbackStatuses: CHANGE_ORDER_STATUSES_FALLBACK,
      fallbackLabels: CHANGE_ORDER_STATUS_LABELS_FALLBACK,
      fallbackTransitions: CHANGE_ORDER_ALLOWED_STATUS_TRANSITIONS_FALLBACK,
      baseUrl: normalizedBaseUrl,
      token,
    });
  const { ref: createCreatorRef, flash: flashCreate } = useCreatorFlash();
  const { ref: editCreatorRef, flash: flashEdit } = useCreatorFlash();
  const { setPrintable } = usePrintable();

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  useEffect(() => {
    setPrintable(!!selectedChangeOrderId);
    return () => setPrintable(false);
  }, [selectedChangeOrderId, setPrintable]);

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

  const canMutateChangeOrders = canDo(capabilities, "change_orders", "create");
  const canSendChangeOrders = canDo(capabilities, "change_orders", "send");
  const canApproveChangeOrders = canDo(capabilities, "change_orders", "approve");
  const scopedProjectId = scopedProjectIdProp;
  const initialOriginEstimateId = initialOriginEstimateIdProp;
  const selectedChangeOrder =
    changeOrders.find((row) => String(row.id) === selectedChangeOrderId) ?? null;
  const selectedViewerEstimate =
    projectEstimates.find((estimate) => String(estimate.id) === selectedViewerEstimateId) ?? null;
  const sortChangeOrdersForViewer = useCallback((rows: ChangeOrderRecord[]) => {
    return [...rows].sort((left, right) => {
      const leftCreatedAt = Date.parse(left.created_at);
      const rightCreatedAt = Date.parse(right.created_at);
      if (Number.isFinite(leftCreatedAt) && Number.isFinite(rightCreatedAt)) {
        const createdAtDelta = leftCreatedAt - rightCreatedAt;
        if (createdAtDelta !== 0) {
          return createdAtDelta;
        }
      }
      const familyDelta = Number(left.family_key) - Number(right.family_key);
      if (familyDelta !== 0) {
        return familyDelta;
      }
      const revisionDelta = Number(left.revision_number) - Number(right.revision_number);
      if (revisionDelta !== 0) {
        return revisionDelta;
      }
      return left.id - right.id;
    });
  }, []);
  const viewerChangeOrders = useMemo(() => {
    if (!selectedViewerEstimateId) {
      return [] as ChangeOrderRecord[];
    }
    const originEstimateId = Number(selectedViewerEstimateId);
    return sortChangeOrdersForViewer(
      changeOrders.filter((changeOrder) => changeOrder.origin_estimate === originEstimateId),
    );
  }, [changeOrders, selectedViewerEstimateId, sortChangeOrdersForViewer]);
  const { page: coPage, totalPages: coTotalPages, totalCount: coTotalCount, paginatedItems: paginatedChangeOrders, setPage: setCoPage } = useClientPagination(viewerChangeOrders);
  const selectedViewerChangeOrder =
    viewerChangeOrders.find((changeOrder) => String(changeOrder.id) === selectedChangeOrderId) ??
    viewerChangeOrders[0] ??
    null;
  const selectedViewerEstimateRecordId = selectedViewerEstimate?.id ?? null;
  const approvedCOsForSelectedEstimate = useMemo(() => {
    return viewerChangeOrders.filter((co) =>
      co.status === "approved",
    );
  }, [viewerChangeOrders]);
  const selectedViewerChangeOrderIdValue = selectedViewerChangeOrder?.id ?? null;
  const selectedViewerChangeOrderLineDelta = selectedViewerChangeOrder
    ? parseAmount(selectedViewerChangeOrder.line_total_delta || selectedViewerChangeOrder.amount_delta)
    : 0;
  const selectedViewerChangeOrderIsApproved = Boolean(
    selectedViewerChangeOrder && selectedViewerChangeOrder.status === "approved",
  );
  const senderBranding = resolveOrganizationBranding(organizationDefaults);
  const senderName = senderBranding.senderDisplayName;
  const senderEmail = senderBranding.helpEmail;
  const senderAddressLines = senderBranding.senderAddressLines;
  const senderLogoUrl = senderBranding.logoUrl;
  const defaultChangeOrderTerms = (organizationDefaults?.change_order_terms_and_conditions || "").trim();
  const newLineDeltaTotal = useMemo(
    () =>
      newLineItems.reduce((sum, line) => sum + parseAmount(line.amountDelta), 0),
    [newLineItems],
  );
  const newLineValidation = useMemo(() => validateLineItems(newLineItems), [newLineItems]);
  const editLineDeltaTotal = useMemo(
    () =>
      editLineItems.reduce((sum, line) => sum + parseAmount(line.amountDelta), 0),
    [editLineItems],
  );
  const editLineValidation = useMemo(() => validateLineItems(editLineItems), [editLineItems]);
  const newLineDaysTotal = useMemo(
    () => newLineItems.reduce((sum, line) => sum + Math.trunc(parseAmount(line.daysDelta)), 0),
    [newLineItems],
  );
  const editLineDaysTotal = useMemo(
    () => editLineItems.reduce((sum, line) => sum + Math.trunc(parseAmount(line.daysDelta)), 0),
    [editLineItems],
  );
  const quickStatusOptions = useMemo(() => {
    if (!selectedViewerChangeOrder) {
      return [] as string[];
    }
    const base = [...(changeOrderAllowedTransitions[selectedViewerChangeOrder.status] ?? [])];
    const allowResend = selectedViewerChangeOrder.status === "pending_approval";
    if (allowResend && !base.includes(selectedViewerChangeOrder.status)) {
      base.unshift(selectedViewerChangeOrder.status);
    }
    return base.filter((status) => {
      if (status === "pending_approval") return canSendChangeOrders;
      if (status === "approved") return canApproveChangeOrders;
      return true;
    });
  }, [changeOrderAllowedTransitions, selectedViewerChangeOrder, canSendChangeOrders, canApproveChangeOrders]);
  const isCreateSubmitDisabled =
    !canMutateChangeOrders ||
    !selectedProjectId ||
    !selectedViewerEstimateId;
  const isSelectedChangeOrderDraft = selectedChangeOrder?.status === "draft";
  const isSelectedChangeOrderEditable =
    canMutateChangeOrders &&
    Boolean(selectedChangeOrderId) &&
    Boolean(selectedChangeOrder?.is_latest_revision) &&
    isSelectedChangeOrderDraft;
  const workspaceContext = selectedChangeOrder
    ? `${coLabel(selectedChangeOrder)} · ${selectedChangeOrder.title || "Untitled"}`
    : "New change order draft";
  const workspaceBadgeLabel = !selectedChangeOrder
    ? "CREATING"
    : isSelectedChangeOrderEditable
      ? "EDITING"
      : "READ-ONLY";
  const workspaceBadgeClass = !selectedChangeOrder
    ? styles.editStatusDraft
    : isSelectedChangeOrderEditable
      ? styles.editStatusDraft
      : editStatusBadgeClass(selectedChangeOrder.status);
  const isEditSubmitDisabled = !isSelectedChangeOrderEditable;
  const currentAcceptedTotal = selectedViewerEstimate
    ? currentApprovedBudgetTotalForEstimate(selectedViewerEstimate.id, changeOrders, originEstimateOriginalTotals)
    : null;
  const originalEstimateTotal = selectedViewerEstimate
    ? originalBudgetTotalForEstimate(selectedViewerEstimate.id, originEstimateOriginalTotals)
    : null;
  const changeOrderCreatorStatusPolicy = useMemo(
    () =>
      toChangeOrderStatusPolicy({
        policy_version: "ui-fallback",
        status_labels: changeOrderStatusLabels,
        statuses: CHANGE_ORDER_STATUSES_FALLBACK,
        default_create_status: "draft",
        allowed_status_transitions: changeOrderAllowedTransitions,
        terminal_statuses: ["approved", "void"],
      }),
    [changeOrderAllowedTransitions, changeOrderStatusLabels],
  );
  const createChangeOrderCreatorFormState: ChangeOrderFormState = useMemo(
    () => ({
      title: newTitle,
      reason: newReason,
      amountDelta: formatDecimal(newLineDeltaTotal),
      daysDelta: String(newLineDaysTotal),
      lineItems: newLineItems,
    }),
    [newLineDaysTotal, newLineDeltaTotal, newLineItems, newReason, newTitle],
  );
  const editChangeOrderCreatorFormState: ChangeOrderFormState = useMemo(
    () => ({
      title: editTitle,
      reason: editReason,
      amountDelta: formatDecimal(editLineDeltaTotal),
      daysDelta: String(editLineDaysTotal),
      lineItems: editLineItems,
    }),
    [editLineDaysTotal, editLineDeltaTotal, editLineItems, editReason, editTitle],
  );
  const changeOrderCreatorAdapter = useMemo(
    () => createChangeOrderDocumentAdapter(changeOrderCreatorStatusPolicy, []),
    [changeOrderCreatorStatusPolicy],
  );
  const selectedChangeOrderStatusEvents = useMemo(() => {
    if (!selectedViewerChangeOrder) {
      return [] as AuditEventRecord[];
    }
    return projectAuditEvents
      .filter((event) =>
        event.event_type === "change_order_updated" &&
        event.object_type === "change_order" &&
        event.object_id === selectedViewerChangeOrder.id &&
        (Boolean(event.from_status) || Boolean(event.to_status)))
      .sort((left, right) => {
        const leftTime = Date.parse(left.created_at);
        const rightTime = Date.parse(right.created_at);
        if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
          return rightTime - leftTime;
        }
        return right.id - left.id;
      });
  }, [projectAuditEvents, selectedViewerChangeOrder]);
  const selectedViewerWorkingTotals = (() => {
    if (!selectedViewerEstimateRecordId || !selectedViewerChangeOrderIdValue) {
      return { preApproval: "0.00", postApproval: "0.00" };
    }
    const approvedRollingDelta = changeOrders.reduce((sum, changeOrder) => {
      if (
        changeOrder.origin_estimate !== selectedViewerEstimateRecordId ||
        changeOrder.status !== "approved"
      ) {
        return sum;
      }
      return sum + parseAmount(changeOrder.amount_delta);
    }, 0);
    const originalBudgetTotal = originEstimateOriginalTotals[selectedViewerEstimateRecordId] ?? 0;
    const currentApprovedWorkingTotal = originalBudgetTotal + approvedRollingDelta;
    const preApprovalTotal = selectedViewerChangeOrderIsApproved
      ? currentApprovedWorkingTotal - selectedViewerChangeOrderLineDelta
      : currentApprovedWorkingTotal;
    const postApprovalTotal = preApprovalTotal + selectedViewerChangeOrderLineDelta;
    return {
      preApproval: formatDecimal(preApprovalTotal),
      postApproval: formatDecimal(postApprovalTotal),
    };
  })();

  // -------------------------------------------------------------------------
  // Display helpers (CSS-dependent — kept in component; pure helpers in change-orders-display.ts)
  // -------------------------------------------------------------------------

  const setFeedback = useCallback((message: string, tone: "error" | "success" | "info" = "info") => {
    setActionMessage(message);
    setActionTone(tone);
  }, []);

  function editStatusBadgeClass(status: string): string {
    const key = `editStatus${status
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("")}`;
    return styles[key] ?? styles.editStatusDraft;
  }

  // -------------------------------------------------------------------------
  // Data loading & form hydration
  // -------------------------------------------------------------------------

  const hydrateEditForm = useCallback((changeOrder: ChangeOrderRecord | undefined) => {
    if (!changeOrder) {
      setSelectedChangeOrderId("");
      setEditTitle("");
      setEditReason("");
      setEditTermsText("");
      resetEditLines();
      setQuickStatus("");
      setQuickStatusNote("");
      return;
    }

    setSelectedChangeOrderId(String(changeOrder.id));
    setFeedback("");
    setEditTitle(changeOrder.title);
    setEditReason(changeOrder.reason);
    setEditTermsText(changeOrder.terms_text || "");
    const hydratedLines: ChangeOrderLineInput[] =
      changeOrder.line_items.length > 0
        ? changeOrder.line_items.map((line, index) => ({
            localId: index + 1,
            costCodeId: line.cost_code_id ? String(line.cost_code_id) : String(line.cost_code),
            description: line.description ?? "",
            adjustmentReason: line.adjustment_reason ?? "",
            amountDelta: line.amount_delta,
            daysDelta: String(line.days_delta),
          }))
        : [emptyLine(1)];
    setEditLineItems(hydratedLines);
    const maxLocalId = hydratedLines.reduce((maxId, line) => Math.max(maxId, line.localId), 1);
    setEditLineNextLocalId(maxLocalId + 1);
    if (changeOrder.origin_estimate) {
      setSelectedViewerEstimateId(String(changeOrder.origin_estimate));
    }
    setQuickStatus("");
    setQuickStatusNote("");
    setShowAllEvents(false);
  }, [setFeedback, resetEditLines, setEditLineItems, setEditLineNextLocalId]);

  const loadProjectEstimates = useCallback(async (projectId: number) => {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/estimates/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setProjectEstimates([]);
        return;
      }
      const rows =
        (payload.data as Array<{
          id: number;
          title: string;
          version: number;
          status?: string;
          grand_total?: string;
          line_items?: OriginEstimateLineItem[];
        }>) ?? [];
      const approvedRows = rows.filter((estimate) => estimate.status === "approved");
      const approvedRowsWithMeta: OriginEstimateRecord[] = await Promise.all(
        approvedRows.map(async (estimate) => {
          const base = {
            id: estimate.id,
            title: estimate.title,
            version: estimate.version,
            grand_total: estimate.grand_total ?? "0.00",
            line_items: estimate.line_items ?? [],
          };
          try {
            const response = await fetch(
              `${normalizedBaseUrl}/estimates/${estimate.id}/status-events/`,
              {
                headers: buildAuthHeaders(token),
              },
            );
            const payload: ApiResponse = await response.json();
            if (!response.ok) {
              return {
                ...base,
                approved_at: null,
                approved_by_email: null,
              };
            }
            const events =
              (payload.data as Array<{
                to_status?: string;
                changed_at?: string;
                changed_by_email?: string;
              }>) ?? [];
            const approvedEvent = [...events]
              .reverse()
              .find((event) => event.to_status === "approved");
            return {
              ...base,
              approved_at: approvedEvent?.changed_at ?? null,
              approved_by_email: approvedEvent?.changed_by_email ?? null,
            };
          } catch {
            return {
              ...base,
              approved_at: null,
              approved_by_email: null,
            };
          }
        }),
      );
      const preferredEstimateId =
        initialOriginEstimateId &&
        approvedRowsWithMeta.some((estimate) => estimate.id === initialOriginEstimateId)
          ? String(initialOriginEstimateId)
          : "";
      setProjectEstimates(approvedRowsWithMeta);
      const totalsMap: Record<number, number> = {};
      for (const est of approvedRowsWithMeta) {
        totalsMap[est.id] = parseFloat(est.grand_total) || 0;
      }
      setOriginEstimateOriginalTotals(totalsMap);
      setSelectedViewerEstimateId((current) => {
        if (preferredEstimateId) {
          return preferredEstimateId;
        }
        if (current && approvedRowsWithMeta.some((estimate) => String(estimate.id) === current)) {
          return current;
        }
        return approvedRowsWithMeta[0] ? String(approvedRowsWithMeta[0].id) : "";
      });
    } catch {
      setProjectEstimates([]);
      setSelectedViewerEstimateId("");
    }
  }, [initialOriginEstimateId, normalizedBaseUrl, token]);

  const loadProjectAuditEvents = useCallback(async (projectId: number) => {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/audit-events/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setProjectAuditEvents([]);
        return;
      }
      const rows =
        (payload.data as Array<{
          id: number;
          event_type: string;
          object_type: string;
          object_id: number;
          from_status: string;
          to_status: string;
          note: string;
          metadata_json?: Record<string, unknown> | null;
          created_by: number;
          created_by_email: string | null;
          created_by_display?: string | null;
          created_by_customer_id?: number | null;
          created_at: string;
        }>) ?? [];
      setProjectAuditEvents(rows);
    } catch {
      setProjectAuditEvents([]);
    }
  }, [normalizedBaseUrl, token]);

  const loadCostCodes = useCallback(async () => {
    try {
      const response = await fetch(`${normalizedBaseUrl}/cost-codes/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setCostCodes([]);
        return;
      }
      const rows = ((payload.data as CostCodeOption[]) ?? []).filter((c) => c.is_active);
      setCostCodes(rows);
    } catch {
      setCostCodes([]);
    }
  }, [normalizedBaseUrl, token]);

  const fetchProjectChangeOrders = useCallback(async (projectId: number) => {
    const response = await fetch(
      `${normalizedBaseUrl}/projects/${projectId}/change-orders/`,
      {
        headers: buildAuthHeaders(token),
      },
    );
    const payload: ApiResponse = await response.json();
    if (!response.ok) {
      return {
        rows: null as ChangeOrderRecord[] | null,
        error: readChangeOrderApiError(payload, "Could not load change orders."),
      };
    }
    return { rows: (payload.data as ChangeOrderRecord[]) ?? [], error: "" };
  }, [normalizedBaseUrl, token]);

  const loadOrganizationDefaults = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const response = await fetch(`${normalizedBaseUrl}/organization/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok || !payload.data || Array.isArray(payload.data)) {
        return;
      }
      const organizationData = (
        payload.data as { organization?: OrganizationDocumentDefaults } | undefined
      )?.organization;
      if (organizationData) {
        setOrganizationDefaults(organizationData);
        setNewTermsText((current) => current || organizationData.change_order_terms_and_conditions || "");
      }
    } catch {
      // Branding defaults are best-effort; change order workflows can continue.
    }
  }, [normalizedBaseUrl, token]);

  const loadProjects = useCallback(async () => {
    if (!token) {
      return;
    }
    setFeedback("");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setFeedback(readChangeOrderApiError(payload, "Could not load projects."), "error");
        return;
      }
      const rows = (payload.data as Array<{ id: number; name: string; customer_email?: string }>) ?? [];
      resetNewLines();
      if (rows[0]) {
        const scopedMatch = scopedProjectId
          ? rows.find((project) => project.id === scopedProjectId)
          : null;
        const nextProject = scopedMatch ?? rows[0];
        const scopeFallbackNote =
          scopedProjectId && !scopedMatch
            ? ` Project #${scopedProjectId} was not found in scope; defaulted to #${nextProject.id}.`
            : "";
        setSelectedProjectId(String(nextProject.id));
        setSelectedProjectName(nextProject.name || "");
        setSelectedProjectCustomerEmail(nextProject.customer_email || "");
        await Promise.all([
          loadProjectEstimates(nextProject.id),
          loadProjectAuditEvents(nextProject.id),
          loadCostCodes(),
        ]);
        const { rows: changeOrderRows, error } = await fetchProjectChangeOrders(nextProject.id);
        if (!changeOrderRows) {
          setChangeOrders([]);
          hydrateEditForm(undefined);
          setFeedback(`${error}${scopeFallbackNote}`, "error");
          return;
        }
        setChangeOrders(changeOrderRows);
        const initialCO = initialOriginEstimateId
          ? changeOrderRows.find((co) => co.origin_estimate === initialOriginEstimateId)
          : changeOrderRows[0];
        hydrateEditForm(initialCO ?? changeOrderRows[0]);
        setFeedback("");
      } else {
        setSelectedProjectId("");
        setSelectedProjectName("");
        setSelectedProjectCustomerEmail("");
        setOriginEstimateOriginalTotals({});
        setProjectEstimates([]);
        setProjectAuditEvents([]);
        setChangeOrders([]);
        hydrateEditForm(undefined);
        setFeedback("No projects found.", "info");
      }
    } catch {
      setFeedback("Could not reach projects endpoint.", "error");
    }
  }, [
    fetchProjectChangeOrders,
    hydrateEditForm,
    initialOriginEstimateId,
    loadCostCodes,
    loadProjectAuditEvents,
    loadProjectEstimates,
    normalizedBaseUrl,
    resetNewLines,
    scopedProjectId,
    setFeedback,
    token,
  ]);

  // -------------------------------------------------------------------------
  // Effects (data loading)
  // -------------------------------------------------------------------------

  // Fetch projects and related data on auth.
  useEffect(() => {
    if (!token) {
      return;
    }
    const run = window.setTimeout(() => {
      void loadProjects();
    }, 0);
    return () => window.clearTimeout(run);
  }, [loadProjects, token]);

  // Load organization branding defaults for the creator header.
  useEffect(() => {
    if (!token) {
      return;
    }
    const run = window.setTimeout(() => {
      void loadOrganizationDefaults();
    }, 0);
    return () => window.clearTimeout(run);
  }, [loadOrganizationDefaults, token]);

  // Auto-generate the draft title from the project name until the user edits it.
  useEffect(() => {
    if (newTitleManuallyEdited) {
      return;
    }
    const run = window.setTimeout(() => {
      setNewTitle(defaultChangeOrderTitle(selectedProjectName));
    }, 0);
    return () => window.clearTimeout(run);
  }, [newTitleManuallyEdited, selectedProjectName]);

  // Sync the edit form when the selected CO is no longer in the visible set.
  useEffect(() => {
    // Keep "create new" mode sticky when the user intentionally clears selection.
    if (!selectedChangeOrderId) {
      return;
    }
    if (!viewerChangeOrders.length) {
      return;
    }
    const selectedStillVisible = viewerChangeOrders.some(
      (changeOrder) => String(changeOrder.id) === selectedChangeOrderId,
    );
    if (!selectedStillVisible) {
      const run = window.setTimeout(() => {
        hydrateEditForm(viewerChangeOrders[0]);
      }, 0);
      return () => window.clearTimeout(run);
    }
  }, [hydrateEditForm, selectedChangeOrderId, viewerChangeOrders]);

  // -------------------------------------------------------------------------
  // Line item handlers
  // -------------------------------------------------------------------------

  /** Append a new blank line, clearing a min-line error if present. */
  function addNewLine() {
    if (actionTone === "error" && actionMessage === CHANGE_ORDER_MIN_LINE_ITEMS_ERROR) setFeedback("");
    addNewLineRaw();
  }
  function addEditLine() {
    if (actionTone === "error" && actionMessage === CHANGE_ORDER_MIN_LINE_ITEMS_ERROR) setFeedback("");
    addEditLineRaw();
  }

  /** Remove a line item, enforcing the minimum of one line. */
  function removeNewLine(localId: number) {
    if (!removeNewLineRaw(localId)) setFeedback(CHANGE_ORDER_MIN_LINE_ITEMS_ERROR, "error");
  }
  function removeEditLine(localId: number) {
    if (!removeEditLineRaw(localId)) setFeedback(CHANGE_ORDER_MIN_LINE_ITEMS_ERROR, "error");
  }

  // -------------------------------------------------------------------------
  // Submit & mutation handlers
  // -------------------------------------------------------------------------

  /** Reset the workspace to a fresh "new change order" draft. */
  function handleStartNewChangeOrder() {
    hydrateEditForm(undefined);
    setNewTitleManuallyEdited(false);
    setNewTitle(defaultChangeOrderTitle(selectedProjectName));
    setNewReason("");
    setNewTermsText(defaultChangeOrderTerms);
    resetNewLines();
    setFeedback("Ready for a new change order draft.", "info");
    flashCreate();
  }

  /** Handle form submission for creating a new change order draft. */
  async function handleCreateChangeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutateChangeOrders) {
      setFeedback(`Role ${role} is read-only for change order mutations.`, "error");
      return;
    }
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setFeedback("Select a project first.", "error");
      return;
    }

    const hasMissingCostCode = newLineItems.some((line) => !line.costCodeId.trim());
    if (hasMissingCostCode) {
      setFeedback("Every line item must have a cost code.", "error");
      return;
    }

    setFeedback("");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/projects/${projectId}/change-orders/`,
        {
          method: "POST",
          headers: buildAuthHeaders(token, { contentType: "application/json" }),
          body: JSON.stringify({
            title: newTitle,
            reason: newReason,
            terms_text: newTermsText,
            amount_delta: formatDecimal(newLineDeltaTotal),
            days_delta: newLineDaysTotal,
            origin_estimate: selectedViewerEstimateId ? Number(selectedViewerEstimateId) : null,
            line_items: toLinePayload(newLineItems),
          }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setFeedback(readChangeOrderApiError(payload, "Create change order failed."), "error");
        return;
      }
      const created = payload.data as ChangeOrderRecord;

      const { rows } = await fetchProjectChangeOrders(projectId);

      if (rows) {
        setChangeOrders(rows);
        const persisted = rows.find((row) => row.id === created.id);
        hydrateEditForm(persisted ?? created);
        await loadProjectAuditEvents(projectId);
      } else {
        setChangeOrders((current) => [created, ...current]);
        hydrateEditForm(created);
        await loadProjectAuditEvents(projectId);
      }
      setFeedback(`Created change order #${created.id}.`, "success");
      resetNewLines();
      setNewTitleManuallyEdited(false);
      setNewTitle(defaultChangeOrderTitle(selectedProjectName));
      setNewReason("");
      setNewTermsText(defaultChangeOrderTerms);
      flashCreate();
    } catch {
      setFeedback("Could not reach change order create endpoint.", "error");
    }
  }

  /** Clone the selected change order as a new draft revision. */
  async function handleCloneRevision() {
    if (!canMutateChangeOrders) {
      setFeedback(`Role ${role} is read-only for change order mutations.`, "error");
      return;
    }
    const changeOrderId = Number(selectedChangeOrderId);
    if (!changeOrderId) {
      setFeedback("Select a change order first.", "error");
      return;
    }
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setFeedback("Select a project first.", "error");
      return;
    }

    setFeedback("");
    try {
      const response = await fetch(`${normalizedBaseUrl}/change-orders/${changeOrderId}/clone-revision/`, {
        method: "POST",
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setFeedback(readChangeOrderApiError(payload, "Clone revision failed."), "error");
        return;
      }
      const created = payload.data as ChangeOrderRecord;
      const { rows } = await fetchProjectChangeOrders(projectId);

      if (rows) {
        setChangeOrders(rows);
        const persisted = rows.find((row) => row.id === created.id);
        hydrateEditForm(persisted ?? created);
        await loadProjectAuditEvents(projectId);
      }
      setFeedback(`Duplicated as ${coLabel(created)}.`, "success");
      flashEdit();
    } catch {
      setFeedback("Could not reach clone revision endpoint.", "error");
    }
  }

  /** Handle form submission for saving edits to an existing draft change order. */
  async function handleUpdateChangeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutateChangeOrders) {
      setFeedback(`Role ${role} is read-only for change order mutations.`, "error");
      return;
    }
    const changeOrderId = Number(selectedChangeOrderId);
    if (!changeOrderId) {
      setFeedback("Select a change order first.", "error");
      return;
    }
    if (!selectedChangeOrder) {
      setFeedback("Selected change order could not be resolved.", "error");
      return;
    }

    const hasMissingCostCode = editLineItems.some((line) => !line.costCodeId.trim());
    if (hasMissingCostCode) {
      setFeedback("Every line item must have a cost code.", "error");
      return;
    }

    setFeedback("");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/change-orders/${changeOrderId}/`,
        {
          method: "PATCH",
          headers: buildAuthHeaders(token, { contentType: "application/json" }),
          body: JSON.stringify({
            title: editTitle,
            reason: editReason,
            terms_text: editTermsText,
            amount_delta: formatDecimal(editLineDeltaTotal),
            days_delta: editLineDaysTotal,
            status: selectedChangeOrder.status,
            line_items: toLinePayload(editLineItems),
          }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setFeedback(readChangeOrderApiError(payload, "Save change order failed."), "error");
        return;
      }
      const updated = payload.data as ChangeOrderRecord;
      const projectId = Number(selectedProjectId);
      const { rows } = await fetchProjectChangeOrders(projectId);
      if (rows) {
        setChangeOrders(rows);
        const persisted = rows.find((row) => row.id === updated.id);
        hydrateEditForm(persisted ?? updated);
        await loadProjectAuditEvents(projectId);
        setFeedback(`Saved change order ${coLabel(updated)} (${statusLabel(updated.status, changeOrderStatusLabels)}).`, "success");
      } else {
        setChangeOrders((current) =>
          current.map((row) => (row.id === updated.id ? updated : row)),
        );
        hydrateEditForm(updated);
        await loadProjectAuditEvents(projectId);
        setFeedback(`Saved change order ${coLabel(updated)} (${statusLabel(updated.status, changeOrderStatusLabels)}).`, "success");
      }
    } catch {
      setFeedback("Could not reach change order detail endpoint.", "error");
    }
  }

  /** Apply a quick status transition (or resend) to the selected viewer change order. */
  async function handleQuickUpdateStatus() {
    if (!canMutateChangeOrders) {
      setFeedback(`Role ${role} is read-only for change order mutations.`, "error");
      return;
    }
    const projectId = Number(selectedProjectId);
    if (!selectedViewerChangeOrder || !quickStatus) {
      setFeedback("Select a change order and next status first.", "error");
      return;
    }
    if (!projectId) {
      setFeedback("Select a project first.", "error");
      return;
    }

    const isResend =
      selectedViewerChangeOrder.status === quickStatus && quickStatus === "pending_approval";

    setFeedback("");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/change-orders/${selectedViewerChangeOrder.id}/`,
        {
          method: "PATCH",
          headers: buildAuthHeaders(token, { contentType: "application/json" }),
          body: JSON.stringify({ status: quickStatus, status_note: quickStatusNote }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setFeedback(readChangeOrderApiError(payload, "Status update failed."), "error");
        return;
      }
      const updated = payload.data as ChangeOrderRecord;
      const { rows } = await fetchProjectChangeOrders(projectId);
      if (rows) {
        setChangeOrders(rows);
        const persisted = rows.find((row) => row.id === updated.id);
        hydrateEditForm(persisted ?? updated);
        await loadProjectAuditEvents(projectId);
      } else {
        setChangeOrders((current) =>
          current.map((row) => (row.id === updated.id ? updated : row)),
        );
        hydrateEditForm(updated);
        await loadProjectAuditEvents(projectId);
      }
      const emailNote = quickStatus === "pending_approval" && payload.email_sent === false ? " No email sent — customer has no email on file." : "";
      if (isResend) {
        setFeedback(`Re-sent ${coLabel(updated)} for approval. History updated.${emailNote}`, "success");
      } else {
        setFeedback(`Updated ${coLabel(updated)} to ${statusLabel(updated.status, changeOrderStatusLabels)}. History updated.${emailNote}`, "success");
      }
      setQuickStatus("");
      setQuickStatusNote("");
    } catch {
      setFeedback("Could not reach change order detail endpoint.", "error");
    }
  }

  /** Append a status note without changing the change order's current status. */
  async function handleAddChangeOrderStatusNote() {
    if (!canMutateChangeOrders) {
      setFeedback(`Role ${role} is read-only for change order mutations.`, "error");
      return;
    }
    const projectId = Number(selectedProjectId);
    if (!selectedViewerChangeOrder) {
      setFeedback("Select a change order first.", "error");
      return;
    }
    if (!projectId) {
      setFeedback("Select a project first.", "error");
      return;
    }
    if (!quickStatusNote.trim()) {
      setFeedback("Enter a status note first.", "error");
      return;
    }

    setFeedback("");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/change-orders/${selectedViewerChangeOrder.id}/`,
        {
          method: "PATCH",
          headers: buildAuthHeaders(token, { contentType: "application/json" }),
          body: JSON.stringify({ status_note: quickStatusNote }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setFeedback(readChangeOrderApiError(payload, "Status note update failed."), "error");
        return;
      }
      const updated = payload.data as ChangeOrderRecord;
      const { rows } = await fetchProjectChangeOrders(projectId);
      if (rows) {
        setChangeOrders(rows);
        const persisted = rows.find((row) => row.id === updated.id);
        hydrateEditForm(persisted ?? updated);
        await loadProjectAuditEvents(projectId);
      } else {
        setChangeOrders((current) =>
          current.map((row) => (row.id === updated.id ? updated : row)),
        );
        hydrateEditForm(updated);
        await loadProjectAuditEvents(projectId);
      }
      setQuickStatusNote("");
      setFeedback(`Added status note on ${coLabel(updated)}. History updated.`, "success");
    } catch {
      setFeedback("Could not reach change order detail endpoint.", "error");
    }
  }

  // -------------------------------------------------------------------------
  // Viewer callbacks
  // -------------------------------------------------------------------------

  /** Handle estimate rail selection: update viewer estimate and sync the edit form. */
  const handleSelectViewerEstimate = useCallback((nextEstimateId: string) => {
    setSelectedViewerEstimateId(nextEstimateId);
    const related = sortChangeOrdersForViewer(
      changeOrders.filter(
        (changeOrder) => String(changeOrder.origin_estimate) === nextEstimateId,
      ),
    );
    if (!related.length) {
      hydrateEditForm(undefined);
      return;
    }
    const selectedStillValid = related.some(
      (changeOrder) => String(changeOrder.id) === selectedChangeOrderId,
    );
    if (!selectedStillValid) {
      hydrateEditForm(related[0]);
    }
  }, [changeOrders, hydrateEditForm, selectedChangeOrderId, sortChangeOrdersForViewer]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <section>
      {actionMessage && actionTone !== "success" ? (
        <p
          className={
            actionTone === "error"
              ? creatorStyles.actionError
              : creatorStyles.inlineHint
          }
        >
          {actionMessage}
        </p>
      ) : null}
      {!canMutateChangeOrders ? (
        <p className={styles.roleReadOnlyNote}>
          Role `{role}` can view change orders but cannot create or update.
        </p>
      ) : null}

      <ChangeOrdersViewerPanel
        isMobile={isMobile}
        isViewerExpanded={isViewerExpanded}
        setIsViewerExpanded={setIsViewerExpanded}
        selectedProjectId={selectedProjectId}
        selectedProjectName={selectedProjectName}
        selectedProjectCustomerEmail={selectedProjectCustomerEmail}
        projectEstimates={projectEstimates}
        selectedViewerEstimateId={selectedViewerEstimateId}
        changeOrders={changeOrders}
        originEstimateOriginalTotals={originEstimateOriginalTotals}
        onSelectEstimate={handleSelectViewerEstimate}
        selectedViewerEstimate={selectedViewerEstimate}
        viewerChangeOrders={viewerChangeOrders}
        paginatedChangeOrders={paginatedChangeOrders}
        selectedChangeOrderId={selectedChangeOrderId}
        coPage={coPage}
        coTotalPages={coTotalPages}
        coTotalCount={coTotalCount}
        setCoPage={setCoPage}
        onSelectChangeOrder={hydrateEditForm}
        projectAuditEvents={projectAuditEvents}
        changeOrderStatusLabels={changeOrderStatusLabels}
        selectedViewerChangeOrder={selectedViewerChangeOrder}
        selectedViewerWorkingTotals={selectedViewerWorkingTotals}
        approvedCOsForSelectedEstimate={approvedCOsForSelectedEstimate}
        canMutateChangeOrders={canMutateChangeOrders}
        quickStatusOptions={quickStatusOptions}
        quickStatus={quickStatus}
        setQuickStatus={setQuickStatus}
        quickStatusNote={quickStatusNote}
        setQuickStatusNote={setQuickStatusNote}
        onQuickUpdateStatus={handleQuickUpdateStatus}
        onAddChangeOrderStatusNote={handleAddChangeOrderStatusNote}
        actionMessage={actionMessage}
        actionTone={actionTone}
        isStatusSectionOpen={isStatusSectionOpen}
        setIsStatusSectionOpen={setIsStatusSectionOpen}
        isHistorySectionOpen={isHistorySectionOpen}
        setIsHistorySectionOpen={setIsHistorySectionOpen}
        isLineItemsSectionOpen={isLineItemsSectionOpen}
        setIsLineItemsSectionOpen={setIsLineItemsSectionOpen}
        isOriginLineItemsSectionOpen={isOriginLineItemsSectionOpen}
        setIsOriginLineItemsSectionOpen={setIsOriginLineItemsSectionOpen}
        selectedChangeOrderStatusEvents={selectedChangeOrderStatusEvents}
        showAllEvents={showAllEvents}
        setShowAllEvents={setShowAllEvents}
      />


      {projectEstimates.length === 0 && !selectedChangeOrder ? (
        <p className={styles.viewerHint}>
          Approve an estimate on this project first to start creating change orders.
        </p>
      ) : (
      <>
      <ChangeOrdersWorkspacePanel
        isMobile={isMobile}
        selectedProjectId={selectedProjectId}
        selectedViewerEstimateId={selectedViewerEstimateId}
        selectedViewerEstimate={selectedViewerEstimate}
        projectEstimates={projectEstimates}
        selectedChangeOrder={selectedChangeOrder}
        selectedViewerChangeOrder={selectedViewerChangeOrder}
        isSelectedChangeOrderEditable={isSelectedChangeOrderEditable}
        workspaceContext={workspaceContext}
        workspaceBadgeLabel={workspaceBadgeLabel}
        workspaceBadgeClass={workspaceBadgeClass}
        onStartNew={handleStartNewChangeOrder}
        onCloneRevision={handleCloneRevision}
        canMutateChangeOrders={canMutateChangeOrders}
        role={role}
        actionMessage={actionMessage}
        actionTone={actionTone}
        senderName={senderName}
        senderEmail={senderEmail}
        senderAddressLines={senderAddressLines}
        senderLogoUrl={senderLogoUrl}
        createCreatorRef={createCreatorRef}
        changeOrderCreatorAdapter={changeOrderCreatorAdapter}
        createChangeOrderCreatorFormState={createChangeOrderCreatorFormState}
        newTitle={newTitle}
        onNewTitleChange={(value) => { setNewTitle(value); setNewTitleManuallyEdited(true); }}
        newReason={newReason}
        onNewReasonChange={setNewReason}
        newTermsText={newTermsText}
        defaultChangeOrderTerms={defaultChangeOrderTerms}
        newLineItems={newLineItems}
        newLineValidation={newLineValidation}
        newLineDeltaTotal={newLineDeltaTotal}
        newLineDaysTotal={newLineDaysTotal}
        costCodes={costCodes}
        isCreateSubmitDisabled={isCreateSubmitDisabled}
        onCreateSubmit={handleCreateChangeOrder}
        onAddNewLine={addNewLine}
        onRemoveNewLine={removeNewLine}
        onUpdateNewLine={updateNewLine}
        onMoveNewLine={moveNewLine}
        editCreatorRef={editCreatorRef}
        editChangeOrderCreatorFormState={editChangeOrderCreatorFormState}
        editTitle={editTitle}
        onEditTitleChange={setEditTitle}
        editReason={editReason}
        onEditReasonChange={setEditReason}
        editTermsText={editTermsText}
        editLineItems={editLineItems}
        editLineValidation={editLineValidation}
        editLineDeltaTotal={editLineDeltaTotal}
        editLineDaysTotal={editLineDaysTotal}
        isEditSubmitDisabled={isEditSubmitDisabled}
        onEditSubmit={handleUpdateChangeOrder}
        onAddEditLine={addEditLine}
        onRemoveEditLine={removeEditLine}
        onUpdateEditLine={updateEditLine}
        onMoveEditLine={moveEditLine}
        approvedCOsForSelectedEstimate={approvedCOsForSelectedEstimate}
        isOriginLineItemsSectionOpen={isOriginLineItemsSectionOpen}
        setIsOriginLineItemsSectionOpen={setIsOriginLineItemsSectionOpen}
        currentAcceptedTotal={currentAcceptedTotal}
        originalEstimateTotal={originalEstimateTotal}
      />
      </>
      )}
    </section>
  );
}
