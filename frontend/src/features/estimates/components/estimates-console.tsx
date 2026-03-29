"use client";

/**
 * Estimates console -- orchestrator for the internal estimate workspace.
 *
 * Pure orchestrator — composes single-purpose hooks, wires their outputs
 * into child components, and owns cross-cutting coordination (data loading,
 * mutations, family collision logic, status transitions).
 *
 * Parent: app/projects/[projectId]/estimates/page.tsx
 *
 * ## Page layout
 *
 * ┌─────────────────────────────────────────────────┐
 * │ EstimatesViewerPanel                            │
 * │   ├── Status filter pills                       │
 * │   ├── Family-grouped estimate tree               │
 * │   ├── Status transition controls                 │
 * │   └── Status event history                       │
 * ├─────────────────────────────────────────────────┤
 * │ EstimatesWorkspacePanel                          │
 * │   ├── Workspace header (context badge)           │
 * │   ├── Family collision prompt                    │
 * │   └── Estimate composer (sheet form)             │
 * └─────────────────────────────────────────────────┘
 *
 * ## Hook dependency graph
 *
 * useLineItems             (standalone — line item CRUD primitives)
 * useEstimateFormFields    (reads organizationDefaults, lineItem setters)
 *   └── hydrateFromEstimate / resetFormFields used by console orchestration
 * usePolicyContract        (standalone — fetches policy, drives status config)
 * useStatusFilters         (standalone — status filter pill state)
 * useCreatorFlash          (standalone — composer flash animation)
 *
 * ## Functions
 *
 * - loadDependencies()         — Fetches projects, cost codes, org defaults
 * - loadEstimates(options?)    — Fetches estimates for selected project
 * - loadStatusEvents(options?) — Fetches status event history
 * - handleSelectEstimate()     — Selects estimate, hydrates form
 * - clearSelectedEstimateState() — Resets selection + form to blank draft
 * - startNewEstimate()         — Clears selection and flashes composer
 * - handleCreateEstimate()     — Create or save-draft form submission
 * - handleDuplicateAsNew()     — Pre-fill create form from selected estimate
 * - handleUpdateEstimateStatus() — Apply status transition
 * - handleAddEstimateStatusNote() — Append note without transition
 * - handleFamilyCardQuickAction() — Route CO/duplicate quick actions
 * - buildOrderedPayload()     — Build line_items (with order) and sections for API
 *
 * ## Effects
 *
 * - Sync printable state with estimate selection
 * - Keep selectedEstimateIdRef in sync for async callbacks
 * - Keep estimateStatusFiltersRef in sync for filter-aware loads
 * - Fetch dependencies on auth token
 * - Reload estimates on project change
 * - Sync scoped project ID from props
 * - Seed estimate date defaults on first render (in form fields hook)
 * - Load status events on estimate selection change
 * - Sync org defaults to form fields on first load
 *
 * ## Orchestration (in JSX)
 *
 * - Viewer panel receives all lifecycle props (filters, families, status controls)
 * - Workspace panel receives form fields, line items, and mutation handlers
 * - Collision confirm/dismiss wired inline to form field + submit coordination
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { apiBaseUrl } from "@/shared/api/base";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCreatorFlash } from "@/shared/hooks/use-creator-flash";
import { fetchEstimatePolicyContract } from "../api";
import { usePolicyContract } from "@/shared/hooks/use-policy-contract";
import { useStatusFilters } from "@/shared/hooks/use-status-filters";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { canDo } from "@/shared/session/rbac";
import { usePrintable } from "@/shared/shell/printable-context";
import styles from "./estimates-console.module.css";
import { useRouter, useSearchParams } from "next/navigation";
import { todayDateInput, addDaysToDateInput } from "@/shared/date-format";
import {
  ApiResponse,
  CostCode,
  EstimateLineInput,
  EstimatePolicyContract,
  EstimateRecord,
  EstimateStatusEventRecord,
  ProjectRecord,
} from "../types";
import {
  computeEstimateStatusCounts,
  computeLineTotal,
  emptyLine,
  filterVisibleFamilies,
  groupEstimateFamilies,
  normalizeFamilyTitle,
  readEstimateApiError,
  resolveAutoSelectEstimate,
  resolveEstimateValidationDeltaDays,
  toNumber,
  validateEstimateLineItems,
} from "../helpers";
import type { EstimateSheetV2Handle, OrganizationDocumentDefaults } from "./estimate-sheet-v2";
import { EstimatesViewerPanel } from "./estimates-viewer-panel";
import { EstimatesWorkspacePanel } from "./estimates-workspace-panel";
import { useLineItems } from "@/shared/hooks/use-line-items";
import { useMediaQuery } from "@/shared/hooks/use-media-query";
import { useEstimateFormFields } from "../hooks/use-estimate-form-fields";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type EstimateStatusValue = string;
type LoadEstimatesOptions = {
  preserveSelection?: boolean;
  preferredEstimateId?: number | null;
  quiet?: boolean;
};
type EstimatesConsoleProps = {
  scopedProjectId?: number | null;
};

const ESTIMATE_STATUSES_FALLBACK: string[] = [
  "draft",
  "sent",
  "approved",
  "rejected",
  "void",
  "archived",
];
const ESTIMATE_STATUS_LABELS_FALLBACK: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  approved: "Approved",
  rejected: "Rejected",
  void: "Void",
  archived: "Archived",
};
const ESTIMATE_DEFAULT_STATUS_FILTERS_FALLBACK: string[] = [
  "draft",
  "sent",
  "approved",
  "rejected",
];
const ESTIMATE_ALLOWED_STATUS_TRANSITIONS_FALLBACK: Record<string, EstimateStatusValue[]> = {
  draft: ["sent", "void", "archived"],
  sent: ["sent", "approved", "rejected", "void", "archived"],
  approved: [],
  rejected: ["void"],
  void: [],
  archived: [],
};
const ESTIMATE_QUICK_ACTION_BY_STATUS_FALLBACK: Record<string, "change_order" | "revision"> = {
  approved: "change_order",
  rejected: "revision",
  void: "revision",
};
const ESTIMATE_SYSTEM_ONLY_STATUSES = new Set<EstimateStatusValue>(["archived"]);
const ESTIMATE_MIN_LINE_ITEMS_ERROR = "At least one line item is required.";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Internal estimates workspace: version tree, composer, status lifecycle, and family management. */
export function EstimatesConsole({ scopedProjectId: scopedProjectIdProp = null }: EstimatesConsoleProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useMediaQuery("(max-width: 850px)");
  const { token: authToken, role, capabilities } = useSharedSessionAuth();
  const canMutateEstimates = canDo(capabilities, "estimates", "create");
  const canSendEstimates = canDo(capabilities, "estimates", "send");
  const canApproveEstimates = canDo(capabilities, "estimates", "approve");

  // -------------------------------------------------------------------------
  // Message state
  // -------------------------------------------------------------------------

  const [formErrorMessage, setFormErrorMessage] = useState("");
  const [formSuccessMessage, setFormSuccessMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionTone, setActionTone] = useState<"error" | "success" | "info">("info");

  // -------------------------------------------------------------------------
  // Data state
  // -------------------------------------------------------------------------

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [organizationDefaults, setOrganizationDefaults] =
    useState<OrganizationDocumentDefaults | null>(null);
  const [estimates, setEstimates] = useState<EstimateRecord[]>([]);
  const [selectedEstimateId, setSelectedEstimateId] = useState("");
  const selectedEstimateIdRef = useRef("");

  // -------------------------------------------------------------------------
  // Line items (shared hook)
  // -------------------------------------------------------------------------

  const {
    items: lineItems, setItems: setLineItems,
    setNextId: setNextLineId,
    add: addLineRaw, remove: removeLineRaw,
    update: updateLineRaw, reset: resetLines,
  } = useLineItems<EstimateLineInput>({ createEmpty: emptyLine });

  // -------------------------------------------------------------------------
  // Form fields (extracted hook)
  // -------------------------------------------------------------------------

  const formFields = useEstimateFormFields({
    organizationDefaults,
    selectedEstimateIdRef,
    setLineItems,
    setNextLineId,
    resetLines,
  });

  // -------------------------------------------------------------------------
  // Policy contract
  // -------------------------------------------------------------------------

  const [estimateQuickActionByStatus, setEstimateQuickActionByStatus] = useState<
    Record<string, "change_order" | "revision">
  >(ESTIMATE_QUICK_ACTION_BY_STATUS_FALLBACK);
  const [defaultEstimateStatusFilters, setDefaultEstimateStatusFilters] = useState<string[]>(
    ESTIMATE_DEFAULT_STATUS_FILTERS_FALLBACK,
  );

  const {
    statuses: estimateStatuses,
    statusLabels: estimateStatusLabels,
    allowedTransitions: estimateAllowedStatusTransitions,
  } = usePolicyContract<EstimatePolicyContract>({
    fetchContract: fetchEstimatePolicyContract,
    fallbackStatuses: ESTIMATE_STATUSES_FALLBACK,
    fallbackLabels: ESTIMATE_STATUS_LABELS_FALLBACK,
    fallbackTransitions: ESTIMATE_ALLOWED_STATUS_TRANSITIONS_FALLBACK,
    baseUrl: apiBaseUrl,
    authToken,
    onLoaded(contract, base) {
      // Domain-specific: quick-action map and filter reconciliation.
      const quickActionMap = {
        ...ESTIMATE_QUICK_ACTION_BY_STATUS_FALLBACK,
        ...(contract.quick_action_by_status || {}),
      };
      setEstimateQuickActionByStatus(quickActionMap);

      const candidateFilters =
        Array.isArray(contract.default_status_filters) && contract.default_status_filters.length
          ? contract.default_status_filters
          : ESTIMATE_DEFAULT_STATUS_FILTERS_FALLBACK;
      const validFilters = candidateFilters.filter((v) => base.statuses.includes(v));
      const resolvedDefaults = validFilters.length ? validFilters : base.statuses;
      setDefaultEstimateStatusFilters(resolvedDefaults);

      setEstimateStatusFilters((current) => {
        const retained = current.filter((v) => base.statuses.includes(v));
        return retained.length ? retained : resolvedDefaults;
      });
      setSelectedStatus((current) =>
        current && base.statuses.includes(current) ? current : "",
      );
    },
  });

  // -------------------------------------------------------------------------
  // Status lifecycle state
  // -------------------------------------------------------------------------

  const [selectedStatus, setSelectedStatus] = useState<EstimateStatusValue>("draft");
  const [statusNote, setStatusNote] = useState("");
  const [statusEvents, setStatusEvents] = useState<EstimateStatusEventRecord[]>([]);

  // -------------------------------------------------------------------------
  // Status filters (shared hook)
  // -------------------------------------------------------------------------

  const viewerStatuses = estimateStatuses.filter(s => !ESTIMATE_SYSTEM_ONLY_STATUSES.has(s));
  const {
    filters: estimateStatusFilters,
    setFilters: setEstimateStatusFilters,
    toggleFilter: toggleEstimateStatusFilter,
  } = useStatusFilters({
    allStatuses: viewerStatuses,
    defaultFilters: ESTIMATE_DEFAULT_STATUS_FILTERS_FALLBACK,
    preserveOrder: true,
  });
  const estimateStatusFiltersRef = useRef<EstimateStatusValue[]>(
    ESTIMATE_DEFAULT_STATUS_FILTERS_FALLBACK,
  );

  // -------------------------------------------------------------------------
  // UI state & refs
  // -------------------------------------------------------------------------

  const [openFamilyHistory, setOpenFamilyHistory] = useState<Set<string>>(() => new Set());
  const [isViewerExpanded, setIsViewerExpanded] = useState(true);
  const { ref: estimateComposerRef, flash: flashCreator } = useCreatorFlash();
  const sheetRef = useRef<EstimateSheetV2Handle>(null);
  const { setPrintable } = usePrintable();

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  useEffect(() => {
    setPrintable(!!selectedEstimateId);
    return () => setPrintable(false);
  }, [selectedEstimateId, setPrintable]);

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

  const scopedProjectId = scopedProjectIdProp;
  const scopedEstimateIdParam = searchParams.get("estimate");
  const scopedEstimateId =
    scopedEstimateIdParam && /^\d+$/.test(scopedEstimateIdParam)
      ? Number(scopedEstimateIdParam)
      : null;
  const selectedProject =
    projects.find((project) => String(project.id) === selectedProjectId) ?? null;
  const selectedEstimate =
    estimates.find((estimate) => String(estimate.id) === selectedEstimateId) ?? null;
  const isProjectTerminal =
    selectedProject?.status === "completed" || selectedProject?.status === "cancelled";
  const isEditingDraft = Boolean(selectedEstimate && selectedEstimate.status === "draft");
  const isReadOnly = !canMutateEstimates || isProjectTerminal || Boolean(selectedEstimate && selectedEstimate.status !== "draft");
  const statusClasses: Record<string, string> = {
    draft: styles.statusDraft,
    sent: styles.statusSent,
    approved: styles.statusApproved,
    rejected: styles.statusRejected,
    void: styles.statusArchived,
    archived: styles.statusArchived,
  };
  const statusOptions: Array<{ value: EstimateStatusValue; label: string }> = estimateStatuses.map(
    (statusValue) => ({
      value: statusValue,
      label: estimateStatusLabels[statusValue] ?? statusValue,
    }),
  );
  const viewerStatusOptions = statusOptions.filter(
    (option) => !ESTIMATE_SYSTEM_ONLY_STATUSES.has(option.value),
  );
  const estimateStatusFilterValues = viewerStatusOptions.map((option) => option.value);
  const statusLabelByValue = statusOptions.reduce<Record<string, string>>((labels, option) => {
    labels[option.value] = option.label;
    return labels;
  }, {});
  const nextStatusValues = selectedEstimate
    ? estimateAllowedStatusTransitions[selectedEstimate.status] ?? []
    : [];
  const nextStatusOptions = statusOptions
    .filter(
      (option) =>
        nextStatusValues.includes(option.value) &&
        !ESTIMATE_SYSTEM_ONLY_STATUSES.has(option.value),
    )
    .filter((option) => {
      if (option.value === "sent") return canSendEstimates;
      if (option.value === "approved") return canApproveEstimates;
      return true;
    })
    .map((option) =>
      selectedEstimate?.status === "sent" && option.value === "sent"
        ? { ...option, label: "Re-send" }
        : option,
    );
  const isTerminalEstimateStatus = Boolean(
    selectedEstimate &&
      (selectedEstimate.status === "approved" || selectedEstimate.status === "void"),
  );
  const canSubmitStatusUpdate = selectedEstimate
    ? !isTerminalEstimateStatus && nextStatusOptions.length > 0 && Boolean(selectedStatus)
    : false;
  const canSubmitStatusNote = selectedEstimate
    ? Boolean(statusNote.trim())
    : false;
  const workspaceContext = selectedEstimate
    ? `${selectedEstimate.title || "Untitled"} · v${selectedEstimate.version}`
    : "New estimate draft";
  const workspaceContextLabel = !selectedEstimate
    ? "Creating"
    : isEditingDraft
      ? "Editing"
      : "Viewing";
  const workspaceBadgeLabel = !selectedEstimate
    ? "CREATING"
    : isEditingDraft && !isReadOnly
      ? "EDITING"
      : "READ-ONLY";
  const workspaceBadgeClass = !selectedEstimate
    ? styles.statusDraft
    : isEditingDraft && !isReadOnly
      ? styles.statusDraft
      : statusClasses[selectedEstimate.status] ?? styles.statusArchived;

  // -------------------------------------------------------------------------
  // Display helpers
  // -------------------------------------------------------------------------

  /** Resolve a status value to its human-readable label. */
  function formatEstimateStatus(status?: string): string {
    if (!status) {
      return "";
    }
    return statusLabelByValue[status] ?? status;
  }

  /** Determine the quick-action kind for a given estimate status (CO link or revision clone). */
  function quickActionKindForStatus(status: string): "change_order" | "revision" | null {
    return estimateQuickActionByStatus[status] ?? null;
  }

  function quickActionTitleForStatus(status: string): string {
    const kind = quickActionKindForStatus(status);
    if (kind === "change_order") {
      return "View change orders for this estimate";
    }
    if (kind === "revision") {
      return "Duplicate as new";
    }
    return "";
  }

  // -------------------------------------------------------------------------
  // Data loading & form hydration
  // -------------------------------------------------------------------------

  /** Pre-fill the create form from an existing estimate (duplicate-as-new). */
  function handleDuplicateAsNew(sourceEstimate: EstimateRecord) {
    formFields.populateCreateFromEstimate(sourceEstimate);
    setSelectedEstimateId("");
    selectedEstimateIdRef.current = "";
    flashCreator();
  }

  /** Route the quick-action click for a family card to CO navigation or duplicate. */
  function handleFamilyCardQuickAction(sourceEstimate: EstimateRecord) {
    const actionKind = quickActionKindForStatus(sourceEstimate.status);
    if (!actionKind) {
      return;
    }
    if (actionKind === "change_order") {
      if (!selectedProjectId) {
        setActionMessage("Select a project first.");
        return;
      }
      router.push(`/projects/${selectedProjectId}/change-orders?origin_estimate=${sourceEstimate.id}`);
      return;
    }
    handleDuplicateAsNew(sourceEstimate);
  }

  const lineTotals = useMemo(() => lineItems.map(computeLineTotal), [lineItems]);

  const lineValidation = useMemo(() => validateEstimateLineItems(lineItems), [lineItems]);
  const subtotal = lineTotals.reduce((sum, value) => sum + value, 0);
  const taxRate = toNumber(formFields.taxPercent);
  const taxableBase = lineTotals.reduce((sum, value, index) => {
    const cc = costCodes.find((c) => String(c.id) === lineItems[index].costCodeId);
    return sum + (cc?.taxable !== false ? value : 0);
  }, 0);
  const taxAmount = taxableBase * (taxRate / 100);
  const totalAmount = subtotal + taxAmount;
  const estimateFamilies = useMemo(() => groupEstimateFamilies(estimates), [estimates]);
  const estimateStatusCounts = useMemo(() => computeEstimateStatusCounts(estimateFamilies), [estimateFamilies]);
  const visibleEstimateFamilies = useMemo(
    () => filterVisibleFamilies(estimateFamilies, estimateStatusFilters),
    [estimateFamilies, estimateStatusFilters],
  );


  const loadEstimateIntoForm = formFields.hydrateFromEstimate;

  const handleSelectEstimate = useCallback((estimate: EstimateRecord) => {
    const nextEstimateId = String(estimate.id);
    const isSameEstimate = nextEstimateId === selectedEstimateIdRef.current;
    setSelectedEstimateId(nextEstimateId);
    setSelectedStatus("");
    if (!isSameEstimate) {
      setStatusEvents([]);
    }
    setFormErrorMessage("");
    setFormSuccessMessage("");
    setActionMessage("");
    formFields.setFamilyCollisionPrompt(null);
    formFields.setConfirmedFamilyTitleKey("");
    loadEstimateIntoForm(estimate);
    formFields.setTitleLocked(false);
  }, [loadEstimateIntoForm]);

  // Keep the ref in sync so async callbacks always see the latest selection.
  useEffect(() => {
    selectedEstimateIdRef.current = selectedEstimateId;
  }, [selectedEstimateId]);

  // Keep the ref in sync so filter-aware data loads use the latest value.
  useEffect(() => {
    estimateStatusFiltersRef.current = estimateStatusFilters;
  }, [estimateStatusFilters]);


  const clearSelectedEstimateState = useCallback(() => {
    setSelectedEstimateId("");
    selectedEstimateIdRef.current = "";
    setSelectedStatus("");
    setStatusNote("");
    setStatusEvents([]);
    formFields.resetFormFields();
  }, [formFields.resetFormFields]);

  /** Reset the composer to a blank draft. */
  function startNewEstimate() {
    clearSelectedEstimateState();
    setActionMessage("");
    setFormErrorMessage("");
    setFormSuccessMessage("");
    flashCreator();
  }

  /** Select the latest version of a family and toggle its history expansion. */
  function handleSelectFamilyLatest(title: string, latest: EstimateRecord) {
    handleSelectEstimate(latest);
    setOpenFamilyHistory((current) => {
      if (current.has(title)) {
        return new Set<string>();
      }
      return new Set<string>([title]);
    });
  }

  const loadDependencies = useCallback(async () => {
    setActionMessage("");
    try {
      const [projectsRes, codesRes, organizationRes] = await Promise.all([
        fetch(`${apiBaseUrl}/projects/`, {
          headers: buildAuthHeaders(authToken),
        }),
        fetch(`${apiBaseUrl}/cost-codes/`, {
          headers: buildAuthHeaders(authToken),
        }),
        fetch(`${apiBaseUrl}/organization/`, {
          headers: buildAuthHeaders(authToken),
        }),
      ]);

      const projectsJson: ApiResponse = await projectsRes.json();
      const codesJson: ApiResponse = await codesRes.json();
      const organizationJson: ApiResponse = await organizationRes.json();

      if (!projectsRes.ok) {
        setActionMessage(readEstimateApiError(projectsJson, "Failed loading projects."));
        return;
      }
      if (!codesRes.ok) {
        setActionMessage(readEstimateApiError(codesJson, "Failed loading cost codes."));
        return;
      }

      const projectRows = (projectsJson.data as ProjectRecord[]) ?? [];
      const codeRows = ((codesJson.data as CostCode[]) ?? []).filter((code) => code.is_active);
      const organizationData = (
        organizationJson.data as { organization?: OrganizationDocumentDefaults } | undefined
      )?.organization;
      setProjects(projectRows);
      setCostCodes(codeRows);
      if (organizationRes.ok && organizationData) {
        setOrganizationDefaults(organizationData);
        formFields.setTermsText((current) => current || organizationData.estimate_terms_and_conditions || "");
        formFields.setValidThrough((current) => {
          if (selectedEstimateIdRef.current || current) {
            return current;
          }
          const estimateDateSeed = todayDateInput();
          return addDaysToDateInput(
            estimateDateSeed,
            resolveEstimateValidationDeltaDays(organizationData),
          );
        });
      }

      if (projectRows[0]) {
        const scopedMatch = scopedProjectId
          ? projectRows.find((project) => project.id === scopedProjectId)
          : null;
        setSelectedProjectId(String(scopedMatch?.id ?? projectRows[0].id));
      } else {
        setSelectedProjectId("");
      }

      // Cost codes loaded — lines without a cost code stay blank (user must pick).

    } catch {
      setActionMessage("Could not reach project and cost-code endpoints.");
    }
  }, [apiBaseUrl, scopedProjectId, authToken]);

  const loadEstimates = useCallback(async (options?: LoadEstimatesOptions) => {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      if (!options?.quiet) {
        setActionMessage("Select a project first.");
      }
      return;
    }

    if (!options?.preserveSelection) {
      clearSelectedEstimateState();
    }
    setFormErrorMessage("");
    setFormSuccessMessage("");
    if (!options?.quiet) {
      setActionMessage("");
    }

    try {
      const response = await fetch(`${apiBaseUrl}/projects/${projectId}/estimates/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();

      if (!response.ok) {
        if (!options?.quiet) {
          setActionMessage(readEstimateApiError(payload, "Failed loading estimates."));
        }
        return;
      }

      const rows = (payload.data as EstimateRecord[]) ?? [];
      setEstimates(rows);

      if (!rows[0]) {
        return;
      }

      // Use the explicitly requested estimate if provided, otherwise fall back
      // to the currently selected estimate when preserving selection (e.g. after
      // a status transition that reloads the list but should keep focus).
      const preferredId =
        options?.preferredEstimateId ??
        (options?.preserveSelection && /^\d+$/.test(selectedEstimateIdRef.current)
          ? Number(selectedEstimateIdRef.current)
          : null);

      const autoSelected = resolveAutoSelectEstimate(
        rows,
        estimateStatusFiltersRef.current,
        { preferredId, scopedId: scopedEstimateId },
      );

      if (autoSelected) {
        handleSelectEstimate(autoSelected);
      }
    } catch {
      if (!options?.quiet) {
        setActionMessage("Could not reach estimate endpoint.");
      }
    }
  }, [
    clearSelectedEstimateState,
    handleSelectEstimate,
    apiBaseUrl,
    scopedEstimateId,
    selectedProjectId,
    authToken,
  ]);

  // Fetch projects, cost codes, and organization defaults on auth.
  useEffect(() => {
    if (!authToken) {
      return;
    }
    void loadDependencies();
  }, [loadDependencies, authToken]);

  // Reload estimates when the selected project changes.
  useEffect(() => {
    if (!authToken || !selectedProjectId) {
      return;
    }
    void loadEstimates();
  }, [loadEstimates, selectedProjectId, authToken]);

  // Sync scoped project ID from props into local state when projects load.
  useEffect(() => {
    if (!projects.length || !scopedProjectId) {
      return;
    }
    const scopedMatch = projects.find((project) => project.id === scopedProjectId);
    if (!scopedMatch) {
      return;
    }
    const nextId = String(scopedMatch.id);
    if (nextId !== selectedProjectId) {
      setSelectedProjectId(nextId);
    }
  }, [projects, scopedProjectId, selectedProjectId]);

  // -------------------------------------------------------------------------
  // Line item handlers
  // -------------------------------------------------------------------------

  function addLineItem() {
    if (formErrorMessage === ESTIMATE_MIN_LINE_ITEMS_ERROR) setFormErrorMessage("");
    addLineRaw();
  }

  function removeLineItem(localId: number) {
    if (!removeLineRaw(localId)) {
      setFormErrorMessage(ESTIMATE_MIN_LINE_ITEMS_ERROR);
      setFormSuccessMessage("");
    }
  }

  function updateLineItem(
    localId: number,
    key: keyof Omit<EstimateLineInput, "localId">,
    value: string,
  ) {
    setFormErrorMessage("");
    setFormSuccessMessage("");
    updateLineRaw(localId, { [key]: value });
  }

  const canCreateEstimate = useMemo(
    () => canMutateEstimates && !isProjectTerminal && Boolean(selectedProjectId) && lineItems.length > 0,
    [canMutateEstimates, isProjectTerminal, lineItems.length, selectedProjectId],
  );

  // -------------------------------------------------------------------------
  // Submit & mutation handlers
  // -------------------------------------------------------------------------

  /** Build line_items (with order) and sections payload from the sheet's current state. */
  function buildOrderedPayload() {
    const orderPayload = sheetRef.current?.getOrderPayload();
    const lineItemOrders = orderPayload?.lineItemOrders ?? new Map<number, number>();
    const sections = orderPayload?.sections ?? [];

    const orderedLineItems = lineItems.map((line) => ({
      cost_code: Number(line.costCodeId),
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unit_price: line.unitCost,
      markup_percent: line.markupPercent,
      order: lineItemOrders.get(line.localId) ?? 0,
    }));

    return { line_items: orderedLineItems, sections };
  }

  async function submitNewEstimateWithTitle({
    projectId,
    title,
    allowExistingTitleFamily,
  }: {
    projectId: number;
    title: string;
    allowExistingTitleFamily: boolean;
  }) {
    setActionMessage("");
    formFields.submitGuard.current = true;
    formFields.setIsSubmitting(true);
    try {
      const { line_items, sections } = buildOrderedPayload();
      const response = await fetch(`${apiBaseUrl}/projects/${projectId}/estimates/`, {
        method: "POST",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({
          title,
          allow_existing_title_family: allowExistingTitleFamily,
          valid_through: formFields.validThrough || null,
          tax_percent: formFields.taxPercent,
          notes_text: formFields.notesText,
          line_items,
          sections,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        if (response.status === 409 && payload.error?.code === "estimate_family_exists") {
          const conflictMeta = payload.error?.meta ?? {};
          formFields.setFamilyCollisionPrompt({
            title,
            latestEstimateId:
              typeof conflictMeta.latest_estimate_id === "number"
                ? conflictMeta.latest_estimate_id
                : null,
            latestVersion:
              typeof conflictMeta.latest_version === "number" ? conflictMeta.latest_version : null,
            familySize: typeof conflictMeta.family_size === "number" ? conflictMeta.family_size : null,
          });
          formFields.setConfirmedFamilyTitleKey("");
        } else if (
          response.status === 409 &&
          payload.error?.code === "estimate_family_approved_locked"
        ) {
          formFields.setFamilyCollisionPrompt(null);
          formFields.setConfirmedFamilyTitleKey("");
        }
        setFormErrorMessage(
          readEstimateApiError(payload, "Create estimate failed. Check values and try again."),
        );
        return;
      }
      const created = payload.data as EstimateRecord;
      setEstimates((current) => [created, ...current]);
      setIsViewerExpanded(true);
      handleSelectEstimate(created);
      setStatusEvents([]);
      setFormErrorMessage("");
      setFormSuccessMessage(`Created ${created.title || "Untitled"} v${created.version}.`);
        loadEstimateIntoForm(created);
      formFields.setFamilyCollisionPrompt(null);
      formFields.setConfirmedFamilyTitleKey("");
      flashCreator();
    } catch {
      setFormErrorMessage("Could not reach estimate create endpoint.");
    } finally {
      formFields.submitGuard.current = false;
      formFields.setIsSubmitting(false);
    }
  }

  /** Handle form submission for creating a new estimate or saving a draft. */
  async function handleCreateEstimate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormErrorMessage("");
    setFormSuccessMessage("");
    if (formFields.submitGuard.current) {
      return;
    }
    if (!canMutateEstimates) {
      setFormErrorMessage(`Role ${role} is read-only for estimate mutations.`);
      return;
    }
    if (isReadOnly) {
      setFormErrorMessage("This estimate is read-only. Duplicate as new or start a fresh draft to edit.");
      return;
    }
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setFormErrorMessage("Select a project first.");
      return;
    }

    const trimmedTitle = formFields.estimateTitle.trim();
    if (!trimmedTitle) {
      setFormErrorMessage("Estimate title is required.");
      return;
    }

    const hasMissingCostCode = lineItems.some((line) => !line.costCodeId);
    if (hasMissingCostCode) {
      setFormErrorMessage("Every line item must have a cost code.");
      return;
    }

    if (isEditingDraft && selectedEstimate) {
      setActionMessage("");
      formFields.submitGuard.current = true;
      formFields.setIsSubmitting(true);
      try {
        const { line_items, sections } = buildOrderedPayload();
        const response = await fetch(`${apiBaseUrl}/estimates/${selectedEstimate.id}/`, {
          method: "PATCH",
          headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
          body: JSON.stringify({
            title: trimmedTitle,
            valid_through: formFields.validThrough || null,
            tax_percent: formFields.taxPercent,
            notes_text: formFields.notesText,
            line_items,
            sections,
          }),
        });
        const payload: ApiResponse = await response.json();
        if (!response.ok) {
          setFormErrorMessage(
            readEstimateApiError(payload, "Save draft failed. Check values and try again."),
          );
          return;
        }
        const updated = payload.data as EstimateRecord;
        setEstimates((current) =>
          current.map((estimate) => (estimate.id === updated.id ? updated : estimate)),
        );
        loadEstimateIntoForm(updated);
        setFormErrorMessage("");
        setFormSuccessMessage(`Saved draft ${updated.title || "Untitled"} v${updated.version}.`);
        flashCreator();
      } catch {
        setFormErrorMessage("Could not reach estimate update endpoint.");
      } finally {
        formFields.submitGuard.current = false;
        formFields.setIsSubmitting(false);
      }
      return;
    }

    const normalizedTitle = normalizeFamilyTitle(trimmedTitle);
    const existingFamily = estimateFamilies.find(
      (family) => normalizeFamilyTitle(family.title) === normalizedTitle,
    );
    const familyHasApprovedVersion = Boolean(
      existingFamily?.items.some((estimate) => estimate.status === "approved"),
    );
    const promptMatchesCurrentTitle =
      formFields.familyCollisionPrompt &&
      normalizeFamilyTitle(formFields.familyCollisionPrompt.title) === normalizedTitle;
    if (existingFamily && familyHasApprovedVersion) {
      formFields.setConfirmedFamilyTitleKey("");
      formFields.setFamilyCollisionPrompt(null);
      setFormErrorMessage(
        `The estimate family "${existingFamily.title}" is locked because it already has an approved version. Use a new title or create a change order instead.`,
      );
      return;
    }
    // When title is locked (duplicate-as-new), skip the family collision prompt —
    // the user explicitly chose to create a new version in this family.
    if (existingFamily && formFields.titleLocked) {
      await submitNewEstimateWithTitle({
        projectId,
        title: trimmedTitle,
        allowExistingTitleFamily: true,
      });
      return;
    }
    if (existingFamily && formFields.confirmedFamilyTitleKey !== normalizedTitle) {
      if (promptMatchesCurrentTitle) {
        await submitNewEstimateWithTitle({
          projectId,
          title: trimmedTitle,
          allowExistingTitleFamily: true,
        });
        return;
      }
      const latest = existingFamily.items[existingFamily.items.length - 1];
      formFields.setFamilyCollisionPrompt({
        title: existingFamily.title,
        latestEstimateId: latest?.id ?? null,
        latestVersion: latest?.version ?? null,
        familySize: existingFamily.items.length,
      });
      setFormErrorMessage(
        `An estimate family named "${existingFamily.title}" already exists. Confirm to create a new version in that family.`,
      );
      return;
    }

    await submitNewEstimateWithTitle({
      projectId,
      title: trimmedTitle,
      allowExistingTitleFamily: Boolean(existingFamily),
    });
  }

  /** Duplicate the currently selected estimate into the create form. */
  function handleDuplicateSelectedEstimate() {
    if (!selectedEstimate) {
      setActionMessage("Select an estimate first.");
      return;
    }
    handleDuplicateAsNew(selectedEstimate);
  }

  /** Apply a status transition to the selected estimate. Returns the updated record on success, null on failure. */
  async function handleUpdateEstimateStatus(notifyCustomer = true): Promise<EstimateRecord | null> {
    const estimateId = Number(selectedEstimateId);
    if (!estimateId) {
      setActionMessage("Select an estimate first.");
      return null;
    }

    setActionMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/estimates/${estimateId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({ status: selectedStatus, status_note: statusNote, notify_customer: notifyCustomer }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setActionMessage(readEstimateApiError(payload, "Status update failed."));
        setActionTone("error");
        return null;
      }
      const updated = payload.data as EstimateRecord;
      const scrollY = window.scrollY;
      setEstimates((current) =>
        current.map((estimate) => {
          if (estimate.id === updated.id) return updated;
          return estimate;
        }),
      );
      requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
      setSelectedStatus("");
      setStatusNote("");
      await loadStatusEvents({ estimateId: updated.id, quiet: true });
      const label = `${updated.title || "Untitled"} v${updated.version}`;
      const emailNote = updated.status === "sent" && payload.email_sent ? " Email sent." : "";
      const actionFeedback: Record<string, string> = {
        sent: `Sent ${label}.${emailNote}`,
        approved: `Marked ${label} as approved.`,
        rejected: `Marked ${label} as rejected.`,
        void: `Voided ${label}.`,
      };
      setActionMessage(actionFeedback[updated.status] ?? `Updated ${label}.${emailNote}`);
      setActionTone("success");
      return updated;
    } catch {
      setActionMessage("Could not reach estimate status endpoint.");
      setActionTone("error");
      return null;
    }
  }

  /** Append a status note without changing the estimate's current status. */
  async function handleAddEstimateStatusNote() {
    const estimateId = Number(selectedEstimateId);
    if (!estimateId) {
      setActionMessage("Select an estimate first.");
      return;
    }
    if (!statusNote.trim()) {
      setActionMessage("Enter a status note first.");
      return;
    }

    setActionMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/estimates/${estimateId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({ status_note: statusNote }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setActionMessage(readEstimateApiError(payload, "Status note update failed."));
        setActionTone("error");
        return;
      }
      const updated = payload.data as EstimateRecord;
      const scrollY = window.scrollY;
      setEstimates((current) =>
        current.map((estimate) => (estimate.id === updated.id ? updated : estimate)),
      );
      requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
      setSelectedStatus("");
      setStatusNote("");
      await loadStatusEvents({ estimateId: updated.id, quiet: true });
      setActionMessage(`Added status note on ${updated.title || "Untitled"} v${updated.version}. History updated.`);
      setActionTone("success");
    } catch {
      setActionMessage("Could not reach estimate status note endpoint.");
      setActionTone("error");
    }
  }

  const loadStatusEvents = useCallback(
    async (options?: { estimateId?: number; quiet?: boolean }) => {
      const estimateId = options?.estimateId ?? Number(selectedEstimateId);
      const quiet = options?.quiet ?? false;
      if (!estimateId) {
        if (!quiet) {
          setActionMessage("Select an estimate first.");
        }
        return;
      }

      try {
        const response = await fetch(`${apiBaseUrl}/estimates/${estimateId}/status-events/`, {
          headers: buildAuthHeaders(authToken),
        });
        const payload: ApiResponse = await response.json();
        if (!response.ok) {
          if (!quiet) {
            setActionMessage(readEstimateApiError(payload, "Failed loading status events."));
          }
          return;
        }
        const rows = (payload.data as EstimateStatusEventRecord[]) ?? [];
        setStatusEvents(rows);
      } catch {
        if (!quiet) {
          setActionMessage("Could not reach status events endpoint.");
        }
      }
    },
    [apiBaseUrl, selectedEstimateId, authToken],
  );

  // Load status events whenever the selected estimate changes.
  useEffect(() => {
    if (!authToken || !selectedEstimateId) {
      return;
    }
    void loadStatusEvents({ quiet: true });
  }, [loadStatusEvents, selectedEstimateId, authToken]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <section className={styles.console}>
      <EstimatesViewerPanel
        selectedProject={selectedProject}
        isMobile={isMobile}
        isViewerExpanded={isViewerExpanded}
        setIsViewerExpanded={setIsViewerExpanded}
        viewerStatusOptions={viewerStatusOptions}
        estimateStatusFilters={estimateStatusFilters}
        toggleEstimateStatusFilter={toggleEstimateStatusFilter}
        estimateStatusCounts={estimateStatusCounts}
        setEstimateStatusFilters={setEstimateStatusFilters}
        estimateStatusFilterValues={estimateStatusFilterValues}
        defaultEstimateStatusFilters={defaultEstimateStatusFilters}
        visibleEstimateFamilies={visibleEstimateFamilies}
        estimateFamiliesLength={estimateFamilies.length}
        selectedEstimateId={selectedEstimateId}
        openFamilyHistory={openFamilyHistory}
        handleSelectFamilyLatest={handleSelectFamilyLatest}
        handleSelectEstimate={handleSelectEstimate}
        handleFamilyCardQuickAction={handleFamilyCardQuickAction}
        selectedProjectId={selectedProjectId}
        formatEstimateStatus={formatEstimateStatus}
        quickActionKindForStatus={quickActionKindForStatus}
        quickActionTitleForStatus={quickActionTitleForStatus}
        selectedEstimate={selectedEstimate}
        nextStatusOptions={nextStatusOptions}
        selectedStatus={selectedStatus}
        setSelectedStatus={setSelectedStatus}
        statusNote={statusNote}
        setStatusNote={setStatusNote}
        actionMessage={actionMessage}
        actionTone={actionTone}
        canSubmitStatusNote={canSubmitStatusNote}
        handleUpdateEstimateStatus={handleUpdateEstimateStatus}
        handleAddEstimateStatusNote={handleAddEstimateStatusNote}
        statusEvents={statusEvents}
        authToken={authToken}
        readOnly={!canMutateEstimates}
        onContractPdfUpdate={(newUrl) => {
          if (!selectedEstimate) return;
          const updated = { ...selectedEstimate, contract_pdf_url: newUrl };
          setEstimates((current) =>
            current.map((e) => (e.id === updated.id ? updated : e)),
          );
          void loadStatusEvents({ estimateId: selectedEstimate.id, quiet: true });
        }}
      />

      <EstimatesWorkspacePanel
        workspaceContextLabel={workspaceContextLabel}
        workspaceContext={workspaceContext}
        workspaceBadgeClass={workspaceBadgeClass}
        workspaceBadgeLabel={workspaceBadgeLabel}
        selectedEstimate={selectedEstimate}
        onStartNew={startNewEstimate}
        onDuplicateAsNew={handleDuplicateSelectedEstimate}
        actionMessage={actionMessage}
        actionTone={actionTone}
        titleLocked={formFields.titleLocked}
        duplicateHint={formFields.duplicateHint}
        selectedProject={selectedProject}
        familyCollisionPrompt={formFields.familyCollisionPrompt}
        estimateTitle={formFields.estimateTitle}
        selectedProjectId={selectedProjectId}
        onConfirmCollision={(projectId, title) => {
          formFields.setConfirmedFamilyTitleKey(normalizeFamilyTitle(title));
          formFields.setFamilyCollisionPrompt(null);
          void submitNewEstimateWithTitle({
            projectId,
            title,
            allowExistingTitleFamily: true,
          });
        }}
        onDismissCollision={() => {
          formFields.setConfirmedFamilyTitleKey("");
          formFields.setFamilyCollisionPrompt(null);
        }}
        canMutateEstimates={canMutateEstimates}
        role={role}
        estimateComposerRef={estimateComposerRef}
        sheetRef={sheetRef}
        organizationDefaults={organizationDefaults}
        estimateId={selectedEstimateId}
        estimateDate={formFields.estimateDate}
        validThrough={formFields.validThrough}
        termsText={formFields.termsText}
        notesText={formFields.notesText}
        taxPercent={formFields.taxPercent}
        lineItems={lineItems}
        lineTotals={lineTotals}
        subtotal={subtotal}
        taxAmount={taxAmount}
        totalAmount={totalAmount}
        costCodes={costCodes}
        canSubmit={canCreateEstimate}
        isSubmitting={formFields.isSubmitting}
        isEditingDraft={isEditingDraft}
        readOnly={isReadOnly}
        formErrorMessage={formErrorMessage}
        formSuccessMessage={formSuccessMessage}
        lineValidation={lineValidation}
        apiSections={selectedEstimate?.sections}
        onTitleChange={formFields.handleEstimateTitleChange}
        onValidThroughChange={formFields.setValidThrough}
        onTaxPercentChange={formFields.setTaxPercent}
        onNotesTextChange={formFields.setNotesText}
        onLineItemChange={updateLineItem}
        onAddLineItem={addLineItem}
        onRemoveLineItem={removeLineItem}
        onSubmit={handleCreateEstimate}
      />
    </section>
  );
}
