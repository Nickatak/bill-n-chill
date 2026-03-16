"use client";

/**
 * Primary invoice management console.
 * Project-scoped: receives a project ID from the URL and shows invoices for that project.
 * Combines invoice list with status filtering, status lifecycle management
 * (transitions, notes, history), and a document-creator workspace for creating/editing drafts.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useCreatorFlash } from "@/shared/hooks/use-creator-flash";
import Link from "next/link";
import { formatDateDisplay, formatDateTimeDisplay, todayDateInput, futureDateInput } from "@/shared/date-format";
import { parseAmount, formatDecimal } from "@/shared/money-format";
import {
  dueDateFromIssueDate,
  emptyLine,
  invoiceNextActionHint,
  invoiceStatusEventActionLabel,
  invoiceStatusLabel,
  nextInvoiceNumberPreview,
  publicInvoiceHref,
  readInvoiceApiError,
  validateInvoiceLineItems,
} from "../helpers";
import { useStatusFilters } from "@/shared/hooks/use-status-filters";
import {
  defaultApiBaseUrl,
  fetchInvoicePolicyContract,
  normalizeApiBaseUrl,
} from "../api";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { canDo } from "@/shared/session/rbac";
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
import { useMediaQuery } from "@/shared/hooks/use-media-query";
import { useStatusMessage } from "@/shared/hooks/use-status-message";
import { useClientPagination } from "@/shared/hooks/use-client-pagination";
import { PaginationControls } from "@/shared/components/pagination-controls";
import { usePolicyContract } from "@/shared/hooks/use-policy-contract";
import { usePrintable } from "@/shared/shell/printable-context";
import styles from "./invoices-console.module.css";
import creatorStyles from "@/shared/document-creator/creator-foundation.module.css";
import { MobileLineItemCard } from "@/shared/document-creator/mobile-line-card";
import mobileCardStyles from "@/shared/document-creator/mobile-line-card.module.css";
import invoiceCreatorStyles from "@/shared/document-creator/invoice-creator.module.css";
import stampStyles from "@/shared/styles/decision-stamp.module.css";
import { ReadOnlyLineTable, readOnlyLineTableStyles as roTableStyles } from "@/shared/document-viewer/read-only-line-table";
import { CostCodeCombobox } from "@/features/estimates/components/cost-code-combobox";
import type { CostCode } from "../types";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type ContractBreakdownEstimateLine = {
  id: number;
  cost_code?: number | null;
  cost_code_code?: string;
  description: string;
  quantity: string;
  unit: string;
  unit_cost: string;
  markup_percent: string;
  line_total: string;
};

type ContractBreakdownEstimate = {
  id: number;
  title: string;
  version: number;
  grand_total: string;
  line_items: ContractBreakdownEstimateLine[];
};

type ContractBreakdownCO = {
  id: number;
  title: string;
  family_key: string;
  revision_number: number;
  amount_delta: string;
  line_items: Array<{
    id: number;
    cost_code_code?: string;
    description: string;
    adjustment_reason: string;
    amount_delta: string;
    days_delta: number;
  }>;
};

type ContractBreakdown = {
  active_estimate: ContractBreakdownEstimate | null;
  approved_change_orders: ContractBreakdownCO[];
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
// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Primary invoice management console — project-scoped via URL param. */
type InvoicesConsoleProps = {
  scopedProjectId: number;
};

export function InvoicesConsole({ scopedProjectId }: InvoicesConsoleProps) {
  const isMobile = useMediaQuery("(max-width: 700px)");
  const { token, authMessage, role, capabilities } = useSharedSessionAuth();
  const canMutateInvoices = canDo(capabilities, "invoices", "create");
  const canSendInvoices = canDo(capabilities, "invoices", "send");
  const canEditInvoiceWorkspace = canMutateInvoices;

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);

  const { message: statusMessage, tone: statusTone, setNeutral: setNeutralStatus, setSuccess: setSuccessStatus, setError: setErrorStatus, setMessage: setStatusMessage, clear: clearStatus } = useStatusMessage();
  const [viewerActionMessage, setViewerActionMessage] = useState("");
  const [viewerActionTone, setViewerActionTone] = useState<"success" | "error">("success");
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [invoiceSearch, setInvoiceSearch] = useState("");

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const selectedProjectId = String(scopedProjectId);

  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [selectedInvoiceStatusEvents, setSelectedInvoiceStatusEvents] = useState<
    InvoiceStatusEventRecord[]
  >([]);
  const [statusEventsLoading, setStatusEventsLoading] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("draft");
  const {
    statuses: invoiceStatuses,
    statusLabels: invoiceStatusLabels,
    allowedTransitions: invoiceAllowedStatusTransitions,
  } = usePolicyContract<InvoicePolicyContract>({
    fetchContract: fetchInvoicePolicyContract,
    fallbackStatuses: INVOICE_STATUSES_FALLBACK,
    fallbackLabels: INVOICE_STATUS_LABELS_FALLBACK,
    fallbackTransitions: INVOICE_ALLOWED_STATUS_TRANSITIONS_FALLBACK,
    baseUrl: normalizedBaseUrl,
    token,
    onLoaded(contract) {
      // Reconcile filter state with server-provided statuses.
      const candidateFilters =
        Array.isArray(contract.default_status_filters) && contract.default_status_filters.length
          ? contract.default_status_filters.filter((v) => contract.statuses.includes(v))
          : INVOICE_DEFAULT_STATUS_FILTERS_FALLBACK.filter((v) => contract.statuses.includes(v));
      const resolvedFilters = candidateFilters.length ? candidateFilters : contract.statuses;
      setInvoiceStatusFilters((current) => {
        const preserved = current.filter((v) => contract.statuses.includes(v));
        return preserved.length ? preserved : resolvedFilters;
      });
    },
  });
  const {
    filters: invoiceStatusFilters,
    setFilters: setInvoiceStatusFilters,
    toggleFilter: toggleInvoiceStatusFilter,
  } = useStatusFilters({
    allStatuses: invoiceStatuses,
    defaultFilters: INVOICE_DEFAULT_STATUS_FILTERS_FALLBACK,
  });
  const [statusNote, setStatusNote] = useState("");
  const [organizationInvoiceDefaults, setOrganizationInvoiceDefaults] = useState<OrganizationInvoiceDefaults | null>(null);

  const [issueDate, setIssueDate] = useState(todayDateInput());
  const [dueDate, setDueDate] = useState(futureDateInput());
  const [taxPercent, setTaxPercent] = useState("0");
  const [termsText, setTermsText] = useState("");
  const [lineItems, setLineItems] = useState<InvoiceLineInput[]>([emptyLine(1)]);
  const lineValidation = useMemo(() => validateInvoiceLineItems(lineItems), [lineItems]);
  const [nextLineId, setNextLineId] = useState(2);
  const [workspaceSourceInvoiceId, setWorkspaceSourceInvoiceId] = useState<number | null>(null);
  const [editingDraftInvoiceId, setEditingDraftInvoiceId] = useState<number | null>(null);
  const [workspaceContext, setWorkspaceContext] = useState("New invoice draft");
  const { ref: invoiceCreatorRef, flash: flashCreator } = useCreatorFlash();
  const [contractBreakdown, setContractBreakdown] = useState<ContractBreakdown | null>(null);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const { setPrintable } = usePrintable();

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  useEffect(() => {
    setPrintable(invoices.length > 0);
    return () => setPrintable(false);
  }, [invoices.length, setPrintable]);



  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

  const selectedInvoice = useMemo(
    () => invoices.find((invoice) => String(invoice.id) === selectedInvoiceId) ?? null,
    [invoices, selectedInvoiceId],
  );
  const workspaceSourceInvoice = useMemo(
    () => invoices.find((invoice) => invoice.id === workspaceSourceInvoiceId) ?? null,
    [invoices, workspaceSourceInvoiceId],
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
  const { page: invoicePage, totalPages: invoiceTotalPages, totalCount: invoiceTotalCount, paginatedItems: paginatedInvoices, setPage: setInvoicePage } = useClientPagination(searchedInvoices);
  const nextStatusOptions = useMemo(() => {
    if (!selectedInvoice) {
      return [] as string[];
    }
    const nextStatuses = [...(invoiceAllowedStatusTransitions[selectedInvoice.status] ?? [])];
    if (selectedInvoice.status === "sent" && !nextStatuses.includes("sent")) {
      nextStatuses.unshift("sent");
    }
    return nextStatuses.filter((status) => {
      if (status === "sent") return canSendInvoices;
      return true;
    });
  }, [invoiceAllowedStatusTransitions, selectedInvoice, canSendInvoices]);

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

  // -------------------------------------------------------------------------
  // Data loading & form hydration
  // -------------------------------------------------------------------------

  const loadDependencies = useCallback(
    async (options?: { keepStatusOnSuccess?: boolean }) => {
      if (!token) {
        return;
      }

      setNeutralStatus("Loading...");
      try {
        const [projectsRes, orgRes, costCodesRes] = await Promise.all([
          fetch(`${normalizedBaseUrl}/projects/`, { headers: buildAuthHeaders(token) }),
          fetch(`${normalizedBaseUrl}/organization/`, { headers: buildAuthHeaders(token) }),
          fetch(`${normalizedBaseUrl}/cost-codes/`, { headers: buildAuthHeaders(token) }),
        ]);
        const projectsPayload: ApiResponse = await projectsRes.json();
        const orgPayload: ApiResponse = await orgRes.json();

        if (!projectsRes.ok) {
          setErrorStatus("Failed loading dependencies.");
          return;
        }

        if (costCodesRes.ok) {
          const costCodesPayload: ApiResponse = await costCodesRes.json();
          const costCodeRows = ((costCodesPayload.data as CostCode[]) ?? []).filter((c) => c.is_active);
          setCostCodes(costCodeRows);
        }

        const projectRows = (projectsPayload.data as ProjectRecord[]) ?? [];
        const organizationData = (
          orgPayload.data as { organization?: OrganizationInvoiceDefaults } | undefined
        )?.organization;

        setProjects(projectRows);
        if (orgRes.ok && organizationData) {
          setOrganizationInvoiceDefaults(organizationData);
          setDueDate(dueDateFromIssueDate(issueDate, organizationData.default_invoice_due_delta || 30));
          setTermsText((current) => current || organizationData.invoice_terms_and_conditions || "");
        }

        if (!options?.keepStatusOnSuccess) {
          setStatusMessage("");
        }
      } catch {
        setErrorStatus("Could not reach dependency endpoints.");
      }
    },
    [issueDate, normalizedBaseUrl, setErrorStatus, setNeutralStatus, setStatusMessage, token],
  );


  const loadInvoices = useCallback(
    async (): Promise<InvoiceRecord[]> => {
      if (!token || !scopedProjectId) {
        return [];
      }

      try {
        const response = await fetch(`${normalizedBaseUrl}/projects/${scopedProjectId}/invoices/`, {
          headers: buildAuthHeaders(token),
        });
        const payload: ApiResponse = await response.json();

        if (!response.ok) {
          setErrorStatus(readInvoiceApiError(payload, "Failed loading invoices."));
          return [];
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
        return rows;
      } catch {
        setErrorStatus("Could not reach invoice endpoint.");
        return [];
      }
    },
    [normalizedBaseUrl, scopedProjectId, setErrorStatus, setStatusMessage, token],
  );

  const loadContractBreakdown = useCallback(
    async (projectId: number) => {
      if (!token || !projectId) {
        setContractBreakdown(null);
        return;
      }
      try {
        const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/contract-breakdown/`, {
          headers: buildAuthHeaders(token),
        });
        const payload = await response.json();
        if (!response.ok || !payload.data) {
          setContractBreakdown(null);
          return;
        }
        setContractBreakdown(payload.data as ContractBreakdown);
      } catch {
        setContractBreakdown(null);
      }
    },
    [normalizedBaseUrl, token],
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

  const invoiceToWorkspaceLines = useCallback(
    (invoice: InvoiceRecord): InvoiceLineInput[] => {
      const sourceLines = invoice.line_items ?? [];
      if (!sourceLines.length) {
        return [emptyLine(1)];
      }
      return sourceLines.map((line, index) => ({
        localId: index + 1,
        costCode: line.cost_code ? String(line.cost_code) : "",
        description: line.description || "",
        quantity: line.quantity || "1",
        unit: line.unit || "ea",
        unitPrice: line.unit_price || "0",
      }));
    },
    [],
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

  // -------------------------------------------------------------------------
  // Data-loading effects
  // -------------------------------------------------------------------------


  // Load projects and organization defaults on auth.
  useEffect(() => {
    if (!token) {
      return;
    }
    void loadDependencies();
  }, [loadDependencies, token]);

  // Load invoices and contract breakdown for the scoped project.
  // Auto-load the first invoice into the workspace so the creator reflects the selection.
  useEffect(() => {
    if (!token || !scopedProjectId) {
      setInvoices([]);
      setSelectedInvoiceId("");
      setContractBreakdown(null);
      return;
    }
    void (async () => {
      const rows = await loadInvoices();
      if (rows.length > 0) {
        loadInvoiceIntoWorkspace(rows[0]);
      } else {
        resetCreateDraft();
      }
    })();
    void loadContractBreakdown(scopedProjectId);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- resetCreateDraft is an untracked plain function; adding it would re-fire on every render
  }, [loadContractBreakdown, loadInvoiceIntoWorkspace, loadInvoices, scopedProjectId, token]);

  // Pre-select the most likely next status when the selected invoice changes.
  useEffect(() => {
    if (!selectedInvoice) {
      setSelectedStatus("");
      setStatusNote("");
      return;
    }
    setSelectedStatus((current) =>
      nextStatusOptions.includes(current) ? current : "",
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
    setSelectedStatus("");
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

  // -------------------------------------------------------------------------
  // Line item handlers
  // -------------------------------------------------------------------------

  /** Append a new blank line item to the workspace draft. */
  function addLineItem() {
    if (statusTone === "error" && statusMessage === INVOICE_MIN_LINE_ITEMS_ERROR) {
      clearStatus();
    }
    setLineItems((current) => [...current, emptyLine(nextLineId)]);
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

  /** Update a single field on a line item. */
  function updateLineItem(localId: number, key: keyof Omit<InvoiceLineInput, "localId">, value: string) {
    setLineItems((current) =>
      current.map((line) => {
        if (line.localId !== localId) {
          return line;
        }
        return { ...line, [key]: value };
      }),
    );
  }

  /** Select an invoice from the list and load it into the creator workspace. */
  function handleSelectInvoice(invoice: InvoiceRecord) {
    setSelectedInvoiceId(String(invoice.id));
    setSelectedStatus("");
    setShowAllEvents(false);
    setViewerActionMessage("");
    loadInvoiceIntoWorkspace(invoice);
  }

  /** Reset the creator workspace to a fresh new-draft state. */
  function resetCreateDraft() {
    const nextIssueDate = todayDateInput();
    const dueDays = organizationInvoiceDefaults?.default_invoice_due_delta ?? 30;
    setIssueDate(nextIssueDate);
    setDueDate(dueDateFromIssueDate(nextIssueDate, dueDays));
    setTaxPercent("0");
    setTermsText(organizationInvoiceDefaults?.invoice_terms_and_conditions || "");
    setLineItems([emptyLine(1)]);
    setNextLineId(2);
    setWorkspaceSourceInvoiceId(null);
    setEditingDraftInvoiceId(null);
    setWorkspaceContext("New invoice draft");
  }

  // -------------------------------------------------------------------------
  // Submit & mutation handlers
  // -------------------------------------------------------------------------

  /** Clear the workspace and start a new invoice draft. */
  function handleStartNewInvoiceDraft() {
    resetCreateDraft();
    flashCreator();
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

    if (lineValidation.issues.length > 0) {
      setErrorStatus("Every line item must have a cost code.");
      return;
    }

    if (lineItems.some((line) => !line.description.trim())) {
      setErrorStatus("Each line item requires a description.");
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
          setErrorStatus(readInvoiceApiError(payload, "Save draft failed."));
          return;
        }
        const updated = payload.data as InvoiceRecord;
        setInvoices((current) =>
          current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
        );
        setWorkspaceSourceInvoiceId(updated.id);
        setSelectedInvoiceId(String(updated.id));
        setSelectedStatus("");
        setWorkspaceContext(`Editing ${updated.invoice_number}`);
        setSuccessStatus(`Saved ${updated.invoice_number} draft.`);
        flashCreator();
        return;
      } catch {
        setErrorStatus("Could not reach invoice update endpoint.");
        return;
      }
    }

    setNeutralStatus("Creating invoice...");
    try {
      const createPayload = invoiceCreatorAdapter.toCreatePayload(invoiceDraftFormState);
      const response = await fetch(`${normalizedBaseUrl}/projects/${scopedProjectId}/invoices/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify(createPayload),
      });
      const payload: ApiResponse = await response.json();

      if (!response.ok) {
        setErrorStatus(readInvoiceApiError(payload, "Create invoice failed."));
        return;
      }

      const created = payload.data as InvoiceRecord;
      await loadInvoices();
      setSelectedInvoiceId(String(created.id));
      setSelectedStatus("");
      loadInvoiceIntoWorkspace(created);
      setSuccessStatus(`Created ${created.invoice_number} (${statusLabel(created.status)}).`);
      flashCreator();
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
        setErrorStatus(readInvoiceApiError(payload, "Status update failed."));
        return;
      }

      const updated = payload.data as InvoiceRecord;
      setInvoices((current) =>
        current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
      );
      setSelectedStatus("");
      setStatusNote("");
      await loadInvoiceStatusEvents(updated.id);
      const emailNote = updated.status === "sent" && payload.email_sent === false ? " No email sent — customer has no email on file." : "";
      const msg = `Updated ${updated.invoice_number} to ${statusLabel(updated.status)}. History updated.${emailNote}`;
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
        setErrorStatus(readInvoiceApiError(payload, "Status note update failed."));
        return;
      }
      const updated = payload.data as InvoiceRecord;
      setInvoices((current) =>
        current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
      );
      setSelectedStatus("");
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
  async function handleDuplicateInvoiceIntoDraft() {
    if (!selectedInvoice) {
      setErrorStatus("Select an invoice first.");
      return;
    }
    const nextDraftLines = invoiceToWorkspaceLines(selectedInvoice);
    const nextIssueDate = todayDateInput();
    const nextDueDate = dueDateFromIssueDate(
      nextIssueDate,
      organizationInvoiceDefaults?.default_invoice_due_delta ?? 30,
    );
    const nextTaxPercent = selectedInvoice.tax_percent || "0";
    const nextTermsText = selectedInvoice.terms_text || "";

    setNeutralStatus("Duplicating invoice...");
    try {
      const subtotal = nextDraftLines.reduce((sum, line) => sum + parseAmount(line.quantity) * parseAmount(line.unitPrice), 0);
      const taxAmount = subtotal * (parseAmount(nextTaxPercent) / 100);
      const duplicateFormState: InvoiceFormState = {
        issueDate: nextIssueDate,
        dueDate: nextDueDate,
        taxPercent: nextTaxPercent,
        termsText: nextTermsText,
        subtotal,
        taxAmount,
        totalAmount: subtotal + taxAmount,
        lineItems: nextDraftLines,
      };
      const createPayload = invoiceCreatorAdapter.toCreatePayload(duplicateFormState);
      const response = await fetch(`${normalizedBaseUrl}/projects/${scopedProjectId}/invoices/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify(createPayload),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setErrorStatus(readInvoiceApiError(payload, "Duplicate failed."));
        return;
      }
      const created = payload.data as InvoiceRecord;
      await loadInvoices();
      setSelectedInvoiceId(String(created.id));
      setSelectedStatus("");
      loadInvoiceIntoWorkspace(created);
      setSuccessStatus(`Duplicated as ${created.invoice_number}.`);
      flashCreator();
    } catch {
      setErrorStatus("Could not reach invoice create endpoint.");
    }
  }

  // -------------------------------------------------------------------------
  // Document adapter & branding
  // -------------------------------------------------------------------------

  const selectedProject = projects.find((project) => String(project.id) === selectedProjectId) ?? null;
  const organizationBranding = useMemo(
    () => resolveOrganizationBranding(organizationInvoiceDefaults),
    [organizationInvoiceDefaults],
  );
  const senderDisplayName = organizationBranding.senderDisplayName;
  const senderEmail = organizationBranding.helpEmail;
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
  const statusMessageAtToolbar =
    statusTone === "success" && /^Duplicated\b/i.test(statusMessage);

  // -------------------------------------------------------------------------
  // Contract breakdown (read-only reference)
  // -------------------------------------------------------------------------

  const [isContractBreakdownOpen, setIsContractBreakdownOpen] = useState(false);
  const [flashingButtons, setFlashingButtons] = useState<Set<string>>(new Set());

  function duplicateContractLineToInvoice(lineKey: string, fields: Omit<InvoiceLineInput, "localId">) {
    const id = nextLineId;
    setLineItems((current) => [...current, { localId: id, ...fields }]);
    setNextLineId((value) => value + 1);
    setFlashingButtons((prev) => new Set(prev).add(lineKey));
    setTimeout(() => {
      setFlashingButtons((prev) => {
        const next = new Set(prev);
        next.delete(lineKey);
        return next;
      });
    }, 500);
  }

  function renderDuplicateButton(lineKey: string, fields: Omit<InvoiceLineInput, "localId">) {
    return (
      <button
        type="button"
        className={`${styles.contractDuplicateButton}${flashingButtons.has(lineKey) ? ` ${styles.duplicateFlash}` : ""}`}
        title="Add to invoice"
        onClick={() => duplicateContractLineToInvoice(lineKey, fields)}
      >
        +
      </button>
    );
  }

  /* Contract Breakdown — intentionally not extracted to a shared component.
     Invoice version has per-row duplicate buttons and markup display;
     CO version is read-only with different cost code labels. Extracting
     would create a prop-heavy wrapper with render callbacks. */
  function renderContractBreakdown(opts?: { style?: React.CSSProperties }) {
    if (!contractBreakdown?.active_estimate) return null;
    const estimate = contractBreakdown.active_estimate;
    const approvedCOs = contractBreakdown.approved_change_orders;
    const hasEstimateLines = estimate.line_items.length > 0;
    const hasApprovedCOs = approvedCOs.length > 0;
    if (!hasEstimateLines && !hasApprovedCOs) return null;
    const canDuplicate = !workspaceIsLocked;

    const estimateColumns = ["Cost code", "Description", "Qty", "Unit", "Unit cost", "Markup %", "Line total"];
    const estimateMobileLayout: { order: number; span: "full" | "half"; align?: "left" | "right"; hidden?: boolean }[] = [
      { order: 0, span: "full" },
      { order: 1, span: "full" },
      { order: 2, span: "half", hidden: true },
      { order: 3, span: "half", hidden: true },
      { order: 4, span: "half", hidden: true },
      { order: 5, span: "full" },
      { order: 7, span: "full", align: "right" },
    ];
    const coColumns = ["CO #", "Cost code", "Description", "Days delta", "Amount delta"];
    const coMobileLayout: { order: number; span: "full" | "half"; align?: "left" | "right"; hidden?: boolean }[] = [
      { order: 0, span: "full" },
      { order: 1, span: "half" },
      { order: 2, span: "full" },
      { order: 3, span: "full", align: "right" },
      { order: 5, span: "full", align: "right" },
    ];

    if (canDuplicate) {
      estimateColumns.push("");
      estimateMobileLayout[6] = { order: 7, span: "half", align: "right" };
      estimateMobileLayout.push({ order: 6, span: "half" });
      coColumns.push("");
      coMobileLayout[4] = { order: 5, span: "half", align: "right" };
      coMobileLayout.push({ order: 4, span: "half" });
    }

    return (
      <div className={styles.contractBreakdown} style={opts?.style}>
        <button
          type="button"
          className={styles.contractBreakdownToggle}
          onClick={() => setIsContractBreakdownOpen((v) => !v)}
          aria-expanded={isContractBreakdownOpen}
        >
          <h4>Contract Breakdown</h4>
          <span className={styles.contractBreakdownArrow}>▼</span>
        </button>

        {isContractBreakdownOpen && hasEstimateLines ? (
          <ReadOnlyLineTable
            caption={`Approved Estimate: ${estimate.title} v${estimate.version}`}
            columns={estimateColumns}
            rows={estimate.line_items.map((line) => {
              const qty = parseAmount(line.quantity);
              const markedUpUnitPrice = qty !== 0
                ? formatDecimal(parseAmount(line.line_total) / qty)
                : line.unit_cost;
              const unit = line.unit || "ea";
              const costCodeLabel = line.cost_code_code || "—";
              const cells: React.ReactNode[] = [
                costCodeLabel,
                line.description || "—",
                Number(line.quantity).toFixed(2),
                unit,
                `$${Number(line.unit_cost).toFixed(2)}`,
                `${line.markup_percent}%`,
                <>
                  <span className={roTableStyles.mobileBreakdown}>
                    {Number(line.quantity).toFixed(2)} {unit} × ${Number(line.unit_cost).toFixed(2)}
                    {parseAmount(line.markup_percent) !== 0 ? ` + ${line.markup_percent}%` : ""}
                  </span>
                  <span>${line.line_total}</span>
                </>,
              ];
              if (canDuplicate) {
                cells.push(
                  renderDuplicateButton(`est-${line.id}`, {
                    costCode: line.cost_code ? String(line.cost_code) : "",
                    description: line.description,
                    quantity: line.quantity,
                    unit: line.unit,
                    unitPrice: markedUpUnitPrice,
                  }),
                );
              }
              return { key: line.id, cells };
            })}
            mobileColumnLayout={estimateMobileLayout}
            afterTable={
              <div className={styles.invoiceViewerMetaRow}>
                <span className={styles.invoiceViewerMetaLabel}>Estimate grand total</span>
                <strong>${estimate.grand_total}</strong>
              </div>
            }
          />
        ) : null}

        {isContractBreakdownOpen && hasApprovedCOs ? (
          <ReadOnlyLineTable
            caption={`Approved Change Orders (${approvedCOs.length})`}
            columns={coColumns}
            rows={approvedCOs.flatMap((co) =>
              co.line_items.map((line) => {
                const costCodeLabel = line.cost_code_code || "—";
                const cells: React.ReactNode[] = [
                  co.title,
                  costCodeLabel,
                  line.description || "—",
                  `${line.days_delta} days`,
                  `$${line.amount_delta}`,
                ];
                if (canDuplicate) {
                  cells.push(
                    renderDuplicateButton(`co-${co.id}-${line.id}`, {
                      costCode: String(costCodes.find((c) => c.code === line.cost_code_code)?.id ?? ""),
                      description: line.description,
                      quantity: "1",
                      unit: "",
                      unitPrice: formatDecimal(parseAmount(line.amount_delta)),
                    }),
                  );
                }
                return { key: `${co.id}-${line.id}`, cells };
              }),
            )}
            mobileColumnLayout={coMobileLayout}
            afterTable={
              <div className={styles.invoiceViewerMetaRow}>
                <span className={styles.invoiceViewerMetaLabel}>Net contract total</span>
                <strong>
                  ${formatDecimal(
                    parseAmount(estimate.grand_total) +
                      approvedCOs.reduce((sum, co) => sum + parseAmount(co.amount_delta), 0),
                  )}
                </strong>
              </div>
            }
          />
        ) : null}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <section className={styles.console}>
      {!token ? <p className={styles.authNotice}>{authMessage}</p> : null}

      {statusMessage && !statusMessageAtCreator && !statusMessageAtToolbar ? (
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

          <section className={`${styles.panel} ${styles.viewerPanel}`}>
              <div className={styles.panelHeader}>
                <h3>{selectedProject ? `Invoices for: ${selectedProject.name}` : "Invoices"}</h3>
              </div>

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
                {paginatedInvoices.length ? (
                  paginatedInvoices.map((invoice) => {
                    const isSelected = String(invoice.id) === selectedInvoiceId;
                    return (
                      <article
                        key={invoice.id}
                        className={`${styles.invoiceCard} ${invoiceCardStatusClass(invoice.status)} ${
                          isSelected ? styles.invoiceCardSelected : ""
                        }`}
                        onClick={() => handleSelectInvoice(invoice)}
                        onKeyDown={(event) => {
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
                        </div>
                        <div className={styles.invoiceMetaGrid}>
                          <span><span className={styles.invoiceMetaLabel}>Total</span> ${invoice.total}</span>
                          <span><span className={styles.invoiceMetaLabel}>Due</span> ${invoice.balance_due}</span>
                          <span><span className={styles.invoiceMetaLabel}>Issued</span> {formatDateDisplay(invoice.issue_date)}</span>
                          <span><span className={styles.invoiceMetaLabel}>Due</span> {formatDateDisplay(invoice.due_date)}</span>
                        </div>
                        {invoice.public_ref ? (
                          <div className={styles.invoiceLinkBar}>
                            <a
                              href={publicInvoiceHref(invoice.public_ref)}
                              className={styles.invoiceLinkBarLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => event.stopPropagation()}
                            >
                              Customer View →
                            </a>
                          </div>
                        ) : null}

                        {isSelected && selectedInvoice ? (
                          <div className={styles.invoiceExpandedSections}>
                            {/* Status & Actions — intentionally not extracted to a shared component.
                               The pill/note/button pattern is similar across EST/CO/INV but each
                               console owns its own state, labels, tone classes, and layout variants
                               (e.g. CO wraps in a collapsible). Extracting would just create a
                               ~12-prop wrapper that moves no complexity. CSS consolidation is the
                               real win here, not component extraction. */}
                            <div className={styles.invoiceViewerSection}>
                              <h4 className={styles.invoiceViewerSectionHeading}>Status &amp; Actions</h4>
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
                                          {selectedStatus === "sent" && !selectedProject?.customer_email?.trim() ? (
                                            <p className={styles.invoiceViewerActionError}>WARNING: This customer has no email on file and will not receive an automated email.</p>
                                          ) : null}
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
                                            disabled={!selectedStatus}
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
                            </div>

                            {/* History — intentionally not extracted to a shared component.
                               Different event shapes, actor rendering, and action label functions
                               across CO and invoice consoles. See change-orders-console.tsx. */}
                            <div className={styles.invoiceViewerSection}>
                              <h4 className={styles.invoiceViewerSectionHeading}>History ({selectedInvoiceStatusEvents.length})</h4>
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
                            </div>

                            {/* Line Items */}
                            <div className={styles.invoiceViewerSection}>
                              <h4 className={styles.invoiceViewerSectionHeading}>Line Items ({invoice.line_items?.length ?? 0})</h4>
                                <div className={styles.invoiceViewerSectionContent}>
                                  <ReadOnlyLineTable
                                    columns={["Description", "Qty", "Unit", "Unit Price", "Line Total"]}
                                    rows={(invoice.line_items ?? []).map((line) => ({
                                      key: line.id,
                                      cells: [
                                        line.description || "—",
                                        line.quantity,
                                        line.unit,
                                        `$${line.unit_price}`,
                                        `$${line.line_total}`,
                                      ],
                                    }))}
                                    emptyMessage="No line items."
                                    mobileColumnLayout={[
                                      { order: 0, span: "full" },
                                      { order: 1, span: "half" },
                                      { order: 2, span: "half" },
                                      { order: 3, span: "half" },
                                      { order: 4, span: "half", align: "right" },
                                    ]}
                                  />
                                </div>
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
              <PaginationControls page={invoicePage} totalPages={invoiceTotalPages} totalCount={invoiceTotalCount} onPageChange={setInvoicePage} />
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
                      className={styles.toolbarPrimaryButton}
                      onClick={handleStartNewInvoiceDraft}
                    >
                      {workspaceSourceInvoice ? "Create New Invoice" : "Reset"}
                    </button>
                    {workspaceSourceInvoice ? (
                      <button
                        type="button"
                        className={styles.toolbarSecondaryButton}
                        onClick={handleDuplicateInvoiceIntoDraft}
                      >
                        Duplicate as New Invoice
                      </button>
                    ) : null}
                  </div>
                  {statusMessageAtToolbar ? (
                    <p className={creatorStyles.actionSuccess}>{statusMessage}</p>
                  ) : null}
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
                              {selectedProject?.customer_display_name}
                            </p>
                            <p className={creatorStyles.blockMuted}>
                              {selectedProject
                                ? `#${selectedProject.id} ${selectedProject.name}`
                                : ""}
                            </p>
                          </div>
                        </div>
                        <div className={creatorStyles.headerRight}>
                          <div className={`${creatorStyles.logoBox} ${senderLogoUrl ? creatorStyles.logoBoxHasImage : ""}`}>
                            {senderLogoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo
                              <img
                                className={creatorStyles.logoImage}
                                src={senderLogoUrl}
                                alt={`${senderDisplayName || "Company"} logo`}
                              />
                            ) : "No logo set"}
                          </div>
                          <div className={creatorStyles.sheetTitle}>Invoice</div>
                        </div>
                      </div>

                        <div className={creatorStyles.metaBlock}>
                          <div className={creatorStyles.metaTitle}>Invoice Details</div>
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

                      <div className={invoiceCreatorStyles.invoiceLineSectionIntro}>
                        <h3>Line Items</h3>
                      </div>
                      {workspaceIsLocked ? (
                        <div className={styles.lockedLineTableWrap}>
                        <ReadOnlyLineTable
                          columns={["Cost Code", "Description", "Qty", "Unit", "Unit Price", "Amount"]}
                          rows={lineItems.map((line) => {
                            const lineAmount = parseAmount(line.quantity) * parseAmount(line.unitPrice);
                            return {
                              key: line.localId,
                              cells: [
                                costCodes.find((c) => String(c.id) === line.costCode)?.code || "—",
                                line.description || "—",
                                line.quantity,
                                line.unit,
                                `$${line.unitPrice}`,
                                `$${formatDecimal(lineAmount)}`,
                              ],
                            };
                          })}
                          emptyMessage="No line items."
                          mobileColumnLayout={[
                            { order: 0, span: "full" },
                            { order: 1, span: "full" },
                            { order: 2, span: "half" },
                            { order: 3, span: "half" },
                            { order: 4, span: "half" },
                            { order: 5, span: "half", align: "right" },
                          ]}
                        />
                        </div>
                      ) : isMobile ? (
                        <div className={mobileCardStyles.cardList}>
                          {lineItems.map((line, index) => {
                            const lineAmount = parseAmount(line.quantity) * parseAmount(line.unitPrice);
                            const rowIssues = lineValidation.issuesByLocalId.get(line.localId) ?? [];
                            return (
                              <MobileLineItemCard
                                key={line.localId}
                                index={index}
                                readOnly={false}
                                isFirst={index === 0}
                                isLast={index === lineItems.length - 1}
                                onRemove={() => removeLineItem(line.localId)}
                                validationError={rowIssues.length ? `Row ${index + 1}: ${rowIssues.join(" ")}` : undefined}
                                fields={[
                                  {
                                    label: "Description",
                                    key: "description",
                                    span: "full",
                                    render: () => (
                                      <input
                                        className={mobileCardStyles.fieldInput}
                                        value={line.description}
                                        onChange={(event) => updateLineItem(line.localId, "description", event.target.value)}
                                      />
                                    ),
                                  },
                                  {
                                    label: "Cost Code",
                                    key: "costCode",
                                    span: "full",
                                    render: () => (
                                      <CostCodeCombobox
                                        costCodes={costCodes}
                                        value={line.costCode}
                                        onChange={(nextValue) => updateLineItem(line.localId, "costCode", nextValue)}
                                        ariaLabel="Cost code"
                                        allowEmptySelection
                                        emptySelectionLabel="No cost code (optional)"
                                        placeholder="Search cost code"
                                      />
                                    ),
                                  },
                                  {
                                    label: "Qty",
                                    key: "quantity",
                                    render: () => (
                                      <input
                                        className={mobileCardStyles.fieldInput}
                                        value={line.quantity}
                                        onChange={(event) => updateLineItem(line.localId, "quantity", event.target.value)}
                                        inputMode="decimal"
                                      />
                                    ),
                                  },
                                  {
                                    label: "Unit",
                                    key: "unit",
                                    render: () => (
                                      <input
                                        className={mobileCardStyles.fieldInput}
                                        value={line.unit}
                                        onChange={(event) => updateLineItem(line.localId, "unit", event.target.value)}
                                      />
                                    ),
                                  },
                                  {
                                    label: "Unit Price",
                                    key: "unitPrice",
                                    render: () => (
                                      <input
                                        className={mobileCardStyles.fieldInput}
                                        value={line.unitPrice}
                                        onChange={(event) => updateLineItem(line.localId, "unitPrice", event.target.value)}
                                        inputMode="decimal"
                                      />
                                    ),
                                  },
                                  {
                                    label: "Amount",
                                    key: "amount",
                                    render: () => (
                                      <span className={mobileCardStyles.fieldStatic}>
                                        ${formatDecimal(lineAmount)}
                                      </span>
                                    ),
                                  },
                                ]}
                              />
                            );
                          })}
                        </div>
                      ) : (
                        <div className={creatorStyles.lineTable}>
                          <div className={invoiceCreatorStyles.invoiceLineHeader}>
                            <span>Cost Code</span>
                            <span>Description</span>
                            <span>Qty</span>
                            <span>Unit</span>
                            <span>Unit price</span>
                            <span>Amount</span>
                            <span>Actions</span>
                          </div>
                          {lineItems.map((line, index) => {
                            const lineAmount = parseAmount(line.quantity) * parseAmount(line.unitPrice);
                            const rowIssues = lineValidation.issuesByLocalId.get(line.localId) ?? [];
                            return (
                              <div
                                key={line.localId}
                                className={`${invoiceCreatorStyles.invoiceLineRow} ${index % 2 === 1 ? invoiceCreatorStyles.invoiceLineRowAlt : ""} ${rowIssues.length ? creatorStyles.lineRowInvalid : ""}`}
                              >
                                <div>
                                  <span className={creatorStyles.printOnly}>
                                    {costCodes.find((c) => String(c.id) === line.costCode)?.code || "—"}
                                  </span>
                                  <span className={creatorStyles.screenOnly}>
                                    <CostCodeCombobox
                                      costCodes={costCodes}
                                      value={line.costCode}
                                      onChange={(nextValue) => updateLineItem(line.localId, "costCode", nextValue)}
                                      ariaLabel="Cost code"
                                      allowEmptySelection
                                      emptySelectionLabel="No cost code (optional)"
                                      placeholder="Search cost code"
                                    />
                                  </span>
                                </div>
                                <input
                                  className={`${creatorStyles.lineInput} ${invoiceCreatorStyles.invoiceLockableControl}`}
                                  value={line.description}
                                  onChange={(event) =>
                                    updateLineItem(line.localId, "description", event.target.value)
                                  }
                                />
                                <input
                                  className={`${creatorStyles.lineInput} ${invoiceCreatorStyles.invoiceLockableControl}`}
                                  value={line.quantity}
                                  onChange={(event) =>
                                    updateLineItem(line.localId, "quantity", event.target.value)
                                  }
                                  inputMode="decimal"
                                />
                                <input
                                  className={`${creatorStyles.lineInput} ${invoiceCreatorStyles.invoiceLockableControl}`}
                                  value={line.unit}
                                  onChange={(event) => updateLineItem(line.localId, "unit", event.target.value)}
                                />
                                <input
                                  className={`${creatorStyles.lineInput} ${invoiceCreatorStyles.invoiceLockableControl}`}
                                  value={line.unitPrice}
                                  onChange={(event) =>
                                    updateLineItem(line.localId, "unitPrice", event.target.value)
                                  }
                                  inputMode="decimal"
                                />
                                <span className={`${creatorStyles.amountCell} ${invoiceCreatorStyles.invoiceReadAmount}`}>
                                  ${formatDecimal(lineAmount)}
                                </span>
                                <div className={invoiceCreatorStyles.invoiceLineActionsCell}>
                                  <button
                                    type="button"
                                    className={creatorStyles.smallButton}
                                    onClick={() => removeLineItem(line.localId)}
                                  >
                                    Remove
                                  </button>
                                </div>
                                {rowIssues.length ? (
                                  <p className={creatorStyles.lineIssue}>
                                    Row {index + 1}: {rowIssues.join(" ")}
                                  </p>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      )}

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

                      {renderContractBreakdown({ style: { marginTop: "var(--space-md)" } })}

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
                        {(termsText || organizationInvoiceDefaults?.invoice_terms_and_conditions || "Not set")
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
              {workspaceSourceInvoice?.status === "paid" ? (
                <div className={`${stampStyles.decisionStamp} ${stampStyles.decisionStampPaid}`}>
                  <p className={stampStyles.decisionStampLabel}>Paid</p>
                </div>
              ) : null}

          </div>
      </>
      ) : null}
    </section>
  );
}
