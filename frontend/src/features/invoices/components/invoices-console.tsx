"use client";

/**
 * Primary invoice management console.
 * Combines project selection, invoice list with status filtering, status lifecycle management
 * (transitions, notes, history), and a document-creator workspace for creating/editing drafts.
 */

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { formatDateDisplay, formatDateTimeDisplay, todayDateInput, futureDateInput } from "@/shared/date-format";
import { parseAmount, formatDecimal } from "@/shared/money-format";
import { readApiErrorMessage } from "@/shared/api/error";
import { ProjectListStatusValue, ProjectListViewer } from "@/shared/project-list-viewer";
import {
  defaultApiBaseUrl,
  fetchInvoicePolicyContract,
  normalizeApiBaseUrl,
} from "../api";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import { hasAnyRole } from "../../session/rbac";
import {
  ApiResponse,
  InvoiceLineInput,
  InvoicePolicyContract,
  InvoiceRecord,
  InvoiceStatusEventRecord,
  OrganizationInvoiceDefaults,
  ProjectRecord,
} from "../types";
import { DocumentCreator } from "@/shared/document-creator";
import {
  resolveOrganizationBranding,
} from "@/shared/document-creator";
import {
  createInvoiceDocumentAdapter,
  InvoiceFormState,
  toInvoiceStatusPolicy,
} from "../document-adapter";
import { useStatusMessage } from "@/shared/hooks/use-status-message";
import styles from "./invoices-console.module.css";
import creatorStyles from "@/shared/document-creator/creator-foundation.module.css";
import invoiceCreatorStyles from "@/shared/document-creator/invoice-creator.module.css";
import { collapseToggleButtonStyles as collapseButtonStyles } from "@/shared/project-list-viewer";
type ProjectStatusValue = ProjectListStatusValue;
type ProjectBudgetRecord = {
  id: number;
  status: string;
  source_estimate: number | null;
  source_estimate_version?: number | null;
  baseline_snapshot_json?: {
    estimate?: {
      title?: string;
    };
    line_items?: Array<{
      scope_item_id?: number | null;
      quantity?: string | number;
      unit_cost?: string | number;
      line_total?: string | number;
    }>;
  };
  line_items?: Array<{
    id: number;
    scope_item: number | null;
    cost_code_code: string;
    description: string;
    budget_amount?: string;
    remaining_billable?: string;
  }>;
};
type BudgetLineOption = {
  id: number;
  scopeItemId: number | null;
  costCodeCode: string;
  description: string;
  label: string;
  groupLabel: string;
  defaultQuantity: string;
  defaultUnitPrice: string;
  remainingBillable: string;
};

const INVOICE_STATUSES_FALLBACK = ["draft", "sent", "partially_paid", "paid", "void"];

const INVOICE_STATUS_LABELS_FALLBACK: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_paid: "Partially Paid",
  paid: "Paid",
  void: "Void",
};

const INVOICE_ALLOWED_STATUS_TRANSITIONS_FALLBACK: Record<string, string[]> = {
  draft: ["sent", "void"],
  sent: ["partially_paid", "paid", "void"],
  partially_paid: ["paid"],
  paid: [],
  void: [],
};

const INVOICE_DEFAULT_STATUS_FILTERS_FALLBACK = ["draft", "sent", "partially_paid"];
const INVOICE_TERMINAL_STATUSES_FALLBACK = ["paid", "partially_paid", "void"];
const INVOICE_MIN_LINE_ITEMS_ERROR = "At least one line item is required.";
const DEFAULT_PROJECT_STATUS_FILTERS: ProjectStatusValue[] = ["active", "prospect"];
const PROJECT_STATUS_VALUES: ProjectStatusValue[] = ["prospect", "active", "on_hold", "completed", "cancelled"];
const GENERIC_BUDGET_COST_CODES = new Set(["99-901", "99-902", "99-903"]);

/** Compute a due date by adding dueDays to a given issue date. */
function dueDateFromIssueDate(issueDate: string, dueDays: number) {
  const base = issueDate ? new Date(`${issueDate}T00:00:00`) : new Date();
  const safeDueDays = Number.isFinite(dueDays) ? Math.max(1, Math.min(365, Math.round(dueDays))) : 30;
  base.setDate(base.getDate() + safeDueDays);
  return base.toISOString().slice(0, 10);
}

/** Normalize a number to a two-decimal string, returning a fallback for non-finite values. */
function normalizeDecimalInput(value: number, fallback = "0"): string {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return value.toFixed(2);
}

/** Create a blank scope line item with sensible defaults for the creator workspace. */
function emptyLine(localId: number, defaultBudgetLineId = ""): InvoiceLineInput {
  return {
    localId,
    lineType: "scope",
    budgetLineId: defaultBudgetLineId,
    adjustmentReason: "",
    internalNote: "",
    description: "Invoice scope item",
    quantity: "1",
    unit: "ea",
    unitPrice: "0",
  };
}

/** Resolve a display label for an invoice status using the static fallback map. */
function invoiceStatusLabel(status: string): string {
  return INVOICE_STATUS_LABELS_FALLBACK[status] ?? status;
}

/** Build the public-facing route for a customer to view their invoice. */
function publicInvoiceHref(publicRef?: string): string {
  if (!publicRef) {
    return "";
  }
  return `/invoice/${publicRef}`;
}

/** Return a contextual hint about the next workflow action for a given invoice status. */
function invoiceNextActionHint(status: string): string {
  if (status === "draft") {
    return "Next: send the invoice to move it into billable AR tracking.";
  }
  if (status === "sent") {
    return "Next: record payments to move invoice to partially paid or paid.";
  }
  if (status === "partially_paid") {
    return "Next: allocate remaining payment and close the outstanding balance.";
  }
  if (status === "paid") {
    return "Invoice is fully settled.";
  }
  if (status === "void") {
    return "Invoice is void and no longer billable.";
  }
  return "Select a status transition as needed.";
}

/** Map an invoice status to its CSS module class for badge coloring. */
function invoiceStatusClass(status: string): string {
  if (status === "draft") {
    return styles.statusDraft;
  }
  if (status === "sent") {
    return styles.statusSent;
  }
  if (status === "partially_paid") {
    return styles.statusPartial;
  }
  if (status === "paid") {
    return styles.statusPaid;
  }
  if (status === "void") {
    return styles.statusVoid;
  }
  return "";
}

/** Map an invoice status to its tone class for inline status accents. */
function invoiceStatusToneClass(status: string): string {
  if (status === "draft") {
    return styles.statusToneDraft;
  }
  if (status === "sent") {
    return styles.statusToneSent;
  }
  if (status === "partially_paid") {
    return styles.statusTonePartial;
  }
  if (status === "paid") {
    return styles.statusTonePaid;
  }
  if (status === "void") {
    return styles.statusToneVoid;
  }
  return "";
}

/** Map an invoice status to its card-level CSS class for list card border/accent. */
function invoiceCardStatusClass(status: string): string {
  if (status === "draft") {
    return styles.invoiceCardStatusDraft;
  }
  if (status === "sent") {
    return styles.invoiceCardStatusSent;
  }
  if (status === "partially_paid") {
    return styles.invoiceCardStatusPartial;
  }
  if (status === "paid") {
    return styles.invoiceCardStatusPaid;
  }
  if (status === "void") {
    return styles.invoiceCardStatusVoid;
  }
  return "";
}

/** Predict the next sequential invoice number (INV-XXXX) for pre-filling the workspace. */
function nextInvoiceNumberPreview(rows: InvoiceRecord[]): string {
  const usedNumbers = new Set<number>();
  let digitWidth = 4;
  for (const row of rows) {
    const match = row.invoice_number.match(/^INV-(\d+)$/i);
    if (!match) {
      continue;
    }
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) {
      usedNumbers.add(value);
      digitWidth = Math.max(digitWidth, match[1].length);
    }
  }
  let nextNumber = rows.length + 1;
  while (usedNumbers.has(nextNumber)) {
    nextNumber += 1;
  }
  return `INV-${String(nextNumber).padStart(digitWidth, "0")}`;
}

/** Derive a human-readable action label for a status history event row. */
function invoiceStatusEventActionLabel(
  event: InvoiceStatusEventRecord,
  statusLabel: (status: string) => string,
): string {
  if (event.action_type === "notate") {
    return "Notated";
  }
  if (event.action_type === "resend") {
    return "Re-sent";
  }
  if (event.action_type === "create") {
    return "Created";
  }
  if (event.from_status === "sent" && event.to_status === "sent") {
    return "Re-sent";
  }
  if (event.from_status === event.to_status && (event.note || "").trim()) {
    return "Notated";
  }
  if (!event.from_status) {
    return `Created as ${statusLabel(event.to_status)}`;
  }
  return `${statusLabel(event.from_status)} to ${statusLabel(event.to_status)}`;
}

/** Map a status event to its visual tone class for the history timeline. */
function invoiceStatusEventToneClass(event: InvoiceStatusEventRecord): string {
  if (event.action_type === "resend" || (event.from_status === "sent" && event.to_status === "sent")) {
    return styles.statusToneSent;
  }
  if (event.action_type === "notate" || (event.from_status === event.to_status && (event.note || "").trim())) {
    return styles.statusToneNotate;
  }
  return invoiceStatusToneClass(event.to_status);
}

/** Pick the most likely next status to pre-select in the status picker for an invoice. */
function resolvePreferredStatusSelection(
  invoice: InvoiceRecord | null,
  transitions: Record<string, string[]>,
): string {
  if (!invoice) {
    return "draft";
  }
  const nextStatuses = [...(transitions[invoice.status] ?? [])];
  if (invoice.status === "sent" && !nextStatuses.includes("sent")) {
    nextStatuses.unshift("sent");
  }
  return nextStatuses[0] ?? invoice.status;
}

function readApiError(payload: ApiResponse | undefined, fallback: string): string {
  const message = readApiErrorMessage(payload, fallback);
  if (/invalid .*status transition/i.test(message) && !/refresh/i.test(message)) {
    return `${message} This invoice may have changed from a client action on the public page. Refresh to load the latest status.`;
  }
  return message;
}

/** Convert a snake_case project status to a display-friendly label. */
function projectStatusLabel(statusValue: string): string {
  return statusValue.replace("_", " ");
}

/** Primary invoice management console with project selection, invoice viewer, and creator workspace. */
export function InvoicesConsole() {
  const { token, authMessage, role } = useSharedSessionAuth();
  const canMutateInvoices = hasAnyRole(role, ["owner", "pm", "bookkeeping"]);
  const canEditInvoiceWorkspace = canMutateInvoices;

  const searchParams = useSearchParams();
  const scopedProjectIdParam = searchParams.get("project");
  const scopedProjectId =
    scopedProjectIdParam && /^\d+$/.test(scopedProjectIdParam) ? Number(scopedProjectIdParam) : null;

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);

  const { message: statusMessage, tone: statusTone, setNeutral: setNeutralStatus, setSuccess: setSuccessStatus, setError: setErrorStatus, setMessage: setStatusMessage, clear: clearStatus } = useStatusMessage();
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatusFilters, setProjectStatusFilters] = useState<ProjectStatusValue[]>(
    DEFAULT_PROJECT_STATUS_FILTERS,
  );
  const [isProjectListExpanded, setIsProjectListExpanded] = useState(true);
  const [isInvoiceViewerExpanded, setIsInvoiceViewerExpanded] = useState(true);
  const [isStatusSectionOpen, setIsStatusSectionOpen] = useState(true);
  const [isHistorySectionOpen, setIsHistorySectionOpen] = useState(false);
  const [isLineItemsSectionOpen, setIsLineItemsSectionOpen] = useState(false);
  const [viewerActionMessage, setViewerActionMessage] = useState("");
  const [viewerActionTone, setViewerActionTone] = useState<"success" | "error">("success");
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [hasAutoSelectedProjectWithInvoices, setHasAutoSelectedProjectWithInvoices] = useState(false);

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [budgetLineOptions, setBudgetLineOptions] = useState<BudgetLineOption[]>([]);

  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [selectedInvoiceStatusEvents, setSelectedInvoiceStatusEvents] = useState<
    InvoiceStatusEventRecord[]
  >([]);
  const [statusEventsLoading, setStatusEventsLoading] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("draft");
  const [invoiceStatuses, setInvoiceStatuses] = useState<string[]>(INVOICE_STATUSES_FALLBACK);
  const [invoiceStatusLabels, setInvoiceStatusLabels] = useState<Record<string, string>>(
    INVOICE_STATUS_LABELS_FALLBACK,
  );
  const [invoiceAllowedStatusTransitions, setInvoiceAllowedStatusTransitions] = useState<
    Record<string, string[]>
  >(INVOICE_ALLOWED_STATUS_TRANSITIONS_FALLBACK);
  const [invoiceStatusFilters, setInvoiceStatusFilters] = useState<string[]>(
    INVOICE_DEFAULT_STATUS_FILTERS_FALLBACK,
  );
  const [statusNote, setStatusNote] = useState("");
  const [organizationInvoiceDefaults, setOrganizationInvoiceDefaults] = useState<OrganizationInvoiceDefaults | null>(null);

  const [issueDate, setIssueDate] = useState(todayDateInput());
  const [dueDate, setDueDate] = useState(futureDateInput());
  const [taxPercent, setTaxPercent] = useState("0");
  const [termsText, setTermsText] = useState("");
  const [lineItems, setLineItems] = useState<InvoiceLineInput[]>([emptyLine(1)]);
  const [nextLineId, setNextLineId] = useState(2);
  const [workspaceSourceInvoiceId, setWorkspaceSourceInvoiceId] = useState<number | null>(null);
  const [editingDraftInvoiceId, setEditingDraftInvoiceId] = useState<number | null>(null);
  const [workspaceContext, setWorkspaceContext] = useState("New invoice draft");
  const invoiceCreatorRef = useRef<HTMLDivElement | null>(null);
  const [creatorFlashCount, setCreatorFlashCount] = useState(0);

  useEffect(() => {
    if (creatorFlashCount === 0) return;
    const el = invoiceCreatorRef.current;
    if (!el) return;
    el.classList.remove(creatorStyles.sheetFlash);
    void el.offsetWidth;
    el.classList.add(creatorStyles.sheetFlash);
    const cleanup = () => el.classList.remove(creatorStyles.sheetFlash);
    el.addEventListener("animationend", cleanup, { once: true });
    return () => el.removeEventListener("animationend", cleanup);
  }, [creatorFlashCount]);

  const selectedInvoice = useMemo(
    () => invoices.find((invoice) => String(invoice.id) === selectedInvoiceId) ?? null,
    [invoices, selectedInvoiceId],
  );
  const workspaceSourceInvoice = useMemo(
    () => invoices.find((invoice) => invoice.id === workspaceSourceInvoiceId) ?? null,
    [invoices, workspaceSourceInvoiceId],
  );
  const budgetLineById = useMemo(
    () => new Map(budgetLineOptions.map((option) => [String(option.id), option])),
    [budgetLineOptions],
  );
  const budgetLineGroups = useMemo(() => {
    const next = new Map<string, BudgetLineOption[]>();
    for (const option of budgetLineOptions) {
      next.set(option.groupLabel, [...(next.get(option.groupLabel) ?? []), option]);
    }
    return [...next.entries()];
  }, [budgetLineOptions]);
  const projectNeedle = projectSearch.trim().toLowerCase();
  const filteredProjects = !projectNeedle
    ? projects
    : projects.filter((project) => {
        const haystack = [String(project.id), project.name, project.customer_display_name, project.status]
          .join(" ")
          .toLowerCase();
        return haystack.includes(projectNeedle);
      });
  const projectStatusCounts = PROJECT_STATUS_VALUES.reduce<Record<ProjectStatusValue, number>>(
    (acc, statusValue) => {
      acc[statusValue] = filteredProjects.filter(
        (project) => (project.status as ProjectStatusValue) === statusValue,
      ).length;
      return acc;
    },
    {
      prospect: 0,
      active: 0,
      on_hold: 0,
      completed: 0,
      cancelled: 0,
    },
  );
  const statusFilteredProjects = filteredProjects.filter((project) =>
    projectStatusFilters.includes(project.status as ProjectStatusValue),
  );
  const filteredInvoices = useMemo(() => {
    if (!invoiceStatusFilters.length) {
      return [];
    }
    return invoices.filter((invoice) => invoiceStatusFilters.includes(invoice.status));
  }, [invoiceStatusFilters, invoices]);
  const invoiceNeedle = invoiceSearch.trim().toLowerCase();
  const searchedInvoices = useMemo(() => {
    if (!invoiceNeedle) return filteredInvoices;
    return filteredInvoices.filter((invoice) => {
      const haystack = [
        invoice.invoice_number,
        invoice.status,
        invoice.total,
        invoice.balance_due,
        invoice.issue_date,
        invoice.due_date,
      ].join(" ").toLowerCase();
      return haystack.includes(invoiceNeedle);
    });
  }, [filteredInvoices, invoiceNeedle]);
  const nextStatusOptions = useMemo(() => {
    if (!selectedInvoice) {
      return [] as string[];
    }
    const nextStatuses = [...(invoiceAllowedStatusTransitions[selectedInvoice.status] ?? [])];
    if (selectedInvoice.status === "sent" && !nextStatuses.includes("sent")) {
      nextStatuses.unshift("sent");
    }
    return nextStatuses;
  }, [invoiceAllowedStatusTransitions, selectedInvoice]);

  const invoiceStatusTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of invoices) {
      totals.set(row.status, (totals.get(row.status) ?? 0) + 1);
    }
    return totals;
  }, [invoices]);
  const nextDraftInvoiceNumber = useMemo(() => nextInvoiceNumberPreview(invoices), [invoices]);
  const workspaceInvoiceNumber = workspaceSourceInvoice?.invoice_number ?? nextDraftInvoiceNumber;
  const workspaceIsLockedByStatus = workspaceSourceInvoice ? workspaceSourceInvoice.status !== "draft" : false;
  const workspaceIsLocked = !canEditInvoiceWorkspace || workspaceIsLockedByStatus;
  const workspaceBadgeLabel = !workspaceSourceInvoice
    ? "CREATING"
    : workspaceIsLocked
      ? "READ-ONLY"
      : "EDITING";
  const workspaceBadgeClass = !workspaceSourceInvoice
    ? styles.statusDraft
    : workspaceIsLocked
      ? invoiceStatusClass(workspaceSourceInvoice.status)
      : styles.statusDraft;

  const draftLineSubtotal = useMemo(() => {
    return lineItems.reduce((sum, line) => sum + parseAmount(line.quantity) * parseAmount(line.unitPrice), 0);
  }, [lineItems]);

  const draftTaxTotal = useMemo(() => {
    return draftLineSubtotal * (parseAmount(taxPercent) / 100);
  }, [draftLineSubtotal, taxPercent]);

  const draftTotal = useMemo(() => draftLineSubtotal + draftTaxTotal, [draftLineSubtotal, draftTaxTotal]);
  const statusLabel = useCallback(
    (status: string) => invoiceStatusLabels[status] ?? invoiceStatusLabel(status),
    [invoiceStatusLabels],
  );

  const loadDependencies = useCallback(
    async (options?: { keepStatusOnSuccess?: boolean }) => {
      if (!token) {
        return;
      }

      setNeutralStatus("Loading projects...");
      try {
        const [projectsRes, orgRes] = await Promise.all([
          fetch(`${normalizedBaseUrl}/projects/`, { headers: buildAuthHeaders(token) }),
          fetch(`${normalizedBaseUrl}/organization/`, { headers: buildAuthHeaders(token) }),
        ]);
        const projectsPayload: ApiResponse = await projectsRes.json();
        const orgPayload: ApiResponse = await orgRes.json();

        if (!projectsRes.ok) {
          setErrorStatus("Failed loading dependencies.");
          return;
        }

        const projectRows = (projectsPayload.data as ProjectRecord[]) ?? [];
        const organizationData = (
          orgPayload.data as { organization?: OrganizationInvoiceDefaults } | undefined
        )?.organization;

        setProjects(projectRows);
        setHasAutoSelectedProjectWithInvoices(false);
        if (orgRes.ok && organizationData) {
          setOrganizationInvoiceDefaults(organizationData);
          setDueDate(dueDateFromIssueDate(issueDate, organizationData.invoice_default_due_days || 30));
          setTermsText((current) => current || organizationData.invoice_default_terms || "");
        }

        setSelectedProjectId((current) => {
          if (current && projectRows.some((row) => String(row.id) === current)) {
            return current;
          }
          if (scopedProjectId) {
            const scoped = projectRows.find((row) => row.id === scopedProjectId);
            if (scoped) {
              return String(scoped.id);
            }
          }
          return projectRows[0] ? String(projectRows[0].id) : "";
        });

        if (!options?.keepStatusOnSuccess) {
          setStatusMessage("");
        }
      } catch {
        setErrorStatus("Could not reach dependency endpoints.");
      }
    },
    [issueDate, normalizedBaseUrl, scopedProjectId, setErrorStatus, setNeutralStatus, setStatusMessage, token],
  );

  const loadInvoicePolicy = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const response = await fetchInvoicePolicyContract({
        baseUrl: normalizedBaseUrl,
        token,
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok || !payload.data || Array.isArray(payload.data)) {
        return;
      }
      const contract = payload.data as InvoicePolicyContract;
      if (!Array.isArray(contract.statuses) || !contract.statuses.length) {
        return;
      }
      const normalizedTransitions = contract.statuses.reduce<Record<string, string[]>>((acc, statusValue) => {
        const nextStatuses = contract.allowed_status_transitions?.[statusValue];
        acc[statusValue] = Array.isArray(nextStatuses) ? nextStatuses : [];
        return acc;
      }, {});
      const nextDefaultFilters =
        Array.isArray(contract.default_status_filters) && contract.default_status_filters.length
          ? contract.default_status_filters.filter((value) => contract.statuses.includes(value))
          : INVOICE_DEFAULT_STATUS_FILTERS_FALLBACK.filter((value) => contract.statuses.includes(value));
      const resolvedFilters = nextDefaultFilters.length ? nextDefaultFilters : contract.statuses;
      setInvoiceStatuses(contract.statuses);
      setInvoiceStatusLabels({
        ...INVOICE_STATUS_LABELS_FALLBACK,
        ...(contract.status_labels || {}),
      });
      setInvoiceAllowedStatusTransitions({
        ...INVOICE_ALLOWED_STATUS_TRANSITIONS_FALLBACK,
        ...normalizedTransitions,
      });
      setInvoiceStatusFilters((current) => {
        const preserved = current.filter((value) => contract.statuses.includes(value));
        return preserved.length ? preserved : resolvedFilters;
      });
    } catch {
      // Contract load is best-effort; fallbacks remain active.
    }
  }, [normalizedBaseUrl, token]);

  const loadInvoices = useCallback(
    async (projectIdArg?: number) => {
      const resolvedProjectId = projectIdArg ?? Number(selectedProjectId);
      if (!token || !resolvedProjectId) {
        return;
      }

      try {
        const response = await fetch(`${normalizedBaseUrl}/projects/${resolvedProjectId}/invoices/`, {
          headers: buildAuthHeaders(token),
        });
        const payload: ApiResponse = await response.json();

        if (!response.ok) {
          setErrorStatus(readApiError(payload, "Failed loading invoices."));
          return;
        }

        const rows = (payload.data as InvoiceRecord[]) ?? [];
        setInvoices(rows);

        setSelectedInvoiceId((current) => {
          if (current && rows.some((row) => String(row.id) === current)) {
            return current;
          }
          return rows[0] ? String(rows[0].id) : "";
        });
        setStatusMessage("");
      } catch {
        setErrorStatus("Could not reach invoice endpoint.");
      }
    },
    [normalizedBaseUrl, selectedProjectId, setErrorStatus, setStatusMessage, token],
  );

  const loadBudgetLineOptions = useCallback(
    async (projectIdArg?: number) => {
      const resolvedProjectId = projectIdArg ?? Number(selectedProjectId);
      if (!token || !resolvedProjectId) {
        setBudgetLineOptions([]);
        return;
      }
      try {
        const response = await fetch(`${normalizedBaseUrl}/projects/${resolvedProjectId}/budgets/`, {
          headers: buildAuthHeaders(token),
        });
        const payload = (await response.json()) as { data?: ProjectBudgetRecord[] };
        if (!response.ok) {
          setBudgetLineOptions([]);
          return;
        }
        const budgets = payload.data ?? [];
        const activeBudget = budgets.find((row) => row.status === "active");
        const estimateTitle = activeBudget?.baseline_snapshot_json?.estimate?.title?.trim();
        const baseGroupLabel =
          estimateTitle ||
          (activeBudget?.source_estimate ? `Estimate #${activeBudget.source_estimate}` : "Estimate scope");
        const groupLabel =
          activeBudget?.source_estimate_version != null
            ? `${baseGroupLabel} (v${activeBudget.source_estimate_version})`
            : baseGroupLabel;
        const baselineLineByScopeItemId = new Map<
          string,
          {
            quantity: string | number | undefined;
            unit_cost: string | number | undefined;
            line_total: string | number | undefined;
          }
        >();
        const baselineLineItems = activeBudget?.baseline_snapshot_json?.line_items ?? [];
        for (const line of baselineLineItems) {
          if (line.scope_item_id == null) {
            continue;
          }
          baselineLineByScopeItemId.set(String(line.scope_item_id), {
            quantity: line.quantity,
            unit_cost: line.unit_cost,
            line_total: line.line_total,
          });
        }
        const options =
          activeBudget?.line_items?.map((line) => {
            const baselineLine =
              line.scope_item != null
                ? baselineLineByScopeItemId.get(String(line.scope_item))
                : undefined;
            const baselineQuantity = parseAmount(String(baselineLine?.quantity ?? ""));
            const baselineLineTotal = parseAmount(String(baselineLine?.line_total ?? ""));
            const baselineUnitCost = parseAmount(String(baselineLine?.unit_cost ?? ""));
            const budgetAmount = parseAmount(String(line.budget_amount ?? ""));
            const defaultQuantity =
              baselineQuantity > 0 ? normalizeDecimalInput(baselineQuantity, "1") : "1";
            let defaultUnitPrice = "0";
            if (baselineQuantity > 0 && baselineLineTotal > 0) {
              defaultUnitPrice = normalizeDecimalInput(baselineLineTotal / baselineQuantity, "0");
            } else if (baselineUnitCost > 0) {
              defaultUnitPrice = normalizeDecimalInput(baselineUnitCost, "0");
            } else if (budgetAmount > 0) {
              defaultUnitPrice = normalizeDecimalInput(budgetAmount, "0");
            }
            return {
              id: line.id,
              scopeItemId: line.scope_item,
              costCodeCode: line.cost_code_code,
              description: line.description,
              label: `${line.cost_code_code || "CC"} - ${line.description}`,
              groupLabel,
              defaultQuantity,
              defaultUnitPrice,
              remainingBillable: normalizeDecimalInput(parseAmount(String(line.remaining_billable ?? "0")), "0"),
            };
          })
            .filter((line) => !GENERIC_BUDGET_COST_CODES.has(line.costCodeCode))
            ?? [];
        setBudgetLineOptions(options);
      } catch {
        setBudgetLineOptions([]);
      }
    },
    [normalizedBaseUrl, selectedProjectId, token],
  );

  const loadInvoiceStatusEvents = useCallback(
    async (invoiceId: number) => {
      if (!token || !invoiceId) {
        setSelectedInvoiceStatusEvents([]);
        return;
      }
      setStatusEventsLoading(true);
      try {
        const response = await fetch(`${normalizedBaseUrl}/invoices/${invoiceId}/status-events/`, {
          headers: buildAuthHeaders(token),
        });
        const payload: ApiResponse = await response.json();
        if (!response.ok) {
          setSelectedInvoiceStatusEvents([]);
          return;
        }
        setSelectedInvoiceStatusEvents((payload.data as InvoiceStatusEventRecord[]) ?? []);
      } catch {
        setSelectedInvoiceStatusEvents([]);
      } finally {
        setStatusEventsLoading(false);
      }
    },
    [normalizedBaseUrl, token],
  );

  // Hydrate invoice policy (statuses, transitions, labels) from the backend on auth.
  useEffect(() => {
    if (!token) {
      return;
    }
    void loadInvoicePolicy();
  }, [loadInvoicePolicy, token]);

  // Load projects and organization defaults on auth.
  useEffect(() => {
    if (!token) {
      return;
    }
    void loadDependencies();
  }, [loadDependencies, token]);

  // Reload invoices and budget line options whenever the selected project changes.
  useEffect(() => {
    const projectId = Number(selectedProjectId);
    if (!token || !projectId) {
      setInvoices([]);
      setSelectedInvoiceId("");
      setBudgetLineOptions([]);
      return;
    }
    void loadInvoices(projectId);
    void loadBudgetLineOptions(projectId);
  }, [loadBudgetLineOptions, loadInvoices, selectedProjectId, token]);

  // Auto-select the first project that has invoices when the default project is empty.
  useEffect(() => {
    if (!token || scopedProjectId || hasAutoSelectedProjectWithInvoices) {
      return;
    }
    if (!selectedProjectId || invoices.length > 0) {
      return;
    }
    if (statusFilteredProjects.length <= 1) {
      return;
    }

    const selectedProjectIdNumber = Number(selectedProjectId);
    if (!selectedProjectIdNumber) {
      return;
    }

    let cancelled = false;
    setHasAutoSelectedProjectWithInvoices(true);

    async function selectFirstProjectWithInvoices() {
      for (const project of statusFilteredProjects) {
        if (project.id === selectedProjectIdNumber) {
          continue;
        }
        try {
          const response = await fetch(`${normalizedBaseUrl}/projects/${project.id}/invoices/`, {
            headers: buildAuthHeaders(token),
          });
          const payload: ApiResponse = await response.json();
          if (!response.ok) {
            continue;
          }
          const rows = (payload.data as InvoiceRecord[]) ?? [];
          if (!rows.length) {
            continue;
          }
          if (cancelled) {
            return;
          }
          setSelectedProjectId(String(project.id));
          return;
        } catch {
          // Best effort fallback; continue probing.
        }
      }
    }

    void selectFirstProjectWithInvoices();
    return () => {
      cancelled = true;
    };
  }, [
    hasAutoSelectedProjectWithInvoices,
    invoices.length,
    normalizedBaseUrl,
    scopedProjectId,
    selectedProjectId,
    statusFilteredProjects,
    token,
  ]);

  // Ensure selected project is still visible after filter changes; fall back to first match.
  useEffect(() => {
    if (statusFilteredProjects.length === 0) {
      return;
    }
    const selectedStillVisible = statusFilteredProjects.some(
      (project) => String(project.id) === selectedProjectId,
    );
    if (selectedStillVisible) {
      return;
    }
    const fallbackProject = statusFilteredProjects[0];
    setSelectedProjectId(String(fallbackProject.id));
  }, [selectedProjectId, statusFilteredProjects]);

  // Pre-select the most likely next status when the selected invoice changes.
  useEffect(() => {
    if (!selectedInvoice) {
      setSelectedStatus("draft");
      setStatusNote("");
      return;
    }
    const preferredStatus = resolvePreferredStatusSelection(selectedInvoice, invoiceAllowedStatusTransitions);
    setSelectedStatus((current) =>
      nextStatusOptions.includes(current) ? current : preferredStatus,
    );
    setStatusNote("");
  }, [invoiceAllowedStatusTransitions, nextStatusOptions, selectedInvoice]);

  // Ensure selected invoice is still visible after status filter changes.
  useEffect(() => {
    if (!filteredInvoices.length) {
      setSelectedInvoiceId("");
      return;
    }
    const selectedStillVisible = filteredInvoices.some(
      (invoice) => String(invoice.id) === selectedInvoiceId,
    );
    if (selectedStillVisible) {
      return;
    }
    const fallbackInvoice = filteredInvoices[0];
    setSelectedInvoiceId(String(fallbackInvoice.id));
    setSelectedStatus(resolvePreferredStatusSelection(fallbackInvoice, invoiceAllowedStatusTransitions));
  }, [filteredInvoices, invoiceAllowedStatusTransitions, selectedInvoiceId]);

  // Load status history events whenever the selected invoice changes.
  useEffect(() => {
    const invoiceId = Number(selectedInvoiceId);
    if (!invoiceId) {
      setSelectedInvoiceStatusEvents([]);
      setStatusEventsLoading(false);
      return;
    }
    void loadInvoiceStatusEvents(invoiceId);
  }, [loadInvoiceStatusEvents, selectedInvoiceId]);

  // Backfill orphaned scope lines with a valid budget line when options change.
  useEffect(() => {
    const defaultBudgetLineId = budgetLineOptions[0] ? String(budgetLineOptions[0].id) : "";
    if (!defaultBudgetLineId) {
      return;
    }
    setLineItems((current) =>
      current.map((line) => {
        if (line.lineType !== "scope") {
          return line;
        }
        if (line.budgetLineId && budgetLineById.has(line.budgetLineId)) {
          return line;
        }
        return { ...line, budgetLineId: defaultBudgetLineId };
      }),
    );
  }, [budgetLineById, budgetLineOptions]);

  /** Append a new blank line item to the workspace draft. */
  function addLineItem() {
    if (statusTone === "error" && statusMessage === INVOICE_MIN_LINE_ITEMS_ERROR) {
      clearStatus();
    }
    const defaultBudgetLineId = budgetLineOptions[0] ? String(budgetLineOptions[0].id) : "";
    setLineItems((current) => [...current, emptyLine(nextLineId, defaultBudgetLineId)]);
    setNextLineId((value) => value + 1);
  }

  /** Remove a line item by local ID, enforcing the minimum-one-line constraint. */
  function removeLineItem(localId: number) {
    if (lineItems.length <= 1) {
      setErrorStatus(INVOICE_MIN_LINE_ITEMS_ERROR);
      return;
    }
    setLineItems((current) => current.filter((line) => line.localId !== localId));
  }

  /** Update a single field on a line item; auto-populates defaults when changing budget line. */
  function updateLineItem(localId: number, key: keyof Omit<InvoiceLineInput, "localId">, value: string) {
    setLineItems((current) =>
      current.map((line) => {
        if (line.localId !== localId) {
          return line;
        }
        if (key === "budgetLineId" && line.lineType === "scope") {
          const selectedOption = budgetLineById.get(value);
          if (!selectedOption) {
            return { ...line, budgetLineId: value };
          }
          return {
            ...line,
            budgetLineId: value,
            description: selectedOption.description,
            quantity: "1",
            unitPrice: selectedOption.remainingBillable,
          };
        }
        return { ...line, [key]: value };
      }),
    );
  }

  /** Toggle a status value in the invoice list filter pill bar. */
  function toggleInvoiceStatusFilter(statusValue: string) {
    setInvoiceStatusFilters((current) =>
      current.includes(statusValue)
        ? current.filter((status) => status !== statusValue)
        : [...current, statusValue],
    );
  }

  /** Toggle a project status value in the project list filter. */
  function toggleProjectStatusFilter(statusValue: ProjectStatusValue) {
    setProjectStatusFilters((current) =>
      current.includes(statusValue)
        ? current.filter((status) => status !== statusValue)
        : [...current, statusValue],
    );
  }

  const invoiceToWorkspaceLines = useCallback(
    (invoice: InvoiceRecord): InvoiceLineInput[] => {
      const sourceLines = invoice.line_items ?? [];
      const fallbackBudgetLineId = budgetLineOptions[0] ? String(budgetLineOptions[0].id) : "";
      if (!sourceLines.length) {
        return [emptyLine(1, fallbackBudgetLineId)];
      }
      return sourceLines.map((line, index) => {
        const lineType: InvoiceLineInput["lineType"] =
          line.line_type === "adjustment" ? "adjustment" : "scope";
        const rawBudgetLineId = line.budget_line ? String(line.budget_line) : "";
        const budgetLineId =
          lineType === "scope"
            ? budgetLineById.has(rawBudgetLineId)
              ? rawBudgetLineId
              : fallbackBudgetLineId
            : "";
        return {
          localId: index + 1,
          lineType,
          budgetLineId,
          adjustmentReason: line.adjustment_reason || "",
          internalNote: line.internal_note || "",
          description: line.description || "Invoice scope item",
          quantity: line.quantity || "1",
          unit: line.unit || "ea",
          unitPrice: line.unit_price || "0",
        };
      });
    },
    [budgetLineById, budgetLineOptions],
  );

  const loadInvoiceIntoWorkspace = useCallback(
    (invoice: InvoiceRecord) => {
      const workspaceLines = invoiceToWorkspaceLines(invoice);
      setIssueDate(invoice.issue_date || todayDateInput());
      setDueDate(invoice.due_date || futureDateInput());
      setTaxPercent(invoice.tax_percent || "0");
      setTermsText(invoice.terms_text || "");
      setLineItems(workspaceLines);
      setNextLineId(workspaceLines.length + 1);
      setWorkspaceSourceInvoiceId(invoice.id);
      if (invoice.status === "draft") {
        setEditingDraftInvoiceId(invoice.id);
        setWorkspaceContext(`Editing ${invoice.invoice_number}`);
      } else {
        setEditingDraftInvoiceId(null);
        setWorkspaceContext(`Viewing ${invoice.invoice_number} (locked)`);
      }
    },
    [invoiceToWorkspaceLines],
  );

  /** Switch the active project, triggering invoice and budget line reloads. */
  function handleSelectProject(project: { id: number }) {
    if (String(project.id) === selectedProjectId) {
      return;
    }
    setSelectedProjectId(String(project.id));
    setInvoiceSearch("");
  }

  /** Select an invoice from the list and load it into the creator workspace. */
  function handleSelectInvoice(invoice: InvoiceRecord) {
    setSelectedInvoiceId(String(invoice.id));
    setSelectedStatus(resolvePreferredStatusSelection(invoice, invoiceAllowedStatusTransitions));
    setIsHistorySectionOpen(false);
    setIsLineItemsSectionOpen(false);
    setShowAllEvents(false);
    setViewerActionMessage("");
    loadInvoiceIntoWorkspace(invoice);
  }

  /** Reset the creator workspace to a fresh new-draft state.
   *  Pre-populates line items from the active budget with remaining billable amounts. */
  function resetCreateDraft() {
    const nextIssueDate = todayDateInput();
    const dueDays = organizationInvoiceDefaults?.invoice_default_due_days ?? 30;
    setIssueDate(nextIssueDate);
    setDueDate(dueDateFromIssueDate(nextIssueDate, dueDays));
    setTaxPercent("0");
    setTermsText(organizationInvoiceDefaults?.invoice_default_terms || "");

    const billableLines = budgetLineOptions
      .filter((opt) => parseAmount(opt.remainingBillable) > 0)
      .map((opt, idx) => ({
        localId: idx + 1,
        lineType: "scope" as const,
        budgetLineId: String(opt.id),
        adjustmentReason: "",
        internalNote: "",
        description: opt.description,
        quantity: "1",
        unit: "ea",
        unitPrice: opt.remainingBillable,
      }));

    if (billableLines.length > 0) {
      setLineItems(billableLines);
      setNextLineId(billableLines.length + 1);
    } else {
      const defaultBudgetLineId = budgetLineOptions[0] ? String(budgetLineOptions[0].id) : "";
      setLineItems([emptyLine(1, defaultBudgetLineId)]);
      setNextLineId(2);
    }

    setWorkspaceSourceInvoiceId(null);
    setEditingDraftInvoiceId(null);
    setWorkspaceContext("New invoice draft");
  }

  /** Clear the workspace and start a new invoice draft. */
  function handleStartNewInvoiceDraft() {
    resetCreateDraft();
    setSuccessStatus("Started a new invoice draft.");
  }

  /** Create a new invoice or save an existing draft, depending on workspace context. */
  async function handleCreateInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutateInvoices) {
      setErrorStatus(`Role ${role} is read-only for invoice mutations.`);
      return;
    }
    if (workspaceIsLocked) {
      setErrorStatus("This invoice workspace is read-only. Start a new draft or duplicate to edit.");
      return;
    }

    if (lineItems.some((line) => line.lineType === "scope" && !line.budgetLineId)) {
      setErrorStatus("Each scope line requires a project budget line.");
      return;
    }
    if (
      lineItems.some(
        (line) => line.lineType === "adjustment" && !line.adjustmentReason.trim(),
      )
    ) {
      setErrorStatus("Each adjustment line requires a reason.");
      return;
    }

    if (editingDraftInvoiceId) {
      setNeutralStatus("Saving draft invoice...");
      try {
        const currentDraft = invoices.find((invoice) => invoice.id === editingDraftInvoiceId);
        if (!currentDraft) {
          setErrorStatus("Draft context is stale. Re-select the invoice and try again.");
          return;
        }
        const updatePayload = invoiceCreatorAdapter.toUpdatePayload(invoiceDraftFormState, currentDraft);
        const response = await fetch(`${normalizedBaseUrl}/invoices/${editingDraftInvoiceId}/`, {
          method: "PATCH",
          headers: buildAuthHeaders(token, { contentType: "application/json" }),
          body: JSON.stringify(updatePayload),
        });
        const payload: ApiResponse = await response.json();
        if (!response.ok) {
          setErrorStatus(readApiError(payload, "Save draft failed."));
          return;
        }
        const updated = payload.data as InvoiceRecord;
        setInvoices((current) =>
          current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
        );
        setWorkspaceSourceInvoiceId(updated.id);
        setSelectedInvoiceId(String(updated.id));
        setSelectedStatus(resolvePreferredStatusSelection(updated, invoiceAllowedStatusTransitions));
        setWorkspaceContext(`Editing ${updated.invoice_number}`);
        setSuccessStatus(`Saved ${updated.invoice_number} draft.`);
        setCreatorFlashCount((c) => c + 1);
        return;
      } catch {
        setErrorStatus("Could not reach invoice update endpoint.");
        return;
      }
    }

    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setErrorStatus("Select a project first.");
      return;
    }

    setNeutralStatus("Creating invoice...");
    try {
      const createPayload = invoiceCreatorAdapter.toCreatePayload(invoiceDraftFormState);
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/invoices/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify(createPayload),
      });
      const payload: ApiResponse = await response.json();

      if (!response.ok) {
        setErrorStatus(readApiError(payload, "Create invoice failed."));
        return;
      }

      const created = payload.data as InvoiceRecord;
      await loadInvoices(projectId);
      setSelectedInvoiceId(String(created.id));
      setSelectedStatus(created.status);
      loadInvoiceIntoWorkspace(created);
      setSuccessStatus(`Created ${created.invoice_number} (${statusLabel(created.status)}).`);
      setCreatorFlashCount((c) => c + 1);
    } catch {
      setErrorStatus("Could not reach invoice create endpoint.");
    }
  }

  /** Transition the selected invoice to a new status, with optional status note. */
  async function handleUpdateInvoiceStatus() {
    if (!canMutateInvoices) {
      setErrorStatus(`Role ${role} is read-only for invoice mutations.`);
      return;
    }

    const invoiceId = Number(selectedInvoiceId);
    if (!invoiceId) {
      setErrorStatus("Select an invoice first.");
      return;
    }

    setNeutralStatus("Updating invoice status...");
    try {
      const trimmedNote = statusNote.trim();
      const shouldAutoSendNote =
        selectedInvoice &&
        selectedStatus === "sent" &&
        (selectedInvoice.status === "draft" || selectedInvoice.status === "sent");
      const patchPayload: Record<string, string> = {
        status: selectedStatus,
      };
      if (trimmedNote) {
        patchPayload.status_note = trimmedNote;
      } else if (shouldAutoSendNote) {
        patchPayload.status_note = selectedInvoice.status === "draft" ? "Invoice sent." : "Invoice re-sent.";
      }
      const response = await fetch(`${normalizedBaseUrl}/invoices/${invoiceId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify(patchPayload),
      });
      const payload: ApiResponse = await response.json();

      if (!response.ok) {
        setErrorStatus(readApiError(payload, "Status update failed."));
        return;
      }

      const updated = payload.data as InvoiceRecord;
      setInvoices((current) =>
        current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
      );
      setSelectedStatus(updated.status);
      setStatusNote("");
      await loadInvoiceStatusEvents(updated.id);
      const msg = `Updated ${updated.invoice_number} to ${statusLabel(updated.status)}. History updated.`;
      setSuccessStatus(msg);
      setViewerActionMessage(msg);
      setViewerActionTone("success");
    } catch {
      const msg = "Could not reach invoice status endpoint.";
      setErrorStatus(msg);
      setViewerActionMessage(msg);
      setViewerActionTone("error");
    }
  }

  /** Append a note to the selected invoice's status history without changing status. */
  async function handleAddInvoiceStatusNote() {
    if (!canMutateInvoices) {
      setErrorStatus(`Role ${role} is read-only for invoice mutations.`);
      return;
    }
    const invoiceId = Number(selectedInvoiceId);
    if (!invoiceId) {
      setErrorStatus("Select an invoice first.");
      return;
    }
    if (!statusNote.trim()) {
      setErrorStatus("Enter a status note first.");
      return;
    }

    setNeutralStatus("Adding invoice status note...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/invoices/${invoiceId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          status_note: statusNote,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setErrorStatus(readApiError(payload, "Status note update failed."));
        return;
      }
      const updated = payload.data as InvoiceRecord;
      setInvoices((current) =>
        current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
      );
      setSelectedStatus(updated.status);
      setStatusNote("");
      await loadInvoiceStatusEvents(updated.id);
      const msg = `Added status note on ${updated.invoice_number}. History updated.`;
      setSuccessStatus(msg);
      setViewerActionMessage(msg);
      setViewerActionTone("success");
    } catch {
      const msg = "Could not reach invoice status note endpoint.";
      setErrorStatus(msg);
      setViewerActionMessage(msg);
      setViewerActionTone("error");
    }
  }

  /** Clone the selected invoice's line items into a fresh draft with a new invoice number. */
  function handleDuplicateInvoiceIntoDraft() {
    if (!selectedInvoice) {
      setErrorStatus("Select an invoice first.");
      return;
    }

    const nextDraftLines = invoiceToWorkspaceLines(selectedInvoice);

    const nextIssueDate = todayDateInput();
    setIssueDate(nextIssueDate);
    setDueDate(dueDateFromIssueDate(
      nextIssueDate,
      organizationInvoiceDefaults?.invoice_default_due_days ?? 30,
    ));
    setTaxPercent(selectedInvoice.tax_percent || "0");
    setTermsText(selectedInvoice.terms_text || "");
    setLineItems(nextDraftLines);
    setNextLineId(nextDraftLines.length + 1);
    setWorkspaceSourceInvoiceId(null);
    setEditingDraftInvoiceId(null);
    setWorkspaceContext(`Draft from ${selectedInvoice.invoice_number}`);
    setSuccessStatus(`Draft created from ${selectedInvoice.invoice_number}.`);
    setCreatorFlashCount((c) => c + 1);
  }

  const selectedProject = projects.find((project) => String(project.id) === selectedProjectId) ?? null;
  const organizationBranding = useMemo(
    () => resolveOrganizationBranding(organizationInvoiceDefaults),
    [organizationInvoiceDefaults],
  );
  const senderDisplayName = organizationBranding.senderDisplayName;
  const senderEmail = organizationBranding.senderEmail;
  const senderAddressLines = organizationBranding.senderAddressLines;
  const senderLogoUrl = organizationBranding.logoUrl;
  const invoiceCreatorStatusPolicy = useMemo(
    () =>
      toInvoiceStatusPolicy({
        policy_version: "ui-fallback",
        statuses: invoiceStatuses,
        status_labels: invoiceStatusLabels,
        default_create_status: invoiceStatuses.includes("draft") ? "draft" : invoiceStatuses[0] ?? "draft",
        default_status_filters: invoiceStatusFilters.length
          ? invoiceStatusFilters
          : INVOICE_DEFAULT_STATUS_FILTERS_FALLBACK,
        allowed_status_transitions: invoiceAllowedStatusTransitions,
        terminal_statuses: INVOICE_TERMINAL_STATUSES_FALLBACK,
      }),
    [invoiceAllowedStatusTransitions, invoiceStatusFilters, invoiceStatusLabels, invoiceStatuses],
  );
  const invoiceDraftFormState: InvoiceFormState = useMemo(
    () => ({
      issueDate,
      dueDate,
      taxPercent,
      termsText,
      subtotal: draftLineSubtotal,
      taxAmount: draftTaxTotal,
      totalAmount: draftTotal,
      lineItems,
    }),
    [
      draftLineSubtotal,
      draftTaxTotal,
      draftTotal,
      dueDate,
      issueDate,
      lineItems,
      taxPercent,
      termsText,
    ],
  );
  const invoiceCreatorAdapter = useMemo(
    () => createInvoiceDocumentAdapter(invoiceCreatorStatusPolicy, []),
    [invoiceCreatorStatusPolicy],
  );
  const statusMessageAtCreator =
    statusTone === "success" && /^(Created|Saved|Started|Loaded)\b/i.test(statusMessage);

  return (
    <section className={styles.console}>
      {!token ? <p className={styles.authNotice}>{authMessage}</p> : null}

      {statusMessage && !statusMessageAtCreator ? (
        <p
          className={`${styles.statusBanner} ${
            statusTone === "success"
              ? styles.statusSuccess
              : statusTone === "error"
                ? styles.statusError
                : ""
          }`}
        >
          {statusMessage}
        </p>
      ) : null}

      {token ? (
        <>
          {!canMutateInvoices ? (
            <p className={styles.readOnlyNotice}>Role `{role}` can view invoices but cannot create, update, or send.</p>
          ) : null}

          <ProjectListViewer
            isExpanded={isProjectListExpanded}
            onToggleExpanded={() => setIsProjectListExpanded((current) => !current)}
            showSearchAndFilters
            searchValue={projectSearch}
            onSearchChange={setProjectSearch}
            statusValues={PROJECT_STATUS_VALUES}
            statusFilters={projectStatusFilters}
            statusCounts={projectStatusCounts}
            onToggleStatusFilter={toggleProjectStatusFilter}
            onShowAllStatuses={() =>
              setProjectStatusFilters(["active", "on_hold", "prospect", "completed", "cancelled"])
            }
            onResetStatuses={() => setProjectStatusFilters(DEFAULT_PROJECT_STATUS_FILTERS)}
            projects={statusFilteredProjects}
            selectedProjectId={selectedProjectId}
            onSelectProject={handleSelectProject}
            statusLabel={projectStatusLabel}
          />

          <section className={`${styles.panel} ${styles.viewerPanel}`}>
              <div className={styles.panelHeader}>
                <h3>{selectedProject ? `Invoices for: ${selectedProject.name}` : "Invoices"}</h3>
                <button
                  type="button"
                  className={collapseButtonStyles.collapseButton}
                  onClick={() => setIsInvoiceViewerExpanded((current) => !current)}
                  aria-expanded={isInvoiceViewerExpanded}
                >
                  {isInvoiceViewerExpanded ? "Collapse" : "Expand"}
                </button>
              </div>

              {isInvoiceViewerExpanded ? (
                <>

              <input
                className={styles.invoiceSearchInput}
                type="text"
                placeholder="Search invoices..."
                value={invoiceSearch}
                onChange={(e) => setInvoiceSearch(e.target.value)}
              />

              <div className={styles.statusFilters}>
                {invoiceStatuses.map((status) => {
                  const active = invoiceStatusFilters.includes(status);
                  return (
                    <button
                      key={status}
                      type="button"
                      className={`${styles.statusFilterPill} ${
                        active
                          ? `${styles.statusFilterPillActive} ${invoiceStatusToneClass(status)}`
                          : styles.statusFilterPillInactive
                      }`}
                      onClick={() => toggleInvoiceStatusFilter(status)}
                    >
                      <span>{statusLabel(status)}</span>
                      <span className={styles.statusFilterCount}>{invoiceStatusTotals.get(status) ?? 0}</span>
                    </button>
                  );
                })}
              </div>

              <div className={styles.invoiceRail}>
                {searchedInvoices.length ? (
                  searchedInvoices.map((invoice) => {
                    const isSelected = String(invoice.id) === selectedInvoiceId;
                    return (
                      <article
                        key={invoice.id}
                        className={`${styles.invoiceCard} ${invoiceCardStatusClass(invoice.status)} ${
                          isSelected ? styles.invoiceCardSelected : ""
                        }`}
                        onClick={() => {
                          if (!isSelected) handleSelectInvoice(invoice);
                        }}
                        onKeyDown={(event) => {
                          if (isSelected) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleSelectInvoice(invoice);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isSelected}
                      >
                        <div className={styles.invoiceCardRow}>
                          <div className={styles.invoiceCardIdentity}>
                            <strong>{invoice.invoice_number}</strong>
                            <span className={`${styles.statusBadge} ${invoiceStatusClass(invoice.status)}`}>
                              {statusLabel(invoice.status)}
                            </span>
                          </div>
                          {invoice.public_ref ? (
                            <a
                              href={publicInvoiceHref(invoice.public_ref)}
                              className={styles.invoiceCardPublicLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => event.stopPropagation()}
                            >
                              Public ↗
                            </a>
                          ) : null}
                        </div>
                        <div className={styles.invoiceMetaGrid}>
                          <span><span className={styles.invoiceMetaLabel}>Total</span> ${invoice.total}</span>
                          <span><span className={styles.invoiceMetaLabel}>Due</span> ${invoice.balance_due}</span>
                          <span><span className={styles.invoiceMetaLabel}>Issued</span> {formatDateDisplay(invoice.issue_date)}</span>
                          <span><span className={styles.invoiceMetaLabel}>Due</span> {formatDateDisplay(invoice.due_date)}</span>
                        </div>

                        {isSelected && selectedInvoice ? (
                          <div className={styles.invoiceExpandedSections}>
                            {/* Status & Actions */}
                            <div className={styles.invoiceViewerSection}>
                              <button
                                type="button"
                                className={styles.invoiceViewerSectionToggle}
                                onClick={(e) => { e.stopPropagation(); setIsStatusSectionOpen((v) => !v); }}
                                aria-expanded={isStatusSectionOpen}
                              >
                                <h4>Status &amp; Actions</h4>
                                <span className={styles.invoiceViewerSectionArrow}>▼</span>
                              </button>
                              {isStatusSectionOpen ? (
                                <div className={styles.invoiceViewerSectionContent}>
                                  <p className={styles.inlineHint}>{invoiceNextActionHint(selectedInvoice.status)}</p>
                                  {canMutateInvoices ? (
                                    <>
                                      {nextStatusOptions.length > 0 ? (
                                        <>
                                          <span className={styles.lifecycleFieldLabel}>Next status</span>
                                          <div className={styles.invoiceQuickStatusPills}>
                                            {nextStatusOptions.map((status) => {
                                              const isActive = selectedStatus === status;
                                              return (
                                                <button
                                                  key={status}
                                                  type="button"
                                                  className={`${styles.invoiceQuickStatusButton} ${
                                                    isActive
                                                      ? `${styles.invoiceQuickStatusButtonActive} ${invoiceStatusToneClass(status)}`
                                                      : styles.invoiceQuickStatusButtonInactive
                                                  }`}
                                                  onClick={(e) => { e.stopPropagation(); setSelectedStatus(status); }}
                                                  aria-pressed={isActive}
                                                >
                                                  {selectedInvoice.status === "sent" && status === "sent"
                                                    ? "Re-send"
                                                    : statusLabel(status)}
                                                </button>
                                              );
                                            })}
                                          </div>
                                        </>
                                      ) : (
                                        <p className={styles.inlineHint}>No next statuses available.</p>
                                      )}
                                      <label className={styles.invoiceViewerField} onClick={(e) => e.stopPropagation()}>
                                        Status note
                                        <textarea
                                          value={statusNote}
                                          onChange={(e) => setStatusNote(e.target.value)}
                                          placeholder="Optional note for this status action or history-only note."
                                          rows={2}
                                        />
                                      </label>
                                      {viewerActionMessage ? (
                                        <p
                                          className={viewerActionTone === "error" ? styles.invoiceViewerActionError : styles.invoiceViewerActionSuccess}
                                          role="status"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          {viewerActionMessage}
                                        </p>
                                      ) : null}
                                      <div className={styles.invoiceViewerActionRow}>
                                        {nextStatusOptions.length > 0 ? (
                                          <button
                                            type="button"
                                            className={`${styles.invoiceViewerActionButton} ${styles.invoiceViewerActionButtonPrimary}`}
                                            onClick={(e) => { e.stopPropagation(); handleUpdateInvoiceStatus(); }}
                                          >
                                            Update Status
                                          </button>
                                        ) : null}
                                        <button
                                          type="button"
                                          className={`${styles.invoiceViewerActionButton} ${styles.invoiceViewerActionButtonSecondary}`}
                                          onClick={(e) => { e.stopPropagation(); handleAddInvoiceStatusNote(); }}
                                          disabled={!statusNote.trim()}
                                        >
                                          Add Status Note
                                        </button>
                                      </div>
                                    </>
                                  ) : (
                                    <p className={styles.inlineHint}>Status actions are read-only for your role.</p>
                                  )}
                                </div>
                              ) : null}
                            </div>

                            {/* History */}
                            <div className={styles.invoiceViewerSection}>
                              <button
                                type="button"
                                className={styles.invoiceViewerSectionToggle}
                                onClick={(e) => { e.stopPropagation(); setIsHistorySectionOpen((v) => !v); }}
                                aria-expanded={isHistorySectionOpen}
                              >
                                <h4>History ({selectedInvoiceStatusEvents.length})</h4>
                                <span className={styles.invoiceViewerSectionArrow}>▼</span>
                              </button>
                              {isHistorySectionOpen ? (
                                <div className={styles.invoiceViewerSectionContent}>
                                  {selectedInvoiceStatusEvents.length > 0 ? (
                                    <>
                                      <ul className={styles.invoiceViewerEventList}>
                                        {(showAllEvents
                                          ? selectedInvoiceStatusEvents
                                          : selectedInvoiceStatusEvents.slice(0, 4)
                                        ).map((event) => (
                                          <li key={event.id} className={styles.invoiceViewerEventItem}>
                                            <span className={`${styles.invoiceViewerEventAction} ${invoiceStatusEventToneClass(event)}`}>
                                              {invoiceStatusEventActionLabel(event, statusLabel)}
                                            </span>
                                            <span className={styles.invoiceViewerEventMeta}>
                                              {formatDateTimeDisplay(event.changed_at, "--")} by{" "}
                                              {event.changed_by_customer_id ? (
                                                <Link
                                                  href={`/customers?customer=${event.changed_by_customer_id}`}
                                                  className={styles.statusActorLink}
                                                  onClick={(e) => e.stopPropagation()}
                                                >
                                                  {event.changed_by_display || `Customer #${event.changed_by_customer_id}`}
                                                </Link>
                                              ) : (
                                                event.changed_by_display || event.changed_by_email || `User #${event.changed_by}`
                                              )}
                                            </span>
                                            {event.note ? (
                                              <span className={styles.invoiceViewerEventNote}>{event.note}</span>
                                            ) : null}
                                          </li>
                                        ))}
                                      </ul>
                                      {selectedInvoiceStatusEvents.length > 4 ? (
                                        <button
                                          type="button"
                                          className={styles.invoiceShowAllToggle}
                                          onClick={(e) => { e.stopPropagation(); setShowAllEvents((v) => !v); }}
                                        >
                                          {showAllEvents
                                            ? "Show less"
                                            : `Show all ${selectedInvoiceStatusEvents.length} events`}
                                        </button>
                                      ) : null}
                                    </>
                                  ) : (
                                    <p className={styles.inlineHint}>
                                      {statusEventsLoading ? "Loading status history..." : "No status history yet."}
                                    </p>
                                  )}
                                </div>
                              ) : null}
                            </div>

                            {/* Line Items */}
                            <div className={styles.invoiceViewerSection}>
                              <button
                                type="button"
                                className={styles.invoiceViewerSectionToggle}
                                onClick={(e) => { e.stopPropagation(); setIsLineItemsSectionOpen((v) => !v); }}
                                aria-expanded={isLineItemsSectionOpen}
                              >
                                <h4>Line Items ({invoice.line_items?.length ?? 0})</h4>
                                <span className={styles.invoiceViewerSectionArrow}>▼</span>
                              </button>
                              {isLineItemsSectionOpen ? (
                                <div className={styles.invoiceViewerSectionContent}>
                                  {(invoice.line_items?.length ?? 0) > 0 ? (
                                    <div className={styles.invoiceLineTableWrap}>
                                      <table className={styles.invoiceLineTable}>
                                        <thead>
                                          <tr>
                                            <th>Description</th>
                                            <th>Qty</th>
                                            <th>Unit</th>
                                            <th>Unit Price</th>
                                            <th>Line Total</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {invoice.line_items!.map((line) => (
                                            <tr key={line.id}>
                                              <td>{line.description || line.budget_line_description || "—"}</td>
                                              <td>{line.quantity}</td>
                                              <td>{line.unit}</td>
                                              <td>${line.unit_price}</td>
                                              <td>${line.line_total}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : (
                                    <p className={styles.inlineHint}>No line items.</p>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </article>
                    );
                  })
                ) : (
                  <p className={styles.emptyState}>
                    {invoices.length
                      ? invoiceNeedle
                        ? "No invoices match your search."
                        : "No invoices match the selected status filters."
                      : "No invoices yet for this project."}
                  </p>
                )}
              </div>

                </>
              ) : (
                <p className={styles.inlineHint}>Invoice viewer collapsed. Expand to review status history and send actions.</p>
              )}
            </section>

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
                      className={styles.toolbarActionButton}
                      onClick={handleStartNewInvoiceDraft}
                    >
                      {editingDraftInvoiceId ? "Create New Invoice" : "Reset"}
                    </button>
                    {editingDraftInvoiceId ? (
                      <button
                        type="button"
                        className={styles.toolbarActionButton}
                        onClick={handleDuplicateInvoiceIntoDraft}
                      >
                        Duplicate as New Invoice
                      </button>
                    ) : null}
                  </div>
                  <p className={styles.workspaceToolbarHint}>
                    Invoices do not use revision families. Duplicate always creates a new invoice #.
                  </p>
                </div>
              ) : null}
              <div ref={invoiceCreatorRef}>
                <DocumentCreator
                  adapter={invoiceCreatorAdapter}
                  document={null}
                  formState={invoiceDraftFormState}
                  className={`${creatorStyles.sheet} ${invoiceCreatorStyles.invoiceCreatorSheet} ${workspaceIsLocked ? `${invoiceCreatorStyles.invoiceCreatorSheetLocked} ${creatorStyles.sheetReadOnly}` : ""}`}
                  sectionClassName={invoiceCreatorStyles.invoiceCreatorSection}
                  onSubmit={handleCreateInvoice}
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
                              {selectedProject?.customer_display_name || "Select project"}
                            </p>
                            <p className={creatorStyles.blockMuted}>
                              {selectedProject
                                ? `#${selectedProject.id} ${selectedProject.name}`
                                : "Choose a project from the project list"}
                            </p>
                          </div>
                        </div>
                        <div className={creatorStyles.headerRight}>
                          <div className={creatorStyles.logoBox}>
                            {senderLogoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={senderLogoUrl} alt="Organization logo" className={invoiceCreatorStyles.invoiceLogoImage} />
                            ) : (
                              "Logo"
                            )}
                          </div>
                          <div className={creatorStyles.sheetTitle}>Invoice</div>
                        </div>
                      </div>

                      <div className={invoiceCreatorStyles.invoiceMetaLayout}>
                        <div className={invoiceCreatorStyles.invoiceDetailCard}>
                          <span className={invoiceCreatorStyles.invoiceMetaCardLabel}>Invoice Details</span>
                          <div className={creatorStyles.metaLine}>
                            <span>Invoice #</span>
                            <div className={invoiceCreatorStyles.invoiceNumberContext}>
                              <input
                                className={`${creatorStyles.fieldInput} ${invoiceCreatorStyles.invoiceNumberInput}`}
                                value={workspaceInvoiceNumber}
                                readOnly
                                disabled
                                autoComplete="one-time-code"
                                aria-label="Invoice number"
                              />
                              {!workspaceSourceInvoice ? (
                                <span
                                  className={`${invoiceCreatorStyles.invoiceNumberIndicator} ${invoiceCreatorStyles.invoiceNumberIndicatorGenerated}`}
                                >
                                  New
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <label className={creatorStyles.inlineField}>
                            Issue date
                            <input
                              className={`${creatorStyles.fieldInput} ${invoiceCreatorStyles.invoiceLockableControl}`}
                              type="date"
                              value={issueDate}
                              onChange={(event) => setIssueDate(event.target.value)}
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
                              onChange={(event) => setDueDate(event.target.value)}
                              required
                              disabled={workspaceIsLocked}
                            />
                          </label>
                        </div>
                      </div>

                      <div className={invoiceCreatorStyles.invoiceLineSectionIntro}>
                        <h3>Line Items</h3>
                      </div>
                      {budgetLineOptions.length === 0 ? (
                        <p className={creatorStyles.inlineHint}>
                          Scope lines require an active project budget line. Convert an approved estimate to budget or
                          use adjustment lines with a reason. Internal generic lines are not billable here.
                        </p>
                      ) : null}

                      <div className={creatorStyles.lineTable}>
                        <div className={invoiceCreatorStyles.invoiceLineHeader}>
                          <span>Type</span>
                          <span>Scope source / Reason</span>
                          <span>Qty</span>
                          <span>Description</span>
                          <span>Unit</span>
                          <span>Unit price</span>
                          <span>Amount</span>
                          <span>{workspaceIsLocked ? "" : "Actions"}</span>
                        </div>
                        {lineItems.map((line, index) => {
                          const lineAmount = parseAmount(line.quantity) * parseAmount(line.unitPrice);
                          return (
                            <div
                              key={line.localId}
                              className={`${invoiceCreatorStyles.invoiceLineRow} ${index % 2 === 1 ? invoiceCreatorStyles.invoiceLineRowAlt : ""}`}
                            >
                              <select
                                className={`${creatorStyles.lineInput} ${invoiceCreatorStyles.invoiceLockableControl}`}
                                value={line.lineType}
                                onChange={(event) =>
                                  updateLineItem(
                                    line.localId,
                                    "lineType",
                                    event.target.value as InvoiceLineInput["lineType"],
                                  )
                                }
                                disabled={workspaceIsLocked}
                              >
                                <option value="scope">Scope</option>
                                <option value="adjustment">Adjustment</option>
                              </select>
                              {line.lineType === "scope" ? (
                                <select
                                  className={`${creatorStyles.lineInput} ${invoiceCreatorStyles.invoiceLockableControl}`}
                                  value={line.budgetLineId}
                                  onChange={(event) =>
                                    updateLineItem(line.localId, "budgetLineId", event.target.value)
                                  }
                                  required
                                  disabled={workspaceIsLocked}
                                >
                                  <option value="">Select budget line</option>
                                  {budgetLineGroups.map(([groupLabel, options]) => (
                                    <optgroup key={groupLabel} label={groupLabel}>
                                      {options.map((option) => (
                                        <option key={option.id} value={option.id}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </optgroup>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  className={`${creatorStyles.lineInput} ${invoiceCreatorStyles.invoiceLockableControl}`}
                                  value={line.adjustmentReason}
                                  onChange={(event) =>
                                    updateLineItem(line.localId, "adjustmentReason", event.target.value)
                                  }
                                  placeholder="Adjustment reason"
                                  required
                                  disabled={workspaceIsLocked}
                                />
                              )}
                              <input
                                className={`${creatorStyles.lineInput} ${invoiceCreatorStyles.invoiceLockableControl}`}
                                value={line.quantity}
                                onChange={(event) =>
                                  updateLineItem(line.localId, "quantity", event.target.value)
                                }
                                inputMode="decimal"
                                required
                                disabled={workspaceIsLocked}
                              />
                              <input
                                className={`${creatorStyles.lineInput} ${invoiceCreatorStyles.invoiceLockableControl}`}
                                value={line.description}
                                onChange={(event) =>
                                  updateLineItem(line.localId, "description", event.target.value)
                                }
                                required
                                disabled={workspaceIsLocked}
                              />
                              <input
                                className={`${creatorStyles.lineInput} ${invoiceCreatorStyles.invoiceLockableControl}`}
                                value={line.unit}
                                onChange={(event) => updateLineItem(line.localId, "unit", event.target.value)}
                                required
                                disabled={workspaceIsLocked}
                              />
                              <input
                                className={`${creatorStyles.lineInput} ${invoiceCreatorStyles.invoiceLockableControl}`}
                                value={line.unitPrice}
                                onChange={(event) =>
                                  updateLineItem(line.localId, "unitPrice", event.target.value)
                                }
                                inputMode="decimal"
                                required
                                disabled={workspaceIsLocked}
                              />
                              <span className={`${creatorStyles.amountCell} ${invoiceCreatorStyles.invoiceReadAmount}`}>
                                ${formatDecimal(lineAmount)}
                              </span>
                              <div className={invoiceCreatorStyles.invoiceLineActionsCell}>
                                {!workspaceIsLocked ? (
                                  <button
                                    type="button"
                                    className={creatorStyles.smallButton}
                                    onClick={() => removeLineItem(line.localId)}
                                  >
                                    Remove
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {!workspaceIsLocked ? (
                        <div className={invoiceCreatorStyles.invoiceLineActions}>
                          <button
                            type="button"
                            className={creatorStyles.secondaryButton}
                            onClick={addLineItem}
                          >
                            Add Line Item
                          </button>
                        </div>
                      ) : null}

                      {!selectedProjectId ? (
                        <p className={creatorStyles.inlineHint}>Select a project before creating an invoice.</p>
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
                                    onChange={(event) => setTaxPercent(event.target.value)}
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
                          {canMutateInvoices && !workspaceIsLocked ? (
                            <>
                              {statusMessageAtCreator ? (
                                <p className={`${creatorStyles.actionSuccess} ${invoiceCreatorStyles.invoiceCreateStatusMessage}`}>
                                  {statusMessage}
                                </p>
                              ) : null}
                              <div className={invoiceCreatorStyles.invoiceCreateActions}>
                                <button
                                  type="submit"
                                  className={`${creatorStyles.primaryButton} ${invoiceCreatorStyles.invoiceCreatePrimary}`}
                                  disabled={!editingDraftInvoiceId && !selectedProjectId}
                                >
                                  {editingDraftInvoiceId ? "Save Draft" : "Create Invoice"}
                                </button>
                              </div>
                            </>
                          ) : null}
                        </div>
                      </div>

                      <div className={creatorStyles.terms}>
                        <h4>Terms and Conditions</h4>
                        {(termsText || organizationInvoiceDefaults?.invoice_default_terms || "Not set")
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

          </div>
        </>
      ) : null}
    </section>
  );
}
