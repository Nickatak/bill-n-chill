"use client";

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultApiBaseUrl,
  fetchEstimatePolicyContract,
  normalizeApiBaseUrl,
} from "../api";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import styles from "./estimates-console.module.css";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  formatDateInputFromIso,
  formatDateTimeDisplay,
} from "../../../shared/date-format";
import {
  ApiResponse,
  CostCode,
  EstimateLineInput,
  EstimateLineItemRecord,
  EstimatePolicyContract,
  EstimateRecord,
  EstimateStatusEventRecord,
  ProjectRecord,
} from "../types";
import { EstimateSheet, OrganizationDocumentDefaults } from "./estimate-sheet";

type LineSortKey = "quantity" | "costCode" | "unitCost" | "markupPercent" | "amount";
type EstimateStatusValue = string;
type FinancialBaselineStatusValue = "none" | "active" | "superseded";
type EstimateFamilyCollisionPrompt = {
  title: string;
  latestEstimateId: number | null;
  latestVersion: number | null;
  familySize: number | null;
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
const ESTIMATE_VALIDATION_DELTA_DAYS_FALLBACK = 30;

function todayDateInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveEstimateValidationDeltaDays(
  defaults?: OrganizationDocumentDefaults | null,
): number {
  const parsed = Number(defaults?.estimate_validation_delta_days);
  if (!Number.isFinite(parsed)) {
    return ESTIMATE_VALIDATION_DELTA_DAYS_FALLBACK;
  }
  return Math.max(1, Math.min(365, Math.round(parsed)));
}

function addDaysToDateInput(baseDateInput: string, daysToAdd: number): string {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(baseDateInput);
  if (!matched) {
    return "";
  }
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(normalized.getTime())) {
    return "";
  }
  normalized.setUTCDate(normalized.getUTCDate() + daysToAdd);
  return normalized.toISOString().slice(0, 10);
}

function emptyLine(localId: number, defaultCostCodeId = ""): EstimateLineInput {
  return {
    localId,
    costCodeId: defaultCostCodeId,
    description: "Scope item",
    quantity: "1",
    unit: "ea",
    unitCost: "0",
    markupPercent: "0",
  };
}

function mapEstimateLineItemsToInputs(items: EstimateLineItemRecord[] = []): EstimateLineInput[] {
  if (!items.length) {
    return [emptyLine(1)];
  }
  return items.map((item, index) => ({
    localId: index + 1,
    costCodeId: String(item.cost_code ?? ""),
    description: item.description || "",
    quantity: String(item.quantity ?? ""),
    unit: item.unit || "ea",
    unitCost: String(item.unit_cost ?? ""),
    markupPercent: String(item.markup_percent ?? ""),
  }));
}

function readApiErrorMessage(payload: ApiResponse | undefined, fallback: string): string {
  const topLevelMessage = payload?.error?.message?.trim();
  if (topLevelMessage) {
    return topLevelMessage;
  }
  const fieldEntries = Object.entries(payload?.error?.fields ?? {});
  for (const [fieldName, fieldMessages] of fieldEntries) {
    if (!Array.isArray(fieldMessages)) {
      continue;
    }
    const firstFieldMessage = fieldMessages.find((message) => Boolean((message || "").trim()));
    if (firstFieldMessage) {
      return `${fieldName}: ${firstFieldMessage}`;
    }
  }
  return fallback;
}

function normalizeFamilyTitle(value: string): string {
  return value.trim().toLowerCase();
}

export function EstimatesConsole({ scopedProjectId: scopedProjectIdProp = null }: EstimatesConsoleProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token } = useSharedSessionAuth();
  const [formErrorMessage, setFormErrorMessage] = useState("");
  const [formSuccessMessage, setFormSuccessMessage] = useState("");
  const [formSuccessHref, setFormSuccessHref] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [isActivatingBaseline, setIsActivatingBaseline] = useState(false);

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [organizationDefaults, setOrganizationDefaults] =
    useState<OrganizationDocumentDefaults | null>(null);

  const [estimates, setEstimates] = useState<EstimateRecord[]>([]);
  const [selectedEstimateId, setSelectedEstimateId] = useState("");
  const [estimateStatuses, setEstimateStatuses] = useState<string[]>(ESTIMATE_STATUSES_FALLBACK);
  const [estimateStatusLabels, setEstimateStatusLabels] = useState<Record<string, string>>(
    ESTIMATE_STATUS_LABELS_FALLBACK,
  );
  const [estimateAllowedStatusTransitions, setEstimateAllowedStatusTransitions] = useState<
    Record<string, string[]>
  >(ESTIMATE_ALLOWED_STATUS_TRANSITIONS_FALLBACK);
  const [estimateQuickActionByStatus, setEstimateQuickActionByStatus] = useState<
    Record<string, "change_order" | "revision">
  >(ESTIMATE_QUICK_ACTION_BY_STATUS_FALLBACK);
  const [defaultCreateStatus, setDefaultCreateStatus] = useState("draft");
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
  const [showDuplicatePanel, setShowDuplicatePanel] = useState(false);
  const [duplicateTitle, setDuplicateTitle] = useState("");
  const [isViewerExpanded, setIsViewerExpanded] = useState(true);
  const [defaultEstimateStatusFilters, setDefaultEstimateStatusFilters] = useState<string[]>(
    ESTIMATE_DEFAULT_STATUS_FILTERS_FALLBACK,
  );
  const [estimateStatusFilters, setEstimateStatusFilters] = useState<EstimateStatusValue[]>(
    ESTIMATE_DEFAULT_STATUS_FILTERS_FALLBACK,
  );
  const estimateStatusFiltersRef = useRef<EstimateStatusValue[]>(
    ESTIMATE_DEFAULT_STATUS_FILTERS_FALLBACK,
  );

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
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
  const isReadOnly = Boolean(selectedEstimate && selectedEstimate.status !== "draft");
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
    ? !isTerminalEstimateStatus && nextStatusOptions.length > 0
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

  function formatEstimateStatus(status?: string): string {
    if (!status) {
      return "";
    }
    return statusLabelByValue[status] ?? status;
  }

  function estimateFinancialBaselineStatus(
    estimate?: EstimateRecord | null,
  ): FinancialBaselineStatusValue {
    if (!estimate) {
      return "none";
    }
    if (estimate.is_active_financial_baseline) {
      return "active";
    }
    const status = estimate.financial_baseline_status;
    if (status === "active" || status === "superseded") {
      return status;
    }
    return "none";
  }

  function formatFinancialBaselineStatus(status: FinancialBaselineStatusValue): string {
    if (status === "active") {
      return "Financial Baseline";
    }
    if (status === "superseded") {
      return "Superseded Baseline";
    }
    return "";
  }

  function formatStatusAction(event: EstimateStatusEventRecord): string {
    if (event.action_type === "notate") {
      return "Notated";
    }
    if (event.action_type === "resend") {
      return "Re-sent";
    }
    if (event.from_status === "sent" && event.to_status === "sent" && !(event.note || "").trim()) {
      return "Re-sent";
    }
    if (event.from_status === event.to_status && (event.note || "").trim()) {
      return "Notated";
    }
    const actionByStatus: Record<string, string> = {
      draft: "Created as Draft",
      sent: "Sent",
      approved: "Approved",
      rejected: "Rejected",
      void: "Voided",
      archived: "Archived",
    };
    return actionByStatus[event.to_status] ?? formatEstimateStatus(event.to_status);
  }

  function isNotatedStatusEvent(event: EstimateStatusEventRecord): boolean {
    if (event.action_type === "notate") {
      return true;
    }
    return event.from_status === event.to_status && (event.note || "").trim().length > 0;
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

  const loadEstimatePolicy = useCallback(async () => {
    try {
      const response = await fetchEstimatePolicyContract({
        baseUrl: normalizedBaseUrl,
        token,
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok || !payload.data || Array.isArray(payload.data)) {
        return;
      }
      const contract = payload.data as EstimatePolicyContract;
      if (
        !Array.isArray(contract.statuses) ||
        !contract.statuses.length ||
        !contract.allowed_status_transitions
      ) {
        return;
      }
      const normalizedTransitions = contract.statuses.reduce<Record<string, string[]>>(
        (acc, statusValue) => {
          const nextStatuses = contract.allowed_status_transitions[statusValue];
          acc[statusValue] = Array.isArray(nextStatuses) ? nextStatuses : [];
          return acc;
        },
        {},
      );
      const nextDefaultCreateStatus =
        contract.default_create_status || contract.statuses[0] || ESTIMATE_STATUSES_FALLBACK[0];
      const nextDefaultFilters =
        Array.isArray(contract.default_status_filters) && contract.default_status_filters.length
          ? contract.default_status_filters.filter((value) => contract.statuses.includes(value))
          : ESTIMATE_DEFAULT_STATUS_FILTERS_FALLBACK.filter((value) => contract.statuses.includes(value));
      const resolvedDefaultFilters = nextDefaultFilters.length ? nextDefaultFilters : contract.statuses;

      setEstimateStatuses(contract.statuses);
      setEstimateStatusLabels({
        ...ESTIMATE_STATUS_LABELS_FALLBACK,
        ...(contract.status_labels || {}),
      });
      setEstimateAllowedStatusTransitions(normalizedTransitions);
      setEstimateQuickActionByStatus({
        ...ESTIMATE_QUICK_ACTION_BY_STATUS_FALLBACK,
        ...(contract.quick_action_by_status || {}),
      });
      setDefaultCreateStatus(nextDefaultCreateStatus);
      setDefaultEstimateStatusFilters(resolvedDefaultFilters);
      setEstimateStatusFilters((current) => {
        const retained = current.filter((value) => contract.statuses.includes(value));
        if (retained.length) {
          return retained;
        }
        return resolvedDefaultFilters;
      });
      setSelectedStatus((current) =>
        contract.statuses.includes(current) ? current : nextDefaultCreateStatus,
      );
    } catch {
      // Policy load is best-effort; static fallback remains active.
    }
  }, [normalizedBaseUrl, token]);

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
        setActionMessage(readApiErrorMessage(payload, "Clone failed."));
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
  const visibleEstimateFamilies = useMemo(() => {
    if (estimateStatusFilters.length === 0) {
      return [];
    }
    return estimateFamilies.filter((family) => {
      const latest = family.items[family.items.length - 1];
      if (!latest?.status) {
        return false;
      }
      return estimateStatusFilters.includes(latest.status as EstimateStatusValue);
    });
  }, [estimateFamilies, estimateStatusFilters]);

  function formatMoney(value: number): string {
    return value.toFixed(2);
  }

  function publicEstimateHref(publicRef?: string): string {
    if (!publicRef) {
      return "";
    }
    return `/estimate/${publicRef}`;
  }

  const loadEstimateIntoForm = useCallback((estimate: EstimateRecord) => {
    const estimateTerms = (estimate.terms_text || "").trim();
    setEstimateTitle(estimate.title || "Untitled");
    setTermsText(estimateTerms || organizationDefaults?.estimate_default_terms || "");
    setTaxPercent(String(estimate.tax_percent ?? "0"));
    setValidThrough(estimate.valid_through ?? "");
    const mapped = mapEstimateLineItemsToInputs(estimate.line_items ?? []);
    setLineItems(mapped);
    setNextLineId(mapped.length + 1);
    const createdDate = formatDateInputFromIso(estimate.created_at);
    if (createdDate) {
      setEstimateDate(createdDate);
    }
  }, [organizationDefaults?.estimate_default_terms]);

  const handleSelectEstimate = useCallback((estimate: EstimateRecord) => {
    const nextEstimateId = String(estimate.id);
    const isSameEstimate = nextEstimateId === selectedEstimateIdRef.current;
    setSelectedEstimateId(nextEstimateId);
    const nextStatuses = estimateAllowedStatusTransitions[estimate.status] ?? [];
    setSelectedStatus(nextStatuses[0] ?? estimate.status);
    if (!isSameEstimate) {
      setStatusEvents([]);
    }
    setLineSortKey(null);
    setLineSortDirection("asc");
    setFormErrorMessage("");
    setFormSuccessMessage("");
    setFormSuccessHref("");
    setFamilyCollisionPrompt(null);
    setConfirmedFamilyTitleKey("");
    loadEstimateIntoForm(estimate);
    setDuplicateTitle(`${estimate.title || "Estimate"} Copy`);
  }, [estimateAllowedStatusTransitions, loadEstimateIntoForm]);

  useEffect(() => {
    selectedEstimateIdRef.current = selectedEstimateId;
  }, [selectedEstimateId]);

  useEffect(() => {
    estimateStatusFiltersRef.current = estimateStatusFilters;
  }, [estimateStatusFilters]);

  const clearSelectedEstimateState = useCallback(() => {
    const defaultCostCodeId = costCodes[0] ? String(costCodes[0].id) : "";
    const nextEstimateDate = todayDateInputValue();
    const nextValidThrough = addDaysToDateInput(
      nextEstimateDate,
      resolveEstimateValidationDeltaDays(organizationDefaults),
    );
    setSelectedEstimateId("");
    selectedEstimateIdRef.current = "";
    setSelectedStatus(defaultCreateStatus);
    setStatusNote("");
    setStatusEvents([]);
    setEstimateTitle("");
    setFamilyCollisionPrompt(null);
    setConfirmedFamilyTitleKey("");
    setTermsText(organizationDefaults?.estimate_default_terms || "");
    setTaxPercent("0");
    setLineItems([emptyLine(1, defaultCostCodeId)]);
    setLineSortKey(null);
    setLineSortDirection("asc");
    setNextLineId(2);
    setEstimateDate(nextEstimateDate);
    setValidThrough(nextValidThrough);
    setShowDuplicatePanel(false);
  }, [
    costCodes,
    defaultCreateStatus,
    organizationDefaults,
  ]);

  function startNewEstimate() {
    setIsViewerExpanded(false);
    clearSelectedEstimateState();
    setActionMessage("");
    setFormErrorMessage("");
    setFormSuccessMessage("");
    setFormSuccessHref("");
  }

  function handleSelectFamilyLatest(title: string, latest: EstimateRecord) {
    handleSelectEstimate(latest);
    setOpenFamilyHistory((current) => {
      if (current.has(title)) {
        return new Set<string>();
      }
      return new Set<string>([title]);
    });
  }

  function toggleEstimateStatusFilter(nextStatus: EstimateStatusValue) {
    setEstimateStatusFilters((current) =>
      current.includes(nextStatus)
        ? current.filter((statusValue) => statusValue !== nextStatus)
        : estimateStatusFilterValues.filter(
            (statusValue) => statusValue === nextStatus || current.includes(statusValue),
          ),
    );
  }

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

  useEffect(() => {
    if (estimateDate) {
      return;
    }
    const nextEstimateDate = todayDateInputValue();
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
        setActionMessage(readApiErrorMessage(projectsJson, "Failed loading projects."));
        return;
      }
      if (!codesRes.ok) {
        setActionMessage(readApiErrorMessage(codesJson, "Failed loading cost codes."));
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
        setTermsText((current) => current || organizationData.estimate_default_terms || "");
        setValidThrough((current) => {
          if (selectedEstimateIdRef.current || current) {
            return current;
          }
          const estimateDateSeed = todayDateInputValue();
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

  const loadEstimates = useCallback(async (
    options?: {
      preserveSelection?: boolean;
      preferredEstimateId?: number | null;
      quiet?: boolean;
    },
  ) => {
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
    setFormSuccessHref("");
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
          setActionMessage(readApiErrorMessage(payload, "Failed loading estimates."));
        }
        return;
      }
      const rows = (payload.data as EstimateRecord[]) ?? [];
      setEstimates(rows);
      if (!rows[0]) {
        return;
      }
      const activeFilters = estimateStatusFiltersRef.current;
      const retainedEstimateId =
        options?.preferredEstimateId ??
        (options?.preserveSelection && /^\d+$/.test(selectedEstimateIdRef.current)
          ? Number(selectedEstimateIdRef.current)
          : null);
      const retainedEstimate = retainedEstimateId
        ? rows.find((estimate) => estimate.id === retainedEstimateId)
        : null;
      const retainedEstimateAllowed =
        retainedEstimate &&
        activeFilters.includes(retainedEstimate.status as EstimateStatusValue);
      if (retainedEstimateAllowed) {
        handleSelectEstimate(retainedEstimate);
        return;
      }
      const scopedEstimateMatch = scopedEstimateId
        ? rows.find((estimate) => estimate.id === scopedEstimateId)
        : null;
      const scopedEstimateAllowed =
        scopedEstimateMatch &&
        activeFilters.includes(scopedEstimateMatch.status as EstimateStatusValue);
      if (scopedEstimateAllowed) {
        handleSelectEstimate(scopedEstimateMatch);
        return;
      }
      const firstVisibleEstimate = rows.find((estimate) =>
        activeFilters.includes(estimate.status as EstimateStatusValue),
      );
      if (firstVisibleEstimate) {
        handleSelectEstimate(firstVisibleEstimate);
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

  useEffect(() => {
    if (!token) {
      return;
    }
    void loadEstimatePolicy();
  }, [loadEstimatePolicy, token]);

  useEffect(() => {
    if (!token) {
      return;
    }
    void loadDependencies();
  }, [loadDependencies, token]);

  useEffect(() => {
    if (!token || !selectedProjectId) {
      return;
    }
    void loadEstimates();
  }, [loadEstimates, selectedProjectId, token]);

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

  function addLineItem() {
    const defaultCostCodeId = costCodes[0] ? String(costCodes[0].id) : "";
    setLineItems((current) => [...current, emptyLine(nextLineId, defaultCostCodeId)]);
    setNextLineId((value) => value + 1);
  }

  function duplicateLineItem(localId: number) {
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
    setLineItems((current) => {
      if (current.length <= 1) {
        return current;
      }
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
    setFormSuccessHref("");
    setLineItems((current) =>
      current.map((line) => (line.localId === localId ? { ...line, [key]: value } : line)),
    );
  }

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
    () => Boolean(selectedProjectId) && lineItems.length > 0,
    [lineItems.length, selectedProjectId],
  );

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
          readApiErrorMessage(payload, "Create estimate failed. Check values and try again."),
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
      setFormSuccessHref(created.public_ref ? publicEstimateHref(created.public_ref) : "");
      loadEstimateIntoForm(created);
      setFamilyCollisionPrompt(null);
      setConfirmedFamilyTitleKey("");
    } catch {
      setFormErrorMessage("Could not reach estimate create endpoint.");
    } finally {
      submitGuard.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleCreateEstimate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormErrorMessage("");
    setFormSuccessMessage("");
    setFormSuccessHref("");
    if (submitGuard.current) {
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
            readApiErrorMessage(payload, "Save draft failed. Check values and try again."),
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
        setFormSuccessHref(updated.public_ref ? publicEstimateHref(updated.public_ref) : "");
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
        setActionMessage(readApiErrorMessage(payload, "Duplicate failed."));
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
      setShowDuplicatePanel(false);
      setStatusEvents([]);
      setActionMessage("");
    } catch {
      setActionMessage("Could not reach duplicate endpoint.");
    }
  }

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
        setActionMessage(readApiErrorMessage(payload, "Status update failed."));
        return;
      }
      const updated = payload.data as EstimateRecord;
      setEstimates((current) =>
        current.map((estimate) => (estimate.id === updated.id ? updated : estimate)),
      );
      const updatedNextStatuses = estimateAllowedStatusTransitions[updated.status] ?? [];
      setSelectedStatus(updatedNextStatuses[0] ?? updated.status);
      setStatusNote("");
      await loadStatusEvents({ estimateId: updated.id, quiet: true });
      const budgetConversionStatus = payload.meta?.budget_conversion_status;
      if (payload.meta?.activation_required) {
        const activeId = payload.meta.active_financial_estimate_id;
        setActionMessage(
          activeId
            ? `Estimate approved. Financial baseline remains on estimate #${activeId}. Activate this estimate to supersede it.`
            : "Estimate approved. Activate this estimate as the financial baseline.",
        );
        return;
      }
      if (budgetConversionStatus === "converted" || budgetConversionStatus === "already_converted") {
        setActionMessage("Estimate approved and activated as the financial baseline.");
        return;
      }
      setActionMessage("");
    } catch {
      setActionMessage("Could not reach estimate status endpoint.");
    }
  }

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
        setActionMessage(readApiErrorMessage(payload, "Status note update failed."));
        return;
      }
      const updated = payload.data as EstimateRecord;
      setEstimates((current) =>
        current.map((estimate) => (estimate.id === updated.id ? updated : estimate)),
      );
      const updatedNextStatuses = estimateAllowedStatusTransitions[updated.status] ?? [];
      setSelectedStatus(updatedNextStatuses[0] ?? updated.status);
      setStatusNote("");
      await loadStatusEvents({ estimateId: updated.id, quiet: true });
      setActionMessage("");
    } catch {
      setActionMessage("Could not reach estimate status note endpoint.");
    }
  }

  async function handleActivateFinancialBaseline() {
    const estimateId = Number(selectedEstimateId);
    if (!estimateId || !selectedEstimate) {
      setActionMessage("Select an approved estimate first.");
      return;
    }
    if (selectedEstimate.status !== "approved") {
      setActionMessage("Only approved estimates can be activated for financials.");
      return;
    }

    setActionMessage("");
    setIsActivatingBaseline(true);
    try {
      const response = await fetch(`${normalizedBaseUrl}/estimates/${estimateId}/convert-to-budget/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({ supersede_active: true }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        const activeId = payload.error?.meta?.active_financial_estimate_id;
        const message = readApiErrorMessage(payload, "Financial baseline activation failed.");
        setActionMessage(
          activeId ? `${message} Active baseline is estimate #${activeId}.` : message,
        );
        return;
      }
      const conversionStatus = payload.meta?.conversion_status ?? "converted";
      await loadEstimates({
        preserveSelection: true,
        preferredEstimateId: estimateId,
        quiet: true,
      });
      await loadStatusEvents({ estimateId, quiet: true });
      if (conversionStatus === "superseded_and_converted") {
        setActionMessage("Financial baseline switched to this estimate.");
        return;
      }
      if (conversionStatus === "already_converted") {
        setActionMessage("This estimate is already the active financial baseline.");
        return;
      }
      setActionMessage("Financial baseline activated from this estimate.");
    } catch {
      setActionMessage("Could not reach estimate conversion endpoint.");
    } finally {
      setIsActivatingBaseline(false);
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
            setActionMessage(readApiErrorMessage(payload, "Failed loading status events."));
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

  useEffect(() => {
    if (!token || !selectedEstimateId) {
      return;
    }
    void loadStatusEvents({ quiet: true });
  }, [loadStatusEvents, selectedEstimateId, token]);

  return (
    <section className={styles.console}>
      <section className={styles.lifecycle}>
        <div className={styles.lifecycleHeader}>
          <h3>
            {selectedProject
              ? `Estimates for #${selectedProject.id} ${selectedProject.name}`
              : "Estimates"}
          </h3>
          <button
            type="button"
            className={styles.lifecycleToggleButton}
            onClick={() => setIsViewerExpanded((current) => !current)}
            aria-expanded={isViewerExpanded}
          >
            {isViewerExpanded ? "Hide Viewer" : "Show Viewer"}
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
                      {option.label}
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
              </div>
            </div>

            <div className={styles.versionTree}>
              {activeFinancialEstimate ? (
                <div className={styles.versionBaselineBanner}>
                  <div className={styles.versionBaselineCopy}>
                    <span className={styles.versionBaselineLabel}>Active Financial Baseline</span>
                    <span className={styles.versionBaselineValue}>
                      Estimate #{activeFinancialEstimate.id} · v{activeFinancialEstimate.version} ·{" "}
                      {activeFinancialEstimate.title || "Untitled"}
                    </span>
                  </div>
                  <div className={styles.versionBaselineActions}>
                    {String(activeFinancialEstimate.id) === selectedEstimateId ? (
                      <span className={styles.versionBaselineSelected}>Viewing baseline</span>
                    ) : (
                      <button
                        type="button"
                        className={styles.versionBaselineJumpButton}
                        onClick={() => handleSelectEstimate(activeFinancialEstimate)}
                      >
                        Jump to Baseline
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <p className={`${styles.inlineHint} ${styles.versionBaselineEmpty}`}>
                  No active financial baseline is set for this project yet.
                </p>
              )}
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
                  const latestTotal = formatMoney(toNumber(latest.grand_total || "0"));
                  const latestFinancialBaselineStatus = estimateFinancialBaselineStatus(latest);
                  return (
                    <div
                      key={family.title}
                      className={`${styles.familyGroup} ${
                        isFamilyActive ? styles.familyGroupActive : ""
                      }`}
                    >
                      <div className={styles.familyRow}>
                        <div className={styles.versionCardWrap}>
                          {quickActionKind === "change_order" && selectedProjectId ? (
                            <Link
                              href={`/projects/${selectedProjectId}/change-orders?origin_estimate=${latest.id}`}
                              className={styles.familyActionLink}
                              aria-label={`${quickActionTitle} (estimate #${latest.id})`}
                              title={quickActionTitle}
                            >
                              To CO&apos;s <span aria-hidden="true">↗</span>
                            </Link>
                          ) : null}
                          {quickActionKind === "revision" ? (
                            <button
                              type="button"
                              className={styles.familyActionButton}
                              aria-label={`${quickActionTitle} (estimate #${latest.id})`}
                              title={quickActionTitle}
                              onClick={() => void handleFamilyCardQuickAction(latest)}
                            >
                              Duplicate
                            </button>
                          ) : null}
                          {latest.public_ref ? (
                            <Link
                              href={publicEstimateHref(latest.public_ref)}
                              className={styles.publicEstimateLinkIcon}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open public view for estimate #${latest.id}`}
                              title="Open public view"
                            >
                              Public
                            </Link>
                          ) : null}
                          <button
                            type="button"
                            className={`${styles.familyMain} ${
                              isLatestSelected ? styles.familyMainActive : ""
                            }`}
                            onClick={() => handleSelectFamilyLatest(family.title, latest)}
                          >
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
                          </button>
                        </div>
                        {isHistoryOpen && history.length > 0 ? (
                          <div className={styles.historyRow}>
                            {history.map((estimate) => {
                              const total = formatMoney(toNumber(estimate.grand_total || "0"));
                              const isSelected = String(estimate.id) === selectedEstimateId;
                              const financialBaselineStatus =
                                estimateFinancialBaselineStatus(estimate);
                              return (
                                <div key={estimate.id} className={styles.versionCardWrap}>
                                  {estimate.public_ref ? (
                                    <Link
                                      href={publicEstimateHref(estimate.public_ref)}
                                      className={styles.publicEstimateLinkIcon}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      aria-label={`Open public view for estimate #${estimate.id}`}
                                      title="Open public view"
                                    >
                                      Public
                                    </Link>
                                  ) : null}
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
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                      <div className={styles.familyFooter}>
                        {isViewingHistory ? (
                          <span className={styles.historyNotice}>
                            Viewing v{selectedInFamily?.version}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              ) : estimateFamilies.length > 0 ? (
                <p className={styles.inlineHint}>No estimate families match the selected status filters.</p>
              ) : (
                <p className={styles.inlineHint}>No estimates to display yet.</p>
              )}
            </div>

            {selectedEstimateId ? (
              <>
                {canActivateSelectedFinancialBaseline ? (
                  <div className={styles.financialActivationPanel}>
                    <span className={styles.financialActivationLabel}>Financial Baseline</span>
                    <p className={styles.inlineHint}>
                      {selectedFinancialBaselineStatus === "superseded"
                        ? "This estimate was previously active and is now superseded."
                        : "This approved estimate is not currently active for project financials."}{" "}
                      {activeFinancialEstimate
                        ? `Current active estimate: #${activeFinancialEstimate.id} v${activeFinancialEstimate.version}.`
                        : "No active estimate is currently set."}
                    </p>
                    <button
                      type="button"
                      className={styles.financialActivationButton}
                      onClick={handleActivateFinancialBaseline}
                      disabled={isActivatingBaseline}
                    >
                      {isActivatingBaseline
                        ? "Activating Financial Baseline..."
                        : "Activate Selected Estimate for Financials"}
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
                <div className={styles.lifecycleActions}>
                  {canSubmitStatusUpdate ? (
                    <button
                      type="button"
                      onClick={handleUpdateEstimateStatus}
                      disabled={!canSubmitStatusUpdate}
                    >
                      Update Selected Estimate Status
                    </button>
                  ) : null}
                  <button
                    type="button"
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
                            <td>{event.changed_by_email}</td>
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
        <div className={`${styles.lifecycleActions} ${styles.composerPrepActions}`}>
          <button type="button" onClick={startNewEstimate}>
            Add New Estimate
          </button>
          <button
            type="button"
            onClick={() => {
              if (!selectedEstimate) {
                setActionMessage("Select an existing estimate version before duplicating.");
                return;
              }
              setDuplicateTitle(`${selectedEstimate.title || "Estimate"} Copy`);
              setShowDuplicatePanel((current) => !current);
            }}
          >
            Duplicate as New Estimate
          </button>
        </div>
        {actionMessage ? <p className={`${styles.actionError} ${styles.composerPrepMessage}`}>{actionMessage}</p> : null}
        {showDuplicatePanel ? (
          <div className={`${styles.duplicatePanel} ${styles.composerPrepPanel}`}>
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
              <button type="button" onClick={handleDuplicateEstimate}>
                Confirm Duplicate
              </button>
              <button type="button" onClick={() => setShowDuplicatePanel(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
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
        formSuccessHref={formSuccessHref}
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
    </section>
  );
}
