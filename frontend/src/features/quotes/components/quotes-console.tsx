"use client";

/**
 * Quotes console -- orchestrator for the internal quote workspace.
 *
 * Pure orchestrator — composes single-purpose hooks, wires their outputs
 * into child components, and owns cross-cutting coordination (data loading,
 * mutations, family collision logic, status transitions).
 *
 * Parent: app/projects/[projectId]/quotes/page.tsx
 *
 * ## Page layout
 *
 * ┌─────────────────────────────────────────────────┐
 * │ QuotesViewerPanel                            │
 * │   ├── Status filter pills                       │
 * │   ├── Family-grouped quote tree               │
 * │   ├── Status transition controls                 │
 * │   └── Status event history                       │
 * ├─────────────────────────────────────────────────┤
 * │ QuotesWorkspacePanel                          │
 * │   ├── Workspace header (context badge)           │
 * │   ├── Family collision prompt                    │
 * │   └── Quote composer (sheet form)             │
 * └─────────────────────────────────────────────────┘
 *
 * ## Hook dependency graph
 *
 * useLineItems             (standalone — line item CRUD primitives)
 * useQuoteFormFields    (reads organizationDefaults, lineItem setters)
 *   └── hydrateFromQuote / resetFormFields used by console orchestration
 * usePolicyContract        (standalone — fetches policy, drives status config)
 * useStatusFilters         (standalone — status filter pill state)
 * useCreatorFlash          (standalone — composer flash animation)
 *
 * ## Functions
 *
 * - loadDependencies()         — Fetches projects, cost codes, org defaults
 * - loadQuotes(options?)    — Fetches quotes for selected project
 * - loadStatusEvents(options?) — Fetches status event history
 * - handleSelectQuote()     — Selects quote, hydrates form
 * - clearSelectedQuoteState() — Resets selection + form to blank draft
 * - startNewQuote()         — Clears selection and flashes composer
 * - handleCreateQuote()     — Create or save-draft form submission
 * - handleDuplicateAsNew()     — Pre-fill create form from selected quote
 * - handleUpdateQuoteStatus() — Apply status transition
 * - handleAddQuoteStatusNote() — Append note without transition
 * - handleFamilyCardQuickAction() — Route CO/duplicate quick actions
 * - buildOrderedPayload()     — Build line_items (with order) and sections for API
 *
 * ## Effects
 *
 * - Sync printable state with quote selection
 * - Keep selectedQuoteIdRef in sync for async callbacks
 * - Keep quoteStatusFiltersRef in sync for filter-aware loads
 * - Fetch dependencies on auth token
 * - Reload quotes on project change
 * - Sync scoped project ID from props
 * - Seed quote date defaults on first render (in form fields hook)
 * - Load status events on quote selection change
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
import { fetchQuotePolicyContract } from "../api";
import { usePolicyContract } from "@/shared/hooks/use-policy-contract";
import { useStatusFilters } from "@/shared/hooks/use-status-filters";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { canDo } from "@/shared/session/rbac";
import { usePrintable } from "@/shared/shell/printable-context";
import styles from "./quotes-console.module.css";
import { useRouter, useSearchParams } from "next/navigation";
import { todayDateInput, addDaysToDateInput } from "@/shared/date-format";
import {
  ApiResponse,
  BillingPeriodInput,
  CostCode,
  QuoteLineInput,
  QuotePolicyContract,
  QuoteRecord,
  QuoteStatusEventRecord,
  ProjectRecord,
} from "../types";
import {
  computeQuoteStatusCounts,
  computeLineTotal,
  emptyLine,
  filterVisibleFamilies,
  groupQuoteFamilies,
  normalizeFamilyTitle,
  readQuoteApiError,
  resolveAutoSelectQuote,
  resolveQuoteValidationDeltaDays,
  toNumber,
  validateQuoteLineItems,
} from "../helpers";
import type { QuoteSheetV2Handle, OrganizationDocumentDefaults } from "./quote-sheet-v2";
import { QuotesViewerPanel } from "./quotes-viewer-panel";
import { QuotesWorkspacePanel } from "./quotes-workspace-panel";
import { useLineItems } from "@/shared/hooks/use-line-items";
import { useMediaQuery } from "@/shared/hooks/use-media-query";
import { useQuoteFormFields } from "../hooks/use-quote-form-fields";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type QuoteStatusValue = string;
type LoadQuotesOptions = {
  preserveSelection?: boolean;
  preferredQuoteId?: number | null;
  quiet?: boolean;
};
type QuotesConsoleProps = {
  scopedProjectId?: number | null;
};

const QUOTE_STATUSES_FALLBACK: string[] = [
  "draft",
  "sent",
  "approved",
  "rejected",
  "void",
  "archived",
];
const QUOTE_STATUS_LABELS_FALLBACK: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  approved: "Approved",
  rejected: "Rejected",
  void: "Void",
  archived: "Archived",
};
const QUOTE_DEFAULT_STATUS_FILTERS_FALLBACK: string[] = [
  "draft",
  "sent",
  "approved",
  "rejected",
];
const QUOTE_ALLOWED_STATUS_TRANSITIONS_FALLBACK: Record<string, QuoteStatusValue[]> = {
  draft: ["sent", "void", "archived"],
  sent: ["sent", "approved", "rejected", "void", "archived"],
  approved: [],
  rejected: ["void"],
  void: [],
  archived: [],
};
const QUOTE_QUICK_ACTION_BY_STATUS_FALLBACK: Record<string, "change_order" | "revision"> = {
  approved: "change_order",
  rejected: "revision",
  void: "revision",
};
const QUOTE_SYSTEM_ONLY_STATUSES = new Set<QuoteStatusValue>(["archived"]);
const QUOTE_MIN_LINE_ITEMS_ERROR = "At least one line item is required.";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Internal quotes workspace: version tree, composer, status lifecycle, and family management. */
export function QuotesConsole({ scopedProjectId: scopedProjectIdProp = null }: QuotesConsoleProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useMediaQuery("(max-width: 850px)");
  const { token: authToken, role, capabilities } = useSharedSessionAuth();
  const canMutateQuotes = canDo(capabilities, "quotes", "create");
  const canSendQuotes = canDo(capabilities, "quotes", "send");
  const canApproveQuotes = canDo(capabilities, "quotes", "approve");

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
  const [quotes, setQuotes] = useState<QuoteRecord[]>([]);
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const selectedQuoteIdRef = useRef("");
  const [billingPeriods, setBillingPeriods] = useState<BillingPeriodInput[]>([]);
  const billingPeriodsNextId = useRef(Date.now());

  /** Build a default "Lump Sum" 100% billing period using org invoice due delta. */
  function defaultBillingPeriod(dueDaysOverride?: number): BillingPeriodInput[] {
    const dueDays = dueDaysOverride ?? organizationDefaults?.default_invoice_due_delta ?? 30;
    const dueDate = addDaysToDateInput(todayDateInput(), dueDays);
    return [{
      localId: billingPeriodsNextId.current++,
      description: "Lump Sum",
      percent: "100",
      dueDate,
    }];
  }

  // -------------------------------------------------------------------------
  // Line items (shared hook)
  // -------------------------------------------------------------------------

  const {
    items: lineItems, setItems: setLineItems,
    setNextId: setNextLineId,
    add: addLineRaw, remove: removeLineRaw,
    update: updateLineRaw, reset: resetLines,
  } = useLineItems<QuoteLineInput>({ createEmpty: emptyLine });

  // -------------------------------------------------------------------------
  // Form fields (extracted hook)
  // -------------------------------------------------------------------------

  const formFields = useQuoteFormFields({
    organizationDefaults,
    selectedQuoteIdRef,
    setLineItems,
    setNextLineId,
    resetLines,
  });

  // -------------------------------------------------------------------------
  // Policy contract
  // -------------------------------------------------------------------------

  const [quoteQuickActionByStatus, setQuoteQuickActionByStatus] = useState<
    Record<string, "change_order" | "revision">
  >(QUOTE_QUICK_ACTION_BY_STATUS_FALLBACK);
  const [defaultQuoteStatusFilters, setDefaultQuoteStatusFilters] = useState<string[]>(
    QUOTE_DEFAULT_STATUS_FILTERS_FALLBACK,
  );

  const {
    statuses: quoteStatuses,
    statusLabels: quoteStatusLabels,
    allowedTransitions: quoteAllowedStatusTransitions,
  } = usePolicyContract<QuotePolicyContract>({
    fetchContract: fetchQuotePolicyContract,
    fallbackStatuses: QUOTE_STATUSES_FALLBACK,
    fallbackLabels: QUOTE_STATUS_LABELS_FALLBACK,
    fallbackTransitions: QUOTE_ALLOWED_STATUS_TRANSITIONS_FALLBACK,
    baseUrl: apiBaseUrl,
    authToken,
    onLoaded(contract, base) {
      // Domain-specific: quick-action map and filter reconciliation.
      const quickActionMap = {
        ...QUOTE_QUICK_ACTION_BY_STATUS_FALLBACK,
        ...(contract.quick_action_by_status || {}),
      };
      setQuoteQuickActionByStatus(quickActionMap);

      const candidateFilters =
        Array.isArray(contract.default_status_filters) && contract.default_status_filters.length
          ? contract.default_status_filters
          : QUOTE_DEFAULT_STATUS_FILTERS_FALLBACK;
      const validFilters = candidateFilters.filter((v) => base.statuses.includes(v));
      const resolvedDefaults = validFilters.length ? validFilters : base.statuses;
      setDefaultQuoteStatusFilters(resolvedDefaults);

      setQuoteStatusFilters((current) => {
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

  const [selectedStatus, setSelectedStatus] = useState<QuoteStatusValue>("draft");
  const [statusNote, setStatusNote] = useState("");
  const [statusEvents, setStatusEvents] = useState<QuoteStatusEventRecord[]>([]);

  // -------------------------------------------------------------------------
  // Status filters (shared hook)
  // -------------------------------------------------------------------------

  const viewerStatuses = quoteStatuses.filter(s => !QUOTE_SYSTEM_ONLY_STATUSES.has(s));
  const {
    filters: quoteStatusFilters,
    setFilters: setQuoteStatusFilters,
    toggleFilter: toggleQuoteStatusFilter,
  } = useStatusFilters({
    allStatuses: viewerStatuses,
    defaultFilters: QUOTE_DEFAULT_STATUS_FILTERS_FALLBACK,
    preserveOrder: true,
  });
  const quoteStatusFiltersRef = useRef<QuoteStatusValue[]>(
    QUOTE_DEFAULT_STATUS_FILTERS_FALLBACK,
  );

  // -------------------------------------------------------------------------
  // UI state & refs
  // -------------------------------------------------------------------------

  const [openFamilyHistory, setOpenFamilyHistory] = useState<Set<string>>(() => new Set());
  const [isViewerExpanded, setIsViewerExpanded] = useState(true);
  const { ref: quoteComposerRef, flash: flashCreator } = useCreatorFlash();
  const sheetRef = useRef<QuoteSheetV2Handle>(null);
  const { setPrintable } = usePrintable();

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  useEffect(() => {
    setPrintable(!!selectedQuoteId);
    return () => setPrintable(false);
  }, [selectedQuoteId, setPrintable]);

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

  const scopedProjectId = scopedProjectIdProp;
  const scopedQuoteIdParam = searchParams.get("quote");
  const scopedQuoteId =
    scopedQuoteIdParam && /^\d+$/.test(scopedQuoteIdParam)
      ? Number(scopedQuoteIdParam)
      : null;
  const selectedProject =
    projects.find((project) => String(project.id) === selectedProjectId) ?? null;
  const selectedQuote =
    quotes.find((quote) => String(quote.id) === selectedQuoteId) ?? null;
  const isProjectTerminal =
    selectedProject?.status === "completed" || selectedProject?.status === "cancelled";
  const isEditingDraft = Boolean(selectedQuote && selectedQuote.status === "draft");
  const isReadOnly = !canMutateQuotes || isProjectTerminal || Boolean(selectedQuote && selectedQuote.status !== "draft");
  const statusClasses: Record<string, string> = {
    draft: styles.statusDraft,
    sent: styles.statusSent,
    approved: styles.statusApproved,
    rejected: styles.statusRejected,
    void: styles.statusArchived,
    archived: styles.statusArchived,
  };
  const statusOptions: Array<{ value: QuoteStatusValue; label: string }> = quoteStatuses.map(
    (statusValue) => ({
      value: statusValue,
      label: quoteStatusLabels[statusValue] ?? statusValue,
    }),
  );
  const viewerStatusOptions = statusOptions.filter(
    (option) => !QUOTE_SYSTEM_ONLY_STATUSES.has(option.value),
  );
  const quoteStatusFilterValues = viewerStatusOptions.map((option) => option.value);
  const statusLabelByValue = statusOptions.reduce<Record<string, string>>((labels, option) => {
    labels[option.value] = option.label;
    return labels;
  }, {});
  const nextStatusValues = selectedQuote
    ? quoteAllowedStatusTransitions[selectedQuote.status] ?? []
    : [];
  const nextStatusOptions = statusOptions
    .filter(
      (option) =>
        nextStatusValues.includes(option.value) &&
        !QUOTE_SYSTEM_ONLY_STATUSES.has(option.value),
    )
    .filter((option) => {
      if (option.value === "sent") return canSendQuotes;
      if (option.value === "approved") return canApproveQuotes;
      return true;
    })
    .map((option) =>
      selectedQuote?.status === "sent" && option.value === "sent"
        ? { ...option, label: "Re-send" }
        : option,
    );
  const isTerminalQuoteStatus = Boolean(
    selectedQuote &&
      (selectedQuote.status === "approved" || selectedQuote.status === "void"),
  );
  const canSubmitStatusUpdate = selectedQuote
    ? !isTerminalQuoteStatus && nextStatusOptions.length > 0 && Boolean(selectedStatus)
    : false;
  const canSubmitStatusNote = selectedQuote
    ? Boolean(statusNote.trim())
    : false;
  const workspaceContext = selectedQuote
    ? `${selectedQuote.title || "Untitled"} · v${selectedQuote.version}`
    : "New quote draft";
  const workspaceContextLabel = !selectedQuote
    ? "Creating"
    : isEditingDraft
      ? "Editing"
      : "Viewing";
  const workspaceBadgeLabel = !selectedQuote
    ? "CREATING"
    : isEditingDraft && !isReadOnly
      ? "EDITING"
      : "READ-ONLY";
  const workspaceBadgeClass = !selectedQuote
    ? styles.statusDraft
    : isEditingDraft && !isReadOnly
      ? styles.statusDraft
      : statusClasses[selectedQuote.status] ?? styles.statusArchived;

  // -------------------------------------------------------------------------
  // Display helpers
  // -------------------------------------------------------------------------

  /** Resolve a status value to its human-readable label. */
  function formatQuoteStatus(status?: string): string {
    if (!status) {
      return "";
    }
    return statusLabelByValue[status] ?? status;
  }

  /** Determine the quick-action kind for a given quote status (CO link or revision clone). */
  function quickActionKindForStatus(status: string): "change_order" | "revision" | null {
    return quoteQuickActionByStatus[status] ?? null;
  }

  function quickActionTitleForStatus(status: string): string {
    const kind = quickActionKindForStatus(status);
    if (kind === "change_order") {
      return "View change orders for this quote";
    }
    if (kind === "revision") {
      return "Duplicate as new";
    }
    return "";
  }

  // -------------------------------------------------------------------------
  // Data loading & form hydration
  // -------------------------------------------------------------------------

  /** Pre-fill the create form from an existing quote (duplicate-as-new). */
  function handleDuplicateAsNew(sourceQuote: QuoteRecord) {
    formFields.populateCreateFromQuote(sourceQuote);
    setSelectedQuoteId("");
    selectedQuoteIdRef.current = "";
    // Copy billing periods from the source quote
    const periods = sourceQuote.billing_periods ?? [];
    setBillingPeriods(
      periods.map((r) => ({
        localId: billingPeriodsNextId.current++,
        description: r.description,
        percent: r.percent,
        dueDate: r.due_date || "",
      })),
    );
    flashCreator();
  }

  /** Route the quick-action click for a family card to CO navigation or duplicate. */
  function handleFamilyCardQuickAction(sourceQuote: QuoteRecord) {
    const actionKind = quickActionKindForStatus(sourceQuote.status);
    if (!actionKind) {
      return;
    }
    if (actionKind === "change_order") {
      if (!selectedProjectId) {
        setActionMessage("Select a project first.");
        return;
      }
      router.push(`/projects/${selectedProjectId}/change-orders?origin_quote=${sourceQuote.id}`);
      return;
    }
    handleDuplicateAsNew(sourceQuote);
  }

  const lineTotals = useMemo(() => lineItems.map(computeLineTotal), [lineItems]);

  const lineValidation = useMemo(() => validateQuoteLineItems(lineItems), [lineItems]);
  const subtotal = lineTotals.reduce((sum, value) => sum + value, 0);
  const taxRate = toNumber(formFields.taxPercent);
  const taxableBase = lineTotals.reduce((sum, value, index) => {
    const cc = costCodes.find((c) => String(c.id) === lineItems[index].costCodeId);
    return sum + (cc?.taxable !== false ? value : 0);
  }, 0);
  const contingencyRate = toNumber(formFields.contingencyPercent);
  const contingencyAmount = subtotal * (contingencyRate / 100);
  const overheadProfitRate = toNumber(formFields.overheadProfitPercent);
  const overheadProfitAmount = subtotal * (overheadProfitRate / 100);
  const insuranceRate = toNumber(formFields.insurancePercent);
  const insuranceAmount = subtotal * (insuranceRate / 100);
  const taxAmount = taxableBase * (taxRate / 100);
  const totalAmount = subtotal + contingencyAmount + overheadProfitAmount + insuranceAmount + taxAmount;
  const quoteFamilies = useMemo(() => groupQuoteFamilies(quotes), [quotes]);
  const quoteStatusCounts = useMemo(() => computeQuoteStatusCounts(quoteFamilies), [quoteFamilies]);
  const visibleQuoteFamilies = useMemo(
    () => filterVisibleFamilies(quoteFamilies, quoteStatusFilters),
    [quoteFamilies, quoteStatusFilters],
  );


  const loadQuoteIntoForm = formFields.hydrateFromQuote;

  const handleSelectQuote = useCallback((quote: QuoteRecord) => {
    const nextQuoteId = String(quote.id);
    const isSameQuote = nextQuoteId === selectedQuoteIdRef.current;
    setSelectedQuoteId(nextQuoteId);
    setSelectedStatus("");
    if (!isSameQuote) {
      setStatusEvents([]);
    }
    setFormErrorMessage("");
    setFormSuccessMessage("");
    setActionMessage("");
    formFields.setFamilyCollisionPrompt(null);
    formFields.setConfirmedFamilyTitleKey("");
    loadQuoteIntoForm(quote);
    formFields.setTitleLocked(false);
    // Hydrate billing periods from the quote payload
    const periods = quote.billing_periods ?? [];
    setBillingPeriods(
      periods.map((r) => ({
        localId: billingPeriodsNextId.current++,
        description: r.description,
        percent: r.percent,
        dueDate: r.due_date || "",
      })),
    );
  }, [loadQuoteIntoForm]);

  // Keep the ref in sync so async callbacks always see the latest selection.
  useEffect(() => {
    selectedQuoteIdRef.current = selectedQuoteId;
  }, [selectedQuoteId]);

  // Keep the ref in sync so filter-aware data loads use the latest value.
  useEffect(() => {
    quoteStatusFiltersRef.current = quoteStatusFilters;
  }, [quoteStatusFilters]);


  const clearSelectedQuoteState = useCallback(() => {
    setSelectedQuoteId("");
    selectedQuoteIdRef.current = "";
    setSelectedStatus("");
    setStatusNote("");
    setStatusEvents([]);
    formFields.resetFormFields();
    setBillingPeriods(defaultBillingPeriod());
  }, [formFields.resetFormFields]);

  /** Reset the composer to a blank draft. */
  function startNewQuote() {
    clearSelectedQuoteState();
    setActionMessage("");
    setFormErrorMessage("");
    setFormSuccessMessage("");
    flashCreator();
  }

  /** Select the latest version of a family and toggle its history expansion. */
  function handleSelectFamilyLatest(title: string, latest: QuoteRecord) {
    handleSelectQuote(latest);
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
        setActionMessage(readQuoteApiError(projectsJson, "Failed loading projects."));
        return;
      }
      if (!codesRes.ok) {
        setActionMessage(readQuoteApiError(codesJson, "Failed loading cost codes."));
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
        formFields.setTermsText((current) => current || organizationData.quote_terms_and_conditions || "");
        formFields.setValidThrough((current) => {
          if (selectedQuoteIdRef.current || current) {
            return current;
          }
          const quoteDateSeed = todayDateInput();
          return addDaysToDateInput(
            quoteDateSeed,
            resolveQuoteValidationDeltaDays(organizationData),
          );
        });
        // Seed default billing period if starting fresh (no quote selected)
        if (!selectedQuoteIdRef.current) {
          setBillingPeriods(defaultBillingPeriod(organizationData.default_invoice_due_delta));
        }
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

  const loadQuotes = useCallback(async (options?: LoadQuotesOptions) => {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      if (!options?.quiet) {
        setActionMessage("Select a project first.");
      }
      return;
    }

    if (!options?.preserveSelection) {
      clearSelectedQuoteState();
    }
    setFormErrorMessage("");
    setFormSuccessMessage("");
    if (!options?.quiet) {
      setActionMessage("");
    }

    try {
      const response = await fetch(`${apiBaseUrl}/projects/${projectId}/quotes/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();

      if (!response.ok) {
        if (!options?.quiet) {
          setActionMessage(readQuoteApiError(payload, "Failed loading quotes."));
        }
        return;
      }

      const rows = (payload.data as QuoteRecord[]) ?? [];
      setQuotes(rows);

      if (!rows[0]) {
        return;
      }

      // Use the explicitly requested quote if provided, otherwise fall back
      // to the currently selected quote when preserving selection (e.g. after
      // a status transition that reloads the list but should keep focus).
      const preferredId =
        options?.preferredQuoteId ??
        (options?.preserveSelection && /^\d+$/.test(selectedQuoteIdRef.current)
          ? Number(selectedQuoteIdRef.current)
          : null);

      const autoSelected = resolveAutoSelectQuote(
        rows,
        quoteStatusFiltersRef.current,
        { preferredId, scopedId: scopedQuoteId },
      );

      if (autoSelected) {
        handleSelectQuote(autoSelected);
      }
    } catch {
      if (!options?.quiet) {
        setActionMessage("Could not reach quote endpoint.");
      }
    }
  }, [
    clearSelectedQuoteState,
    handleSelectQuote,
    apiBaseUrl,
    scopedQuoteId,
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

  // Reload quotes when the selected project changes.
  useEffect(() => {
    if (!authToken || !selectedProjectId) {
      return;
    }
    void loadQuotes();
  }, [loadQuotes, selectedProjectId, authToken]);

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
    if (formErrorMessage === QUOTE_MIN_LINE_ITEMS_ERROR) setFormErrorMessage("");
    addLineRaw();
  }

  function removeLineItem(localId: number) {
    if (!removeLineRaw(localId)) {
      setFormErrorMessage(QUOTE_MIN_LINE_ITEMS_ERROR);
      setFormSuccessMessage("");
    }
  }

  function updateLineItem(
    localId: number,
    key: keyof Omit<QuoteLineInput, "localId">,
    value: string,
  ) {
    setFormErrorMessage("");
    setFormSuccessMessage("");
    updateLineRaw(localId, { [key]: value });
  }

  const canCreateQuote = useMemo(
    () => canMutateQuotes && !isProjectTerminal && Boolean(selectedProjectId) && lineItems.length > 0,
    [canMutateQuotes, isProjectTerminal, lineItems.length, selectedProjectId],
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

    const billing_periods = billingPeriods.map((p, i) => ({
      description: p.description,
      percent: p.percent,
      due_date: p.dueDate || null,
      order: i,
    }));

    return { line_items: orderedLineItems, sections, billing_periods };
  }

  async function submitNewQuoteWithTitle({
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
      const { line_items, sections, billing_periods } = buildOrderedPayload();
      const response = await fetch(`${apiBaseUrl}/projects/${projectId}/quotes/`, {
        method: "POST",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({
          title,
          allow_existing_title_family: allowExistingTitleFamily,
          valid_through: formFields.validThrough || null,
          tax_percent: formFields.taxPercent,
          contingency_percent: formFields.contingencyPercent,
          overhead_profit_percent: formFields.overheadProfitPercent,
          insurance_percent: formFields.insurancePercent,
          notes_text: formFields.notesText,
          line_items,
          sections,
          billing_periods,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        if (response.status === 409 && payload.error?.code === "quote_family_exists") {
          const conflictMeta = payload.error?.meta ?? {};
          formFields.setFamilyCollisionPrompt({
            title,
            latestQuoteId:
              typeof conflictMeta.latest_quote_id === "number"
                ? conflictMeta.latest_quote_id
                : null,
            latestVersion:
              typeof conflictMeta.latest_version === "number" ? conflictMeta.latest_version : null,
            familySize: typeof conflictMeta.family_size === "number" ? conflictMeta.family_size : null,
          });
          formFields.setConfirmedFamilyTitleKey("");
        } else if (
          response.status === 409 &&
          payload.error?.code === "quote_family_approved_locked"
        ) {
          formFields.setFamilyCollisionPrompt(null);
          formFields.setConfirmedFamilyTitleKey("");
        }
        setFormErrorMessage(
          readQuoteApiError(payload, "Create quote failed. Check values and try again."),
        );
        return;
      }
      const created = payload.data as QuoteRecord;
      setQuotes((current) => [created, ...current]);
      setIsViewerExpanded(true);
      handleSelectQuote(created);
      setStatusEvents([]);
      setFormErrorMessage("");
      setFormSuccessMessage(`Created ${created.title || "Untitled"} v${created.version}.`);
      loadQuoteIntoForm(created);
      formFields.setFamilyCollisionPrompt(null);
      formFields.setConfirmedFamilyTitleKey("");
      flashCreator();
    } catch {
      setFormErrorMessage("Could not reach quote create endpoint.");
    } finally {
      formFields.submitGuard.current = false;
      formFields.setIsSubmitting(false);
    }
  }

  /** Handle form submission for creating a new quote or saving a draft. */
  async function handleCreateQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormErrorMessage("");
    setFormSuccessMessage("");
    if (formFields.submitGuard.current) {
      return;
    }
    if (!canMutateQuotes) {
      setFormErrorMessage(`Role ${role} is read-only for quote mutations.`);
      return;
    }
    if (isReadOnly) {
      setFormErrorMessage("This quote is read-only. Duplicate as new or start a fresh draft to edit.");
      return;
    }
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setFormErrorMessage("Select a project first.");
      return;
    }

    const trimmedTitle = formFields.quoteTitle.trim();
    if (!trimmedTitle) {
      setFormErrorMessage("Quote title is required.");
      return;
    }

    const hasMissingCostCode = lineItems.some((line) => !line.costCodeId);
    if (hasMissingCostCode) {
      setFormErrorMessage("Every line item must have a cost code.");
      return;
    }

    if (isEditingDraft && selectedQuote) {
      setActionMessage("");
      formFields.submitGuard.current = true;
      formFields.setIsSubmitting(true);
      try {
        const { line_items, sections, billing_periods } = buildOrderedPayload();
        const response = await fetch(`${apiBaseUrl}/quotes/${selectedQuote.id}/`, {
          method: "PATCH",
          headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
          body: JSON.stringify({
            title: trimmedTitle,
            valid_through: formFields.validThrough || null,
            tax_percent: formFields.taxPercent,
            contingency_percent: formFields.contingencyPercent,
            overhead_profit_percent: formFields.overheadProfitPercent,
            insurance_percent: formFields.insurancePercent,
            notes_text: formFields.notesText,
            line_items,
            sections,
            billing_periods,
          }),
        });
        const payload: ApiResponse = await response.json();
        if (!response.ok) {
          setFormErrorMessage(
            readQuoteApiError(payload, "Save draft failed. Check values and try again."),
          );
          return;
        }
        const updated = payload.data as QuoteRecord;
        setQuotes((current) =>
          current.map((quote) => (quote.id === updated.id ? updated : quote)),
        );
        loadQuoteIntoForm(updated);
        setFormErrorMessage("");
        setFormSuccessMessage(`Saved draft ${updated.title || "Untitled"} v${updated.version}.`);
        flashCreator();
      } catch {
        setFormErrorMessage("Could not reach quote update endpoint.");
      } finally {
        formFields.submitGuard.current = false;
        formFields.setIsSubmitting(false);
      }
      return;
    }

    const normalizedTitle = normalizeFamilyTitle(trimmedTitle);
    const existingFamily = quoteFamilies.find(
      (family) => normalizeFamilyTitle(family.title) === normalizedTitle,
    );
    const familyHasApprovedVersion = Boolean(
      existingFamily?.items.some((quote) => quote.status === "approved"),
    );
    const promptMatchesCurrentTitle =
      formFields.familyCollisionPrompt &&
      normalizeFamilyTitle(formFields.familyCollisionPrompt.title) === normalizedTitle;
    if (existingFamily && familyHasApprovedVersion) {
      formFields.setConfirmedFamilyTitleKey("");
      formFields.setFamilyCollisionPrompt(null);
      setFormErrorMessage(
        `The quote family "${existingFamily.title}" is locked because it already has an approved version. Use a new title or create a change order instead.`,
      );
      return;
    }
    // When title is locked (duplicate-as-new), skip the family collision prompt —
    // the user explicitly chose to create a new version in this family.
    if (existingFamily && formFields.titleLocked) {
      await submitNewQuoteWithTitle({
        projectId,
        title: trimmedTitle,
        allowExistingTitleFamily: true,
      });
      return;
    }
    if (existingFamily && formFields.confirmedFamilyTitleKey !== normalizedTitle) {
      if (promptMatchesCurrentTitle) {
        await submitNewQuoteWithTitle({
          projectId,
          title: trimmedTitle,
          allowExistingTitleFamily: true,
        });
        return;
      }
      const latest = existingFamily.items[existingFamily.items.length - 1];
      formFields.setFamilyCollisionPrompt({
        title: existingFamily.title,
        latestQuoteId: latest?.id ?? null,
        latestVersion: latest?.version ?? null,
        familySize: existingFamily.items.length,
      });
      setFormErrorMessage(
        `An quote family named "${existingFamily.title}" already exists. Confirm to create a new version in that family.`,
      );
      return;
    }

    await submitNewQuoteWithTitle({
      projectId,
      title: trimmedTitle,
      allowExistingTitleFamily: Boolean(existingFamily),
    });
  }

  /** Duplicate the currently selected quote into the create form. */
  function handleDuplicateSelectedQuote() {
    if (!selectedQuote) {
      setActionMessage("Select an quote first.");
      return;
    }
    handleDuplicateAsNew(selectedQuote);
  }

  /** Apply a status transition to the selected quote. Returns the updated record on success, null on failure. */
  async function handleUpdateQuoteStatus(notifyCustomer = true): Promise<QuoteRecord | null> {
    const quoteId = Number(selectedQuoteId);
    if (!quoteId) {
      setActionMessage("Select an quote first.");
      return null;
    }

    setActionMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/quotes/${quoteId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({ status: selectedStatus, status_note: statusNote, notify_customer: notifyCustomer }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setActionMessage(readQuoteApiError(payload, "Status update failed."));
        setActionTone("error");
        return null;
      }
      const updated = payload.data as QuoteRecord;
      const scrollY = window.scrollY;
      setQuotes((current) =>
        current.map((quote) => {
          if (quote.id === updated.id) return updated;
          return quote;
        }),
      );
      requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
      setSelectedStatus("");
      setStatusNote("");
      await loadStatusEvents({ quoteId: updated.id, quiet: true });
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
      setActionMessage("Could not reach quote status endpoint.");
      setActionTone("error");
      return null;
    }
  }

  /** Append a status note without changing the quote's current status. */
  async function handleAddQuoteStatusNote() {
    const quoteId = Number(selectedQuoteId);
    if (!quoteId) {
      setActionMessage("Select an quote first.");
      return;
    }
    if (!statusNote.trim()) {
      setActionMessage("Enter a status note first.");
      return;
    }

    setActionMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/quotes/${quoteId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({ status_note: statusNote }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setActionMessage(readQuoteApiError(payload, "Status note update failed."));
        setActionTone("error");
        return;
      }
      const updated = payload.data as QuoteRecord;
      const scrollY = window.scrollY;
      setQuotes((current) =>
        current.map((quote) => (quote.id === updated.id ? updated : quote)),
      );
      requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
      setSelectedStatus("");
      setStatusNote("");
      await loadStatusEvents({ quoteId: updated.id, quiet: true });
      setActionMessage(`Added status note on ${updated.title || "Untitled"} v${updated.version}. History updated.`);
      setActionTone("success");
    } catch {
      setActionMessage("Could not reach quote status note endpoint.");
      setActionTone("error");
    }
  }

  const loadStatusEvents = useCallback(
    async (options?: { quoteId?: number; quiet?: boolean }) => {
      const quoteId = options?.quoteId ?? Number(selectedQuoteId);
      const quiet = options?.quiet ?? false;
      if (!quoteId) {
        if (!quiet) {
          setActionMessage("Select an quote first.");
        }
        return;
      }

      try {
        const response = await fetch(`${apiBaseUrl}/quotes/${quoteId}/status-events/`, {
          headers: buildAuthHeaders(authToken),
        });
        const payload: ApiResponse = await response.json();
        if (!response.ok) {
          if (!quiet) {
            setActionMessage(readQuoteApiError(payload, "Failed loading status events."));
          }
          return;
        }
        const rows = (payload.data as QuoteStatusEventRecord[]) ?? [];
        setStatusEvents(rows);
      } catch {
        if (!quiet) {
          setActionMessage("Could not reach status events endpoint.");
        }
      }
    },
    [apiBaseUrl, selectedQuoteId, authToken],
  );

  // Load status events whenever the selected quote changes.
  useEffect(() => {
    if (!authToken || !selectedQuoteId) {
      return;
    }
    void loadStatusEvents({ quiet: true });
  }, [loadStatusEvents, selectedQuoteId, authToken]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <section className={styles.console}>
      <QuotesViewerPanel
        selectedProject={selectedProject}
        isMobile={isMobile}
        isViewerExpanded={isViewerExpanded}
        setIsViewerExpanded={setIsViewerExpanded}
        viewerStatusOptions={viewerStatusOptions}
        quoteStatusFilters={quoteStatusFilters}
        toggleQuoteStatusFilter={toggleQuoteStatusFilter}
        quoteStatusCounts={quoteStatusCounts}
        setQuoteStatusFilters={setQuoteStatusFilters}
        quoteStatusFilterValues={quoteStatusFilterValues}
        defaultQuoteStatusFilters={defaultQuoteStatusFilters}
        visibleQuoteFamilies={visibleQuoteFamilies}
        quoteFamiliesLength={quoteFamilies.length}
        selectedQuoteId={selectedQuoteId}
        openFamilyHistory={openFamilyHistory}
        handleSelectFamilyLatest={handleSelectFamilyLatest}
        handleSelectQuote={handleSelectQuote}
        handleFamilyCardQuickAction={handleFamilyCardQuickAction}
        selectedProjectId={selectedProjectId}
        formatQuoteStatus={formatQuoteStatus}
        quickActionKindForStatus={quickActionKindForStatus}
        quickActionTitleForStatus={quickActionTitleForStatus}
        selectedQuote={selectedQuote}
        nextStatusOptions={nextStatusOptions}
        selectedStatus={selectedStatus}
        setSelectedStatus={setSelectedStatus}
        statusNote={statusNote}
        setStatusNote={setStatusNote}
        actionMessage={actionMessage}
        actionTone={actionTone}
        canSubmitStatusNote={canSubmitStatusNote}
        handleUpdateQuoteStatus={handleUpdateQuoteStatus}
        handleAddQuoteStatusNote={handleAddQuoteStatusNote}
        statusEvents={statusEvents}
        authToken={authToken}
        readOnly={!canMutateQuotes}
        onContractPdfUpdate={(newUrl) => {
          if (!selectedQuote) return;
          const updated = { ...selectedQuote, contract_pdf_url: newUrl };
          setQuotes((current) =>
            current.map((e) => (e.id === updated.id ? updated : e)),
          );
          void loadStatusEvents({ quoteId: selectedQuote.id, quiet: true });
        }}
      />

      <QuotesWorkspacePanel
        workspaceContextLabel={workspaceContextLabel}
        workspaceContext={workspaceContext}
        workspaceBadgeClass={workspaceBadgeClass}
        workspaceBadgeLabel={workspaceBadgeLabel}
        selectedQuote={selectedQuote}
        onStartNew={startNewQuote}
        onDuplicateAsNew={handleDuplicateSelectedQuote}
        actionMessage={actionMessage}
        actionTone={actionTone}
        titleLocked={formFields.titleLocked}
        duplicateHint={formFields.duplicateHint}
        selectedProject={selectedProject}
        familyCollisionPrompt={formFields.familyCollisionPrompt}
        quoteTitle={formFields.quoteTitle}
        selectedProjectId={selectedProjectId}
        onConfirmCollision={(projectId, title) => {
          formFields.setConfirmedFamilyTitleKey(normalizeFamilyTitle(title));
          formFields.setFamilyCollisionPrompt(null);
          void submitNewQuoteWithTitle({
            projectId,
            title,
            allowExistingTitleFamily: true,
          });
        }}
        onDismissCollision={() => {
          formFields.setConfirmedFamilyTitleKey("");
          formFields.setFamilyCollisionPrompt(null);
        }}
        canMutateQuotes={canMutateQuotes}
        role={role}
        quoteComposerRef={quoteComposerRef}
        sheetRef={sheetRef}
        organizationDefaults={organizationDefaults}
        quoteId={selectedQuoteId}
        quoteDate={formFields.quoteDate}
        validThrough={formFields.validThrough}
        termsText={formFields.termsText}
        notesText={formFields.notesText}
        taxPercent={formFields.taxPercent}
        contingencyPercent={formFields.contingencyPercent}
        contingencyAmount={contingencyAmount}
        overheadProfitPercent={formFields.overheadProfitPercent}
        overheadProfitAmount={overheadProfitAmount}
        insurancePercent={formFields.insurancePercent}
        insuranceAmount={insuranceAmount}
        lineItems={lineItems}
        lineTotals={lineTotals}
        subtotal={subtotal}
        taxAmount={taxAmount}
        totalAmount={totalAmount}
        costCodes={costCodes}
        canSubmit={canCreateQuote}
        isSubmitting={formFields.isSubmitting}
        isEditingDraft={isEditingDraft}
        readOnly={isReadOnly}
        formErrorMessage={formErrorMessage}
        formSuccessMessage={formSuccessMessage}
        lineValidation={lineValidation}
        apiSections={selectedQuote?.sections}
        billingPeriods={billingPeriods}
        onBillingPeriodsChange={setBillingPeriods}
        onTitleChange={formFields.handleQuoteTitleChange}
        onValidThroughChange={formFields.setValidThrough}
        onTaxPercentChange={formFields.setTaxPercent}
        onContingencyPercentChange={formFields.setContingencyPercent}
        onOverheadProfitPercentChange={formFields.setOverheadProfitPercent}
        onInsurancePercentChange={formFields.setInsurancePercent}
        onNotesTextChange={formFields.setNotesText}
        onLineItemChange={updateLineItem}
        onAddLineItem={addLineItem}
        onRemoveLineItem={removeLineItem}
        onSubmit={handleCreateQuote}
      />
    </section>
  );
}
