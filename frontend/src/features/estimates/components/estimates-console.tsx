"use client";

/**
 * Estimates console -- the primary internal workspace for managing estimates
 * within a project. Provides version-tree browsing, family-grouped estimate
 * history, draft creation/editing, status transitions, financial-baseline
 * activation, and duplication workflows.
 */

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultApiBaseUrl,
  fetchEstimatePolicyContract,
  normalizeApiBaseUrl,
} from "../api";
import { usePolicyContract } from "@/shared/hooks/use-policy-contract";
import { useStatusFilters } from "@/shared/hooks/use-status-filters";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import { canDo } from "../../session/rbac";
import creatorStyles from "@/shared/document-creator/creator-foundation.module.css";
import stampStyles from "@/shared/styles/decision-stamp.module.css";
import { usePrintable } from "@/shared/shell/printable-context";
import styles from "./estimates-console.module.css";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  formatDateInputFromIso,
  formatDateTimeDisplay,
  todayDateInput,
  addDaysToDateInput,
} from "@/shared/date-format";
import { formatDecimal } from "@/shared/money-format";
import { type FinancialBaselineStatusValue } from "@/shared/financial-baseline";
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
  emptyLine,
  estimateFinancialBaselineStatus,
  formatFinancialBaselineStatus,
  formatStatusAction,
  isNotatedStatusEvent,
  mapEstimateLineItemsToInputs,
  normalizeFamilyTitle,
  readEstimateApiError,
  resolveAutoSelectEstimate,
  resolveEstimateValidationDeltaDays,
} from "../helpers";
import { EstimateSheet, OrganizationDocumentDefaults } from "./estimate-sheet";
import { collapseToggleButtonStyles as collapseButtonStyles } from "@/shared/project-list-viewer";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type LineSortKey = "quantity" | "costCode" | "unitCost" | "markupPercent" | "amount";
type EstimateStatusValue = string;
type EstimateFamilyCollisionPrompt = {
  title: string;
  latestEstimateId: number | null;
  latestVersion: number | null;
  familySize: number | null;
};
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
  const { token, role, capabilities } = useSharedSessionAuth();
  const canMutateEstimates = canDo(capabilities, "estimates", "create");
  const canSendEstimates = canDo(capabilities, "estimates", "send");
  const canApproveEstimates = canDo(capabilities, "estimates", "approve");
  const [formErrorMessage, setFormErrorMessage] = useState("");
  const [formSuccessMessage, setFormSuccessMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionTone, setActionTone] = useState<"error" | "success" | "info">("info");


  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [organizationDefaults, setOrganizationDefaults] =
    useState<OrganizationDocumentDefaults | null>(null);

  const [estimates, setEstimates] = useState<EstimateRecord[]>([]);
  const [selectedEstimateId, setSelectedEstimateId] = useState("");

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const {
    statuses: estimateStatuses,
    statusLabels: estimateStatusLabels,
    allowedTransitions: estimateAllowedStatusTransitions,
    defaultCreateStatus,
  } = usePolicyContract<EstimatePolicyContract>({
    fetchContract: fetchEstimatePolicyContract,
    fallbackStatuses: ESTIMATE_STATUSES_FALLBACK,
    fallbackLabels: ESTIMATE_STATUS_LABELS_FALLBACK,
    fallbackTransitions: ESTIMATE_ALLOWED_STATUS_TRANSITIONS_FALLBACK,
    baseUrl: normalizedBaseUrl,
    token,
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

  const [estimateQuickActionByStatus, setEstimateQuickActionByStatus] = useState<
    Record<string, "change_order" | "revision">
  >(ESTIMATE_QUICK_ACTION_BY_STATUS_FALLBACK);
  const [selectedStatus, setSelectedStatus] = useState<EstimateStatusValue>("draft");
  const [statusNote, setStatusNote] = useState("");
  const [statusEvents, setStatusEvents] = useState<EstimateStatusEventRecord[]>([]);
  const [estimateTitle, setEstimateTitle] = useState("");
  const [familyCollisionPrompt, setFamilyCollisionPrompt] =
    useState<EstimateFamilyCollisionPrompt | null>(null);
  const [confirmedFamilyTitleKey, setConfirmedFamilyTitleKey] = useState("");
  const [termsText, setTermsText] = useState("");
  const [taxPercent, setTaxPercent] = useState("0");
  const [lineItems, setLineItems] = useState<EstimateLineInput[]>([emptyLine(1)]);
  const [lineSortKey, setLineSortKey] = useState<LineSortKey | null>(null);
  const [lineSortDirection, setLineSortDirection] = useState<"asc" | "desc">("asc");
  const [nextLineId, setNextLineId] = useState(2);
  const [estimateDate, setEstimateDate] = useState("");
  const [validThrough, setValidThrough] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitGuard = useRef(false);
  const selectedEstimateIdRef = useRef("");
  const [openFamilyHistory, setOpenFamilyHistory] = useState<Set<string>>(() => new Set());
  const duplicateDialogRef = useRef<HTMLDialogElement | null>(null);
  const [duplicateTitle, setDuplicateTitle] = useState("");
  const [isViewerExpanded, setIsViewerExpanded] = useState(true);
  const [hideSuperseded, setHideSuperseded] = useState(true);
  const [defaultEstimateStatusFilters, setDefaultEstimateStatusFilters] = useState<string[]>(
    ESTIMATE_DEFAULT_STATUS_FILTERS_FALLBACK,
  );
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
  const estimateComposerRef = useRef<HTMLDivElement | null>(null);
  const [creatorFlashCount, setCreatorFlashCount] = useState(0);
  const { setPrintable } = usePrintable();

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  useEffect(() => {
    setPrintable(!!selectedEstimateId);
    return () => setPrintable(false);
  }, [selectedEstimateId, setPrintable]);

  useEffect(() => {
    if (creatorFlashCount === 0) return;
    const el = estimateComposerRef.current;
    if (!el) return;
    el.classList.remove(creatorStyles.sheetFlash);
    void el.offsetWidth;
    el.classList.add(creatorStyles.sheetFlash);
    const cleanup = () => el.classList.remove(creatorStyles.sheetFlash);
    el.addEventListener("animationend", cleanup, { once: true });
    return () => el.removeEventListener("animationend", cleanup);
  }, [creatorFlashCount]);

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
  const activeFinancialEstimate =
    estimates.find((estimate) => estimate.is_active_financial_baseline) ?? null;
  const isEditingDraft = Boolean(selectedEstimate && selectedEstimate.status === "draft");
  const isReadOnly = !canMutateEstimates || Boolean(selectedEstimate && selectedEstimate.status !== "draft");
  const statusClasses: Record<string, string> = {
    draft: styles.statusDraft,
    sent: styles.statusSent,
    approved: styles.statusApproved,
    rejected: styles.statusRejected,
    void: styles.statusArchived,
    archived: styles.statusArchived,
  };
  const financialBaselineClasses: Record<FinancialBaselineStatusValue, string> = {
    none: styles.financialBaselineNone,
    active: styles.financialBaselineActive,
    superseded: styles.financialBaselineSuperseded,
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
  const statusDisplayOptions = statusOptions;
  const statusLabelByValue = statusDisplayOptions.reduce<Record<string, string>>((labels, option) => {
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
  const selectedFinancialBaselineStatus = estimateFinancialBaselineStatus(selectedEstimate);
  const canActivateSelectedFinancialBaseline = Boolean(
    selectedEstimate &&
      selectedEstimate.status === "approved" &&
      selectedFinancialBaselineStatus !== "active",
  );
  const workspaceContext = selectedEstimate
    ? `${selectedEstimate.title || "Untitled"} · #${selectedEstimate.id} v${selectedEstimate.version}`
    : "New estimate draft";
  const workspaceContextLabel = !selectedEstimate
    ? "Creating"
    : isEditingDraft
      ? "Editing"
      : "Viewing";
  const workspaceBadgeLabel = !selectedEstimate
    ? "CREATING"
    : isEditingDraft
      ? "EDITING"
      : "READ-ONLY";
  const workspaceBadgeClass = !selectedEstimate
    ? styles.statusDraft
    : isEditingDraft
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

  function formatEventDate(dateValue: string): string {
    return formatDateTimeDisplay(dateValue, dateValue);
  }

  function formatEstimateLastActionDate(estimate: EstimateRecord): string {
    return formatEventDate(estimate.updated_at || estimate.created_at);
  }

  function toNumber(value: string): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /** Determine the quick-action kind for a given estimate status (CO link or revision clone). */
  function quickActionKindForStatus(status: string): "change_order" | "revision" | null {
    return estimateQuickActionByStatus[status] ?? null;
  }

  function quickActionTitleForStatus(status: string): string {
    const kind = quickActionKindForStatus(status);
    if (kind === "change_order") {
      return "Open linked change orders for this estimate";
    }
    if (kind === "revision") {
      return "Duplicate this estimate as a new revision";
    }
    return "";
  }

  // -------------------------------------------------------------------------
  // Data loading & form hydration
  // -------------------------------------------------------------------------

  /** Clone an existing estimate as a new revision in its family. */
  async function cloneEstimateRevision(sourceEstimate: EstimateRecord) {
    const sourceWasSent = sourceEstimate.status === "sent";
    setActionMessage("Cloning estimate version...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/estimates/${sourceEstimate.id}/clone-version/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({}),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setActionMessage(readEstimateApiError(payload, "Clone failed."));
        return;
      }
      const cloned = payload.data as EstimateRecord;
      setEstimates((current) => {
        const updated = current.map((estimate) =>
          sourceWasSent && estimate.id === sourceEstimate.id
            ? { ...estimate, status: "rejected" }
            : estimate,
        );
        return [cloned, ...updated];
      });
      handleSelectEstimate(cloned);
      setStatusEvents([]);
      setActionMessage("");
    } catch {
      setActionMessage("Could not reach clone endpoint.");
    }
  }

  /** Route the quick-action click for a family card to CO navigation or revision clone. */
  async function handleFamilyCardQuickAction(sourceEstimate: EstimateRecord) {
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
    await cloneEstimateRevision(sourceEstimate);
  }

  const lineTotals = useMemo(
    () =>
      lineItems.map((line) => {
        const quantity = toNumber(line.quantity);
        const unitCost = toNumber(line.unitCost);
        const markup = toNumber(line.markupPercent);
        const base = quantity * unitCost;
        return base + base * (markup / 100);
      }),
    [lineItems],
  );

  const subtotal = lineTotals.reduce((sum, value) => sum + value, 0);
  const taxRate = toNumber(taxPercent);
  const taxAmount = subtotal * (taxRate / 100);
  const totalAmount = subtotal + taxAmount;
  const estimateFamilies = useMemo(() => {
    const families = new Map<string, EstimateRecord[]>();
    for (const estimate of estimates) {
      const title = (estimate.title || "").trim() || "Untitled";
      const existing = families.get(title);
      if (existing) {
        existing.push(estimate);
      } else {
        families.set(title, [estimate]);
      }
    }
    return Array.from(families.entries())
      .map(([title, items]) => ({
        title,
        items: [...items].sort((a, b) => a.version - b.version),
      }))
      .sort((a, b) => {
        const latestA = a.items[a.items.length - 1];
        const latestB = b.items[b.items.length - 1];
        const lastActionA = new Date(latestA?.updated_at || latestA?.created_at || 0).getTime();
        const lastActionB = new Date(latestB?.updated_at || latestB?.created_at || 0).getTime();
        return lastActionB - lastActionA;
      });
  }, [estimates]);
  const estimateStatusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const family of estimateFamilies) {
      const latest = family.items[family.items.length - 1];
      if (latest?.status) {
        counts[latest.status] = (counts[latest.status] || 0) + 1;
      }
    }
    return counts;
  }, [estimateFamilies]);

  const visibleEstimateFamilies = useMemo(() => {
    if (estimateStatusFilters.length === 0) {
      return [];
    }
    return estimateFamilies.filter((family) => {
      const latest = family.items[family.items.length - 1];
      if (!latest?.status) {
        return false;
      }
      if (hideSuperseded && latest.financial_baseline_status === "superseded") {
        return false;
      }
      return estimateStatusFilters.includes(latest.status as EstimateStatusValue);
    });
  }, [estimateFamilies, estimateStatusFilters, hideSuperseded]);

  function publicEstimateHref(publicRef?: string): string {
    if (!publicRef) {
      return "";
    }
    return `/estimate/${publicRef}`;
  }

  const loadEstimateIntoForm = useCallback((estimate: EstimateRecord) => {
    const estimateTerms = (estimate.terms_text || "").trim();
    setEstimateTitle(estimate.title || "Untitled");
    setTermsText(estimateTerms || organizationDefaults?.estimate_terms_and_conditions || "");
    setTaxPercent(String(estimate.tax_percent ?? "0"));
    setValidThrough(estimate.valid_through ?? "");
    const mapped = mapEstimateLineItemsToInputs(estimate.line_items ?? []);
    setLineItems(mapped);
    setNextLineId(mapped.length + 1);
    const createdDate = formatDateInputFromIso(estimate.created_at);
    if (createdDate) {
      setEstimateDate(createdDate);
    }
  }, [organizationDefaults?.estimate_terms_and_conditions]);

  const handleSelectEstimate = useCallback((estimate: EstimateRecord) => {
    const nextEstimateId = String(estimate.id);
    const isSameEstimate = nextEstimateId === selectedEstimateIdRef.current;
    setSelectedEstimateId(nextEstimateId);
    setSelectedStatus("");
    if (!isSameEstimate) {
      setStatusEvents([]);
    }
    setLineSortKey(null);
    setLineSortDirection("asc");
    setFormErrorMessage("");
    setFormSuccessMessage("");
    setActionMessage("");
    setFamilyCollisionPrompt(null);
    setConfirmedFamilyTitleKey("");
    loadEstimateIntoForm(estimate);
    setDuplicateTitle(`${estimate.title || "Estimate"} Copy`);
  }, [estimateAllowedStatusTransitions, loadEstimateIntoForm]);

  // Keep the ref in sync so async callbacks always see the latest selection.
  useEffect(() => {
    selectedEstimateIdRef.current = selectedEstimateId;
  }, [selectedEstimateId]);

  // Keep the ref in sync so filter-aware data loads use the latest value.
  useEffect(() => {
    estimateStatusFiltersRef.current = estimateStatusFilters;
  }, [estimateStatusFilters]);


  const clearSelectedEstimateState = useCallback(() => {
    const defaultCostCodeId = costCodes[0] ? String(costCodes[0].id) : "";
    const nextEstimateDate = todayDateInput();
    const nextValidThrough = addDaysToDateInput(
      nextEstimateDate,
      resolveEstimateValidationDeltaDays(organizationDefaults),
    );
    setSelectedEstimateId("");
    selectedEstimateIdRef.current = "";
    setSelectedStatus("");
    setStatusNote("");
    setStatusEvents([]);
    setEstimateTitle("");
    setFamilyCollisionPrompt(null);
    setConfirmedFamilyTitleKey("");
    setTermsText(organizationDefaults?.estimate_terms_and_conditions || "");
    setTaxPercent("0");
    setLineItems([emptyLine(1, defaultCostCodeId)]);
    setLineSortKey(null);
    setLineSortDirection("asc");
    setNextLineId(2);
    setEstimateDate(nextEstimateDate);
    setValidThrough(nextValidThrough);
    duplicateDialogRef.current?.close();
  }, [
    costCodes,
    defaultCreateStatus,
    organizationDefaults,
  ]);

  /** Reset the composer to a blank draft. */
  function startNewEstimate() {
    clearSelectedEstimateState();
    setActionMessage("");
    setFormErrorMessage("");
    setFormSuccessMessage("");
    setCreatorFlashCount((c) => c + 1);
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


  /** Update the title and clear stale family-collision prompts when the title diverges. */
  function handleEstimateTitleChange(value: string) {
    setEstimateTitle(value);
    const nextKey = normalizeFamilyTitle(value);
    if (confirmedFamilyTitleKey && confirmedFamilyTitleKey !== nextKey) {
      setConfirmedFamilyTitleKey("");
    }
    if (familyCollisionPrompt && normalizeFamilyTitle(familyCollisionPrompt.title) !== nextKey) {
      setFamilyCollisionPrompt(null);
    }
  }

  // Seed the estimate date and valid-through defaults on first render.
  useEffect(() => {
    if (estimateDate) {
      return;
    }
    const nextEstimateDate = todayDateInput();
    setEstimateDate(nextEstimateDate);
    if (!selectedEstimateIdRef.current && !validThrough) {
      setValidThrough(
        addDaysToDateInput(
          nextEstimateDate,
          resolveEstimateValidationDeltaDays(organizationDefaults),
        ),
      );
    }
  }, [estimateDate, organizationDefaults, validThrough]);

  const loadDependencies = useCallback(async () => {
    setActionMessage("");
    try {
      const [projectsRes, codesRes, organizationRes] = await Promise.all([
        fetch(`${normalizedBaseUrl}/projects/`, {
          headers: buildAuthHeaders(token),
        }),
        fetch(`${normalizedBaseUrl}/cost-codes/`, {
          headers: buildAuthHeaders(token),
        }),
        fetch(`${normalizedBaseUrl}/organization/`, {
          headers: buildAuthHeaders(token),
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
        setTermsText((current) => current || organizationData.estimate_terms_and_conditions || "");
        setValidThrough((current) => {
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

      if (codeRows[0]) {
        const defaultCostCodeId = String(codeRows[0].id);
        setLineItems((current) =>
          current.map((line) =>
            line.costCodeId ? line : { ...line, costCodeId: defaultCostCodeId },
          ),
        );
      }

    } catch {
      setActionMessage("Could not reach project and cost-code endpoints.");
    }
  }, [normalizedBaseUrl, scopedProjectId, token]);

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
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/estimates/`, {
        headers: buildAuthHeaders(token),
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
    normalizedBaseUrl,
    scopedEstimateId,
    selectedProjectId,
    token,
  ]);

  // Fetch projects, cost codes, and organization defaults on auth.
  useEffect(() => {
    if (!token) {
      return;
    }
    void loadDependencies();
  }, [loadDependencies, token]);

  // Reload estimates when the selected project changes.
  useEffect(() => {
    if (!token || !selectedProjectId) {
      return;
    }
    void loadEstimates();
  }, [loadEstimates, selectedProjectId, token]);

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
    if (formErrorMessage === ESTIMATE_MIN_LINE_ITEMS_ERROR) {
      setFormErrorMessage("");
    }
    const defaultCostCodeId = costCodes[0] ? String(costCodes[0].id) : "";
    setLineItems((current) => [...current, emptyLine(nextLineId, defaultCostCodeId)]);
    setNextLineId((value) => value + 1);
  }

  function duplicateLineItem(localId: number) {
    if (formErrorMessage === ESTIMATE_MIN_LINE_ITEMS_ERROR) {
      setFormErrorMessage("");
    }
    const target = lineItems.find((line) => line.localId === localId);
    if (!target) {
      return;
    }
    setLineItems((current) => [...current, { ...target, localId: nextLineId }]);
    setNextLineId((value) => value + 1);
  }

  function moveLineItem(localId: number, direction: "up" | "down") {
    setLineItems((current) => {
      const index = current.findIndex((line) => line.localId === localId);
      if (index === -1) {
        return current;
      }
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
    setLineSortKey(null);
    setLineSortDirection("asc");
  }

  function removeLineItem(localId: number) {
    if (lineItems.length <= 1) {
      setFormErrorMessage(ESTIMATE_MIN_LINE_ITEMS_ERROR);
      setFormSuccessMessage("");
        return;
    }
    setLineItems((current) => {
      return current.filter((line) => line.localId !== localId);
    });
  }

  function updateLineItem(
    localId: number,
    key: keyof Omit<EstimateLineInput, "localId">,
    value: string,
  ) {
    setFormErrorMessage("");
    setFormSuccessMessage("");
    setLineItems((current) =>
      current.map((line) => (line.localId === localId ? { ...line, [key]: value } : line)),
    );
  }

  /** Sort line items by the given column key, toggling direction on repeat clicks. */
  function handleSortLineItems(key: LineSortKey) {
    if (isReadOnly) {
      return;
    }
    const nextDirection = lineSortKey === key && lineSortDirection === "asc" ? "desc" : "asc";
    const directionFactor = nextDirection === "asc" ? 1 : -1;

    function lineAmount(line: EstimateLineInput): number {
      const quantity = toNumber(line.quantity);
      const unitCost = toNumber(line.unitCost);
      const markup = toNumber(line.markupPercent);
      const base = quantity * unitCost;
      return base + base * (markup / 100);
    }

    function costCodeLabel(line: EstimateLineInput): string {
      const code = costCodes.find((candidate) => String(candidate.id) === line.costCodeId);
      if (!code) {
        return "";
      }
      return `${code.code} ${code.name}`.toLowerCase();
    }

    setLineItems((current) => {
      const sorted = [...current].sort((a, b) => {
        switch (key) {
          case "quantity":
            return (toNumber(a.quantity) - toNumber(b.quantity)) * directionFactor;
          case "unitCost":
            return (toNumber(a.unitCost) - toNumber(b.unitCost)) * directionFactor;
          case "markupPercent":
            return (toNumber(a.markupPercent) - toNumber(b.markupPercent)) * directionFactor;
          case "amount":
            return (lineAmount(a) - lineAmount(b)) * directionFactor;
          case "costCode":
            return costCodeLabel(a).localeCompare(costCodeLabel(b)) * directionFactor;
          default:
            return 0;
        }
      });
      return sorted;
    });
    setLineSortKey(key);
    setLineSortDirection(nextDirection);
  }

  const canCreateEstimate = useMemo(
    () => canMutateEstimates && Boolean(selectedProjectId) && lineItems.length > 0,
    [canMutateEstimates, lineItems.length, selectedProjectId],
  );

  // -------------------------------------------------------------------------
  // Submit & mutation handlers
  // -------------------------------------------------------------------------

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
    submitGuard.current = true;
    setIsSubmitting(true);
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/estimates/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          title,
          allow_existing_title_family: allowExistingTitleFamily,
          valid_through: validThrough || null,
          tax_percent: taxPercent,
          line_items: lineItems.map((line) => ({
            cost_code: Number(line.costCodeId),
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            unit_cost: line.unitCost,
            markup_percent: line.markupPercent,
          })),
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        if (response.status === 409 && payload.error?.code === "estimate_family_exists") {
          const conflictMeta = payload.error?.meta ?? {};
          setFamilyCollisionPrompt({
            title,
            latestEstimateId:
              typeof conflictMeta.latest_estimate_id === "number"
                ? conflictMeta.latest_estimate_id
                : null,
            latestVersion:
              typeof conflictMeta.latest_version === "number" ? conflictMeta.latest_version : null,
            familySize: typeof conflictMeta.family_size === "number" ? conflictMeta.family_size : null,
          });
          setConfirmedFamilyTitleKey("");
        } else if (
          response.status === 409 &&
          payload.error?.code === "estimate_family_approved_locked"
        ) {
          setFamilyCollisionPrompt(null);
          setConfirmedFamilyTitleKey("");
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
      setFormSuccessMessage(`Created estimate #${created.id} v${created.version}.`);
        loadEstimateIntoForm(created);
      setFamilyCollisionPrompt(null);
      setConfirmedFamilyTitleKey("");
      setCreatorFlashCount((c) => c + 1);
    } catch {
      setFormErrorMessage("Could not reach estimate create endpoint.");
    } finally {
      submitGuard.current = false;
      setIsSubmitting(false);
    }
  }

  /** Handle form submission for creating a new estimate or saving a draft. */
  async function handleCreateEstimate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormErrorMessage("");
    setFormSuccessMessage("");
    if (submitGuard.current) {
      return;
    }
    if (!canMutateEstimates) {
      setFormErrorMessage(`Role ${role} is read-only for estimate mutations.`);
      return;
    }
    if (isReadOnly) {
      setFormErrorMessage("This estimate is read-only. Clone or add a new draft to edit.");
      return;
    }
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setFormErrorMessage("Select a project first.");
      return;
    }

    const trimmedTitle = estimateTitle.trim();
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
      submitGuard.current = true;
      setIsSubmitting(true);
      try {
        const response = await fetch(`${normalizedBaseUrl}/estimates/${selectedEstimate.id}/`, {
          method: "PATCH",
          headers: buildAuthHeaders(token, { contentType: "application/json" }),
          body: JSON.stringify({
            title: trimmedTitle,
            valid_through: validThrough || null,
            tax_percent: taxPercent,
            line_items: lineItems.map((line) => ({
              cost_code: Number(line.costCodeId),
              description: line.description,
              quantity: line.quantity,
              unit: line.unit,
              unit_cost: line.unitCost,
              markup_percent: line.markupPercent,
            })),
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
        setFormSuccessMessage(`Saved draft estimate #${updated.id}.`);
        setCreatorFlashCount((c) => c + 1);
      } catch {
        setFormErrorMessage("Could not reach estimate update endpoint.");
      } finally {
        submitGuard.current = false;
        setIsSubmitting(false);
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
      familyCollisionPrompt &&
      normalizeFamilyTitle(familyCollisionPrompt.title) === normalizedTitle;
    if (existingFamily && familyHasApprovedVersion) {
      setConfirmedFamilyTitleKey("");
      setFamilyCollisionPrompt(null);
      setFormErrorMessage(
        `The estimate family "${existingFamily.title}" is locked because it already has an approved version. Use a new title or create a change order instead.`,
      );
      return;
    }
    if (existingFamily && confirmedFamilyTitleKey !== normalizedTitle) {
      if (promptMatchesCurrentTitle) {
        await submitNewEstimateWithTitle({
          projectId,
          title: trimmedTitle,
          allowExistingTitleFamily: true,
        });
        return;
      }
      const latest = existingFamily.items[existingFamily.items.length - 1];
      setFamilyCollisionPrompt({
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

  /** Duplicate the selected estimate as a new standalone estimate with a custom title. */
  async function handleDuplicateEstimate() {
    const estimateId = Number(selectedEstimateId);
    if (!estimateId) {
      setActionMessage("Select an existing estimate version before duplicating.");
      return;
    }
    if (!duplicateTitle.trim()) {
      setActionMessage("Duplicate title is required.");
      return;
    }

    setActionMessage("");
    try {
      const response = await fetch(`${normalizedBaseUrl}/estimates/${estimateId}/duplicate/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          title: duplicateTitle.trim(),
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setActionMessage(readEstimateApiError(payload, "Duplicate failed."));
        return;
      }
      const duplicated = payload.data as EstimateRecord;
      if (String(duplicated.project) === selectedProjectId) {
        setEstimates((current) => [duplicated, ...current]);
      }
      if (String(duplicated.project) !== selectedProjectId) {
        setSelectedProjectId(String(duplicated.project));
      }
      handleSelectEstimate(duplicated);
      const duplicatedFamilyTitle = (duplicated.title || "").trim() || "Untitled";
      setOpenFamilyHistory(new Set<string>([duplicatedFamilyTitle]));
      duplicateDialogRef.current?.close();
      setStatusEvents([]);
      setActionMessage(`Duplicated as ${duplicated.title || "Untitled"} v${duplicated.version}.`);
      setActionTone("success");
      setCreatorFlashCount((c) => c + 1);
    } catch {
      setActionMessage("Could not reach duplicate endpoint.");
    }
  }

  /** Apply a status transition to the selected estimate. */
  async function handleUpdateEstimateStatus() {
    const estimateId = Number(selectedEstimateId);
    if (!estimateId) {
      setActionMessage("Select an estimate first.");
      return;
    }

    setActionMessage("");
    try {
      const response = await fetch(`${normalizedBaseUrl}/estimates/${estimateId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({ status: selectedStatus, status_note: statusNote }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setActionMessage(readEstimateApiError(payload, "Status update failed."));
        setActionTone("error");
        return;
      }
      const updated = payload.data as EstimateRecord;
      const scrollY = window.scrollY;
      const conversionStatus = payload.meta?.conversion_status;
      const didSupersede = conversionStatus === "superseded_and_converted";
      setEstimates((current) =>
        current.map((estimate) => {
          if (estimate.id === updated.id) return updated;
          if (didSupersede && estimate.is_active_financial_baseline) {
            return { ...estimate, is_active_financial_baseline: false, financial_baseline_status: "superseded" as const };
          }
          return estimate;
        }),
      );
      requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
      setSelectedStatus("");
      setStatusNote("");
      await loadStatusEvents({ estimateId: updated.id, quiet: true });
      if (conversionStatus === "converted" || didSupersede || conversionStatus === "already_converted") {
        setActionMessage("Estimate approved and set as the active estimate. History updated.");
        setActionTone("success");
        return;
      }
      setActionMessage(`Updated estimate #${updated.id} to ${updated.status.replace(/_/g, " ")}. History updated.`);
      setActionTone("success");
    } catch {
      setActionMessage("Could not reach estimate status endpoint.");
      setActionTone("error");
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
      const response = await fetch(`${normalizedBaseUrl}/estimates/${estimateId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
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
      setActionMessage(`Added status note on estimate #${updated.id}. History updated.`);
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
        const response = await fetch(`${normalizedBaseUrl}/estimates/${estimateId}/status-events/`, {
          headers: buildAuthHeaders(token),
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
    [normalizedBaseUrl, selectedEstimateId, token],
  );

  // Load status events whenever the selected estimate changes.
  useEffect(() => {
    if (!token || !selectedEstimateId) {
      return;
    }
    void loadStatusEvents({ quiet: true });
  }, [loadStatusEvents, selectedEstimateId, token]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <section className={styles.console}>
      <section className={styles.lifecycle}>
        <div className={styles.lifecycleHeader}>
          <h3>
            {selectedProject
              ? `Estimates for: ${selectedProject.name}`
              : "Estimates"}
          </h3>
          <button
            type="button"
            className={collapseButtonStyles.collapseButton}
            onClick={() => setIsViewerExpanded((current) => !current)}
            aria-expanded={isViewerExpanded}
          >
            {isViewerExpanded ? "Collapse" : "Expand"}
          </button>
        </div>

        {isViewerExpanded ? (
          <>
            <div className={styles.versionFilters}>
              <span className={styles.versionFiltersLabel}>Estimate status filter</span>
              <div className={styles.versionFilterButtons}>
                {viewerStatusOptions.map((option) => {
                  const active = estimateStatusFilters.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`${styles.statusPill} ${
                        active ? statusClasses[option.value] : styles.statusPillInactive
                      } ${active ? styles.statusPillActive : ""}`}
                      aria-pressed={active}
                      onClick={() => toggleEstimateStatusFilter(option.value)}
                    >
                      <span>{option.label}</span>
                      <span className={styles.statusPillCount}>{estimateStatusCounts[option.value] ?? 0}</span>
                    </button>
                  );
                })}
              </div>
              <div className={styles.versionFilterActions}>
                <button
                  type="button"
                  className={styles.versionFilterActionButton}
                  onClick={() => setEstimateStatusFilters(estimateStatusFilterValues)}
                >
                  Show All Statuses
                </button>
                <button
                  type="button"
                  className={styles.versionFilterActionButton}
                  onClick={() => setEstimateStatusFilters(defaultEstimateStatusFilters)}
                >
                  Reset Filters
                </button>
                <button
                  type="button"
                  className={`${styles.versionFilterActionButton} ${!hideSuperseded ? styles.versionFilterActionButtonActive : ""}`}
                  aria-pressed={!hideSuperseded}
                  onClick={() => setHideSuperseded((current) => !current)}
                >
                  {hideSuperseded ? "Show Superseded" : "Hide Superseded"}
                </button>
              </div>
            </div>

            <div className={styles.versionTree}>
              {activeFinancialEstimate ? (
                <div className={styles.versionBaselineBanner}>
                  <div className={styles.versionBaselineCopy}>
                    <span className={styles.versionBaselineLabel}>Active Estimate</span>
                    <span className={styles.versionBaselineValue}>
                      Estimate #{activeFinancialEstimate.id} · v{activeFinancialEstimate.version} ·{" "}
                      {activeFinancialEstimate.title || "Untitled"}
                    </span>
                  </div>
                  <div className={styles.versionBaselineActions}>
                    {String(activeFinancialEstimate.id) === selectedEstimateId ? (
                      <span className={styles.versionBaselineSelected}>Viewing active estimate</span>
                    ) : (
                      <button
                        type="button"
                        className={styles.versionBaselineJumpButton}
                        onClick={() => {
                          handleSelectEstimate(activeFinancialEstimate);
                          const title = (activeFinancialEstimate.title || "").trim() || "Untitled";
                          requestAnimationFrame(() => {
                            document
                              .querySelector(`[data-family-title="${CSS.escape(title)}"]`)
                              ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                          });
                        }}
                      >
                        Jump to Active Estimate
                      </button>
                    )}
                  </div>
                </div>
              ) : null}
              {visibleEstimateFamilies.length > 0 ? (
                visibleEstimateFamilies.map((family) => {
                  const latest = family.items[family.items.length - 1];
                  const history = family.items.slice(0, -1).reverse();
                  const selectedInFamily = family.items.find(
                    (estimate) => String(estimate.id) === selectedEstimateId,
                  );
                  const isFamilyActive = Boolean(selectedInFamily);
                  const isViewingHistory =
                    selectedInFamily && String(selectedInFamily.id) !== String(latest.id);
                  const isLatestSelected = String(latest.id) === selectedEstimateId;
                  const isHistoryOpen = openFamilyHistory.has(family.title);
                  const quickActionKind = quickActionKindForStatus(latest.status);
                  const quickActionTitle = quickActionTitleForStatus(latest.status);
                  const latestTotal = formatDecimal(toNumber(latest.grand_total || "0"));
                  const latestFinancialBaselineStatus = estimateFinancialBaselineStatus(latest);
                  return (
                    <div
                      key={family.title}
                      data-family-title={family.title}
                      className={`${styles.familyGroup} ${
                        isFamilyActive ? styles.familyGroupActive : ""
                      }`}
                    >
                      <div className={styles.familyRow}>
                        <div className={styles.familyMainColumn}>
                          <div
                            role="button"
                            tabIndex={0}
                            className={`${styles.familyMain} ${
                              isLatestSelected ? styles.familyMainActive : ""
                            }`}
                            onClick={() => handleSelectFamilyLatest(family.title, latest)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSelectFamilyLatest(family.title, latest); } }}
                          >
                            {(!isViewingHistory && latest.public_ref) || (quickActionKind === "change_order" && selectedProjectId) ? (
                              <div className={styles.familyPublicBar}>
                                {quickActionKind === "change_order" && selectedProjectId ? (
                                  <Link
                                    href={`/projects/${selectedProjectId}/change-orders?origin_estimate=${latest.id}`}
                                    className={styles.familyPublicLink}
                                    aria-label={`${quickActionTitle} (estimate #${latest.id})`}
                                    title={quickActionTitle}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    To CO&apos;s ↗
                                  </Link>
                                ) : null}
                                {!isViewingHistory && latest.public_ref ? (
                                  <Link
                                    href={publicEstimateHref(latest.public_ref)}
                                    className={`${styles.familyPublicLink} ${styles.familyPublicBarEnd}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`Open customer view for estimate #${latest.id}`}
                                    title="Open customer view"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    Customer View ↗
                                  </Link>
                                ) : null}
                              </div>
                            ) : null}
                            <div className={styles.familyMainContent}>
                              <span className={styles.familyTitle}>{family.title}</span>
                              <span className={styles.familyMeta}>
                                ${latestTotal} · Estimate #{latest.id} · {history.length} history{" "}
                                {history.length === 1 ? "entry" : "entries"}
                              </span>
                              <span className={styles.familyDate}>
                                Last action: {formatEstimateLastActionDate(latest)}
                              </span>
                            </div>
                            <div className={styles.versionRight}>
                              <span
                                className={`${styles.versionStatus} ${
                                  statusClasses[latest.status] ?? ""
                                }`}
                              >
                                {formatEstimateStatus(latest.status)}
                              </span>
                              {latestFinancialBaselineStatus !== "none" ? (
                                <span
                                  className={`${styles.financialBaselineBadge} ${
                                    financialBaselineClasses[latestFinancialBaselineStatus]
                                  }`}
                                >
                                  {formatFinancialBaselineStatus(latestFinancialBaselineStatus)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          {isViewingHistory || quickActionKind === "revision" ? (
                            <div className={styles.familyFooter}>
                              {isViewingHistory ? (
                                <span className={styles.historyNotice}>
                                  Viewing v{selectedInFamily?.version}
                                </span>
                              ) : null}
                              {quickActionKind === "revision" ? (
                                <button
                                  type="button"
                                  className={styles.familyActionButton}
                                  aria-label={`${quickActionTitle} (estimate #${latest.id})`}
                                  title={quickActionTitle}
                                  onClick={() => void handleFamilyCardQuickAction(latest)}
                                >
                                  New Revision
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        {isHistoryOpen && history.length > 0 ? (
                          <div className={styles.historyRow}>
                            {history.map((estimate) => {
                                const total = formatDecimal(toNumber(estimate.grand_total || "0"));
                                const isSelected = String(estimate.id) === selectedEstimateId;
                                const financialBaselineStatus =
                                  estimateFinancialBaselineStatus(estimate);
                                return (
                                  <div key={estimate.id} className={styles.historyCardColumn}>
                                    <button
                                      type="button"
                                      className={`${styles.historyCard} ${
                                        isSelected ? styles.historyCardActive : ""
                                      }`}
                                      onClick={() => handleSelectEstimate(estimate)}
                                    >
                                      <span className={styles.historyMetaRow}>
                                        <span className={styles.historyVersionMeta}>
                                          v{estimate.version} <span className={styles.historyMeta}>#{estimate.id}</span>
                                        </span>
                                        <span
                                          className={`${styles.versionStatus} ${
                                            statusClasses[estimate.status] ?? ""
                                          } ${styles.historyStatus}`}
                                        >
                                          {formatEstimateStatus(estimate.status)}
                                        </span>
                                      </span>
                                      {financialBaselineStatus !== "none" ? (
                                        <span
                                          className={`${styles.financialBaselineBadge} ${
                                            financialBaselineClasses[financialBaselineStatus]
                                          } ${styles.historyFinancialBaselineBadge}`}
                                        >
                                          {formatFinancialBaselineStatus(financialBaselineStatus)}
                                        </span>
                                      ) : null}
                                      <span className={styles.historyAmount}>${total}</span>
                                      <span className={styles.historyDate}>
                                        {formatEstimateLastActionDate(estimate)}
                                      </span>
                                    </button>
                                    {isSelected && estimate.public_ref ? (
                                      <Link
                                        href={publicEstimateHref(estimate.public_ref)}
                                        className={styles.historyPublicLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        aria-label={`Open customer view for estimate #${estimate.id}`}
                                        title="Open customer view"
                                      >
                                        Customer View ↗
                                      </Link>
                                    ) : null}
                                  </div>
                                );
                              })}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              ) : estimateFamilies.length > 0 ? (
                <p className={styles.inlineHint}>No estimate families match the selected status filters.</p>
              ) : (
                <p className={styles.inlineHint}>No estimates yet. Use the workspace above to create one.</p>
              )}
            </div>

            {selectedEstimateId ? (
              <>
                {canActivateSelectedFinancialBaseline ? (
                  <div className={styles.financialActivationPanel}>
                    <span className={styles.financialActivationLabel}>Active Estimate</span>
                    <p className={styles.financialActivationHint}>
                      {selectedFinancialBaselineStatus === "superseded"
                        ? "This estimate was previously active and is now superseded."
                        : "This approved estimate is not currently the active estimate for this project."}{" "}
                      {activeFinancialEstimate
                        ? `Current active estimate: #${activeFinancialEstimate.id} v${activeFinancialEstimate.version}.`
                        : "No active estimate is currently set."}
                    </p>
                    <button
                      type="button"
                      className={styles.financialActivationButton}
                      onClick={() => {
                        setActionMessage("Active estimate activation is not yet available.");
                        setActionTone("info");
                      }}
                    >
                      Set as Active Estimate
                    </button>
                  </div>
                ) : null}
                <div className={styles.lifecycleGrid}>
                  {!isTerminalEstimateStatus ? (
                    <div className={styles.statusPicker}>
                      <span className={styles.lifecycleFieldLabel}>Next status</span>
                      <div className={styles.statusPills}>
                        {nextStatusOptions.map((option) => {
                          const isSelected = selectedStatus === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              className={`${styles.statusPill} ${
                                isSelected ? statusClasses[option.value] ?? "" : styles.statusPillInactive
                              } ${isSelected ? styles.statusPillActive : ""}`}
                              onClick={() => setSelectedStatus(option.value)}
                              aria-pressed={isSelected}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                      {nextStatusOptions.length === 0 ? (
                        <p className={styles.inlineHint}>No next statuses available for this estimate.</p>
                      ) : null}
                    </div>
                  ) : null}
                  <label className={styles.lifecycleField}>
                    Status note
                    <textarea
                      className={styles.statusNote}
                      value={statusNote}
                      onChange={(event) => setStatusNote(event.target.value)}
                      placeholder={
                        isTerminalEstimateStatus
                          ? "Add note for this terminal estimate status"
                          : "Optional note for this transition"
                      }
                      rows={3}
                    />
                  </label>
                </div>
                {actionMessage && actionTone === "success" ? (
                  <p className={styles.actionSuccess}>{actionMessage}</p>
                ) : null}
                {actionMessage && actionTone === "error" ? (
                  <p className={styles.actionError}>{actionMessage}</p>
                ) : null}
                <div className={styles.lifecycleActions}>
                  {canSubmitStatusUpdate ? (
                    <button
                      type="button"
                      className={`${styles.lifecycleActionButton} ${styles.lifecycleActionButtonPrimary}`}
                      onClick={handleUpdateEstimateStatus}
                      disabled={!canSubmitStatusUpdate}
                    >
                      Update Selected Estimate Status
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.lifecycleActionButton}
                    onClick={handleAddEstimateStatusNote}
                    disabled={!canSubmitStatusNote}
                  >
                    Add Estimate Status Note
                  </button>
                </div>
              </>
            ) : null}

            {selectedEstimateId && statusEvents.length > 0 ? (
              <div className={styles.statusEvents}>
                <h4>Status Events</h4>
                <div className={styles.statusEventsTableWrap}>
                  <table className={styles.statusEventsTable}>
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Occurred</th>
                        <th>Note</th>
                        <th>Who</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statusEvents.map((event) => {
                        const toStatusClass = isNotatedStatusEvent(event)
                          ? styles.statusNotated
                          : statusClasses[event.to_status] ?? "";
                        return (
                          <tr key={event.id}>
                            <td>
                              <span className={`${styles.versionStatus} ${toStatusClass}`}>
                                {formatStatusAction(event)}
                              </span>
                            </td>
                            <td>{formatEventDate(event.changed_at)}</td>
                            <td>{event.note || "—"}</td>
                            <td>
                              {event.changed_by_customer_id ? (
                                <Link
                                  href={`/customers?customer=${event.changed_by_customer_id}`}
                                  className={styles.statusEventActorLink}
                                >
                                  {event.changed_by_display || `Customer #${event.changed_by_customer_id}`}
                                </Link>
                              ) : (
                                event.changed_by_display || event.changed_by_email || "Unknown user"
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <p className={styles.inlineHint}>Viewer collapsed. Expand to review versions, status transitions, and history.</p>
        )}
      </section>

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
              Create New Estimate opens a fresh draft workspace. Duplicate creates a new draft from the selected estimate.
            </p>
          </div>
          <div className={`${styles.lifecycleActions} ${styles.composerPrepActions} ${styles.workspaceToolbarActions}`}>
            <button type="button" className={styles.secondaryButton} onClick={startNewEstimate}>
              {selectedEstimate ? "Create New Estimate" : "Reset"}
            </button>
            {selectedEstimate ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  setDuplicateTitle(`${selectedEstimate.title || "Estimate"} Copy`);
                  duplicateDialogRef.current?.showModal();
                }}
              >
                Duplicate as New Estimate
              </button>
            ) : null}
          </div>
        </div>
        {actionMessage && actionTone === "success" && /^Duplicated\b/i.test(actionMessage) ? (
          <p className={creatorStyles.actionSuccess}>{actionMessage}</p>
        ) : null}
        {actionMessage && actionTone !== "success" ? <p className={`${styles.actionError} ${styles.composerPrepMessage}`}>{actionMessage}</p> : null}
        <dialog ref={duplicateDialogRef} className={styles.duplicateDialog}>
          <p className={styles.inlineHint}>
            Duplicating in project{" "}
            {selectedProject
              ? `#${selectedProject.id} - ${selectedProject.name} (${selectedProject.customer_display_name})`
              : "current selection"}.
          </p>
          <label className={styles.lifecycleField}>
            New estimate title
            <input
              value={duplicateTitle}
              onChange={(event) => setDuplicateTitle(event.target.value)}
              placeholder="Estimate title"
            />
          </label>
          <div className={styles.lifecycleActions}>
            <button type="button" className={creatorStyles.primaryButton} onClick={handleDuplicateEstimate}>
              Confirm Duplicate
            </button>
            <button type="button" className={creatorStyles.secondaryButton} onClick={() => duplicateDialogRef.current?.close()}>
              Cancel
            </button>
          </div>
        </dialog>
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
                  if (!projectId) {
                    setFormErrorMessage("Select a project first.");
                    return;
                  }
                  if (!trimmedTitle) {
                    setFormErrorMessage("Estimate title is required.");
                    return;
                  }
                  setConfirmedFamilyTitleKey(normalizeFamilyTitle(trimmedTitle));
                  setFamilyCollisionPrompt(null);
                  void submitNewEstimateWithTitle({
                    projectId,
                    title: trimmedTitle,
                    allowExistingTitleFamily: true,
                  });
                }}
              >
                Create Revision In Existing Family
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmedFamilyTitleKey("");
                  setFamilyCollisionPrompt(null);
                }}
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
          estimateId={selectedEstimateId}
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
          canSubmit={canCreateEstimate}
          isSubmitting={isSubmitting}
          isEditingDraft={isEditingDraft}
          readOnly={isReadOnly}
          formErrorMessage={formErrorMessage}
          formSuccessMessage={formSuccessMessage}
          lineSortKey={lineSortKey}
          lineSortDirection={lineSortDirection}
          onTitleChange={handleEstimateTitleChange}
          onValidThroughChange={setValidThrough}
          onTaxPercentChange={setTaxPercent}
          onLineItemChange={updateLineItem}
          onAddLineItem={addLineItem}
          onMoveLineItem={moveLineItem}
          onDuplicateLineItem={duplicateLineItem}
          onRemoveLineItem={removeLineItem}
          onSortLineItems={handleSortLineItems}
          onSubmit={handleCreateEstimate}
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
    </section>
  );
}
