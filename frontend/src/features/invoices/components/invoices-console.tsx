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
import { todayDateInput, futureDateInput } from "@/shared/date-format";
import { parseAmount } from "@/shared/money-format";
import {
  dueDateFromIssueDate,
  emptyLine,
  invoiceStatusLabel,
  nextInvoiceNumberPreview,
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
import {
  resolveOrganizationBranding,
} from "@/shared/document-creator";
import {
  createInvoiceDocumentAdapter,
  InvoiceFormState,
  toInvoiceStatusPolicy,
} from "../document-adapter";
import { useMediaQuery } from "@/shared/hooks/use-media-query";
import { useLineItems } from "@/shared/hooks/use-line-items";
import { useStatusMessage } from "@/shared/hooks/use-status-message";
import { useClientPagination } from "@/shared/hooks/use-client-pagination";
import { usePolicyContract } from "@/shared/hooks/use-policy-contract";
import { usePrintable } from "@/shared/shell/printable-context";
import styles from "./invoices-console.module.css";
import type { CostCode } from "../types";
import { InvoicesViewerPanel } from "./invoices-viewer-panel";
import { InvoicesWorkspacePanel } from "./invoices-workspace-panel";

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
// Most display helpers moved to invoices-viewer-panel.tsx. Only invoiceStatusClass
// is retained here because workspaceBadgeClass depends on it.

/** Map an invoice status to its CSS module class for badge coloring. */
function invoiceStatusClass(status: string): string {
  if (status === "draft") return styles.statusDraft;
  if (status === "sent") return styles.statusSent;
  if (status === "partially_paid") return styles.statusPartial;
  if (status === "paid") return styles.statusPaid;
  if (status === "void") return styles.statusVoid;
  return "";
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
  const {
    items: lineItems,
    setItems: setLineItems,
    nextId: nextLineId,
    setNextId: setNextLineId,
    add: addLine,
    remove: removeLine,
    update: updateLine,
    reset: resetLines,
  } = useLineItems<InvoiceLineInput>({ createEmpty: emptyLine });
  const lineValidation = useMemo(() => validateInvoiceLineItems(lineItems), [lineItems]);
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
    [invoiceToWorkspaceLines, setLineItems, setNextLineId],
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
    addLine();
  }

  /** Remove a line item by local ID, enforcing the minimum-one-line constraint. */
  function removeLineItem(localId: number) {
    if (!removeLine(localId)) {
      setErrorStatus(INVOICE_MIN_LINE_ITEMS_ERROR);
    }
  }

  /** Update a single field on a line item. */
  function updateLineItem(localId: number, key: keyof Omit<InvoiceLineInput, "localId">, value: string) {
    updateLine(localId, { [key]: value });
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
    resetLines();
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

  // renderDuplicateButton and renderContractBreakdown moved to invoices-viewer-panel.tsx.

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

          <InvoicesViewerPanel
            selectedProject={selectedProject}
            invoiceSearch={invoiceSearch}
            onInvoiceSearchChange={setInvoiceSearch}
            invoiceStatuses={invoiceStatuses}
            invoiceStatusFilters={invoiceStatusFilters}
            toggleInvoiceStatusFilter={toggleInvoiceStatusFilter}
            invoiceStatusTotals={invoiceStatusTotals}
            statusLabel={statusLabel}
            paginatedInvoices={paginatedInvoices}
            invoices={invoices}
            invoiceNeedle={invoiceNeedle}
            selectedInvoiceId={selectedInvoiceId}
            onSelectInvoice={handleSelectInvoice}
            invoicePage={invoicePage}
            invoiceTotalPages={invoiceTotalPages}
            invoiceTotalCount={invoiceTotalCount}
            setInvoicePage={setInvoicePage}
            selectedInvoice={selectedInvoice}
            canMutateInvoices={canMutateInvoices}
            nextStatusOptions={nextStatusOptions}
            selectedStatus={selectedStatus}
            setSelectedStatus={setSelectedStatus}
            statusNote={statusNote}
            setStatusNote={setStatusNote}
            viewerActionMessage={viewerActionMessage}
            viewerActionTone={viewerActionTone}
            onUpdateStatus={handleUpdateInvoiceStatus}
            onAddStatusNote={handleAddInvoiceStatusNote}
            selectedInvoiceStatusEvents={selectedInvoiceStatusEvents}
            statusEventsLoading={statusEventsLoading}
            showAllEvents={showAllEvents}
            setShowAllEvents={setShowAllEvents}
            contractBreakdown={contractBreakdown}
            isContractBreakdownOpen={isContractBreakdownOpen}
            setIsContractBreakdownOpen={setIsContractBreakdownOpen}
            workspaceIsLocked={workspaceIsLocked}
            costCodes={costCodes}
            flashingButtons={flashingButtons}
            onDuplicateContractLine={duplicateContractLineToInvoice}
          />

          <InvoicesWorkspacePanel
            isMobile={isMobile}
            canMutateInvoices={canMutateInvoices}
            workspaceSourceInvoice={workspaceSourceInvoice}
            workspaceIsLocked={workspaceIsLocked}
            workspaceContext={workspaceContext}
            workspaceBadgeLabel={workspaceBadgeLabel}
            workspaceBadgeClass={workspaceBadgeClass}
            editingDraftInvoiceId={editingDraftInvoiceId}
            onStartNewDraft={handleStartNewInvoiceDraft}
            onDuplicateIntoDraft={handleDuplicateInvoiceIntoDraft}
            statusMessageAtToolbar={statusMessageAtToolbar}
            statusMessage={statusMessage}
            invoiceCreatorRef={invoiceCreatorRef}
            invoiceCreatorAdapter={invoiceCreatorAdapter}
            invoiceDraftFormState={invoiceDraftFormState}
            senderDisplayName={senderDisplayName}
            senderEmail={senderEmail}
            senderAddressLines={senderAddressLines}
            senderLogoUrl={senderLogoUrl}
            selectedProject={selectedProject}
            workspaceInvoiceNumber={workspaceInvoiceNumber}
            issueDate={issueDate}
            onIssueDateChange={setIssueDate}
            dueDate={dueDate}
            onDueDateChange={setDueDate}
            lineItems={lineItems}
            lineValidation={lineValidation}
            costCodes={costCodes}
            onAddLineItem={addLineItem}
            onRemoveLineItem={removeLineItem}
            onUpdateLineItem={updateLineItem}
            draftLineSubtotal={draftLineSubtotal}
            draftTaxTotal={draftTaxTotal}
            draftTotal={draftTotal}
            taxPercent={taxPercent}
            onTaxPercentChange={setTaxPercent}
            onSubmit={handleCreateInvoice}
            statusMessageAtCreator={statusMessageAtCreator}
            termsText={termsText}
            organizationInvoiceDefaults={organizationInvoiceDefaults}
          />
      </>
      ) : null}
    </section>
  );
}
