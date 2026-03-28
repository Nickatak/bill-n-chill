"use client";

/**
 * Primary invoice management console — project-scoped via URL param.
 *
 * Orchestrator: owns no domain data itself. Composes single-purpose hooks,
 * wires their outputs into child components, and handles cross-hook
 * coordination (mutations, selection sync, workspace hydration).
 *
 * Parent: app/projects/[projectId]/invoices/page.tsx
 *
 * ## Page layout
 *
 * ┌─────────────────────────────────────────┐
 * │ Status banner (conditional)             │
 * ├─────────────────────────────────────────┤
 * │ Read-only notice (conditional)          │
 * ├──────────────────┬──────────────────────┤
 * │ InvoicesViewer   │ InvoicesWorkspace    │
 * │   ├── Filters    │   ├── Toolbar        │
 * │   ├── List       │   ├── Creator sheet  │
 * │   ├── Pagination │   └── Terms/totals   │
 * │   ├── Status     │                      │
 * │   │   actions    │                      │
 * │   └── Contract   │                      │
 * │       breakdown  │                      │
 * └──────────────────┴──────────────────────┘
 *
 * ## Hook dependency graph
 *
 * useInvoiceData      (owns fetched data — projects, invoices, org, cost codes, events)
 *   └── useInvoiceFormFields  (reads orgDefaults for reset; writes lineItems via setters)
 * useLineItems        (shared hook — line item CRUD)
 * useStatusFilters    (shared hook — filter pill state)
 * usePolicyContract   (shared hook — policy contract fetch)
 * useStatusMessage    (shared hook — status banner)
 * useClientPagination (shared hook — client-side pagination)
 * useCreatorFlash     (shared hook — creator flash animation)
 *
 * ## Functions
 *
 * - handleSelectInvoice, handleStartNewInvoiceDraft, handleCreateInvoice,
 *   handleUpdateInvoiceStatus, handleAddInvoiceStatusNote,
 *   handleDuplicateInvoiceIntoDraft — mutation and selection handlers that
 *   coordinate across data + form hooks.
 *
 * ## Effects
 *
 * - Sync printable flag with invoice count.
 * - Pre-select next status when selected invoice changes.
 * - Ensure selected invoice is visible after filter changes.
 * - Load status events when selected invoice changes.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useCreatorFlash } from "@/shared/hooks/use-creator-flash";
import { todayDateInput } from "@/shared/date-format";
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
  fetchInvoicePolicyContract,
} from "../api";
import { apiBaseUrl } from "@/shared/api/base";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { canDo } from "@/shared/session/rbac";
import type {
  ApiResponse,
  InvoiceLineInput,
  InvoicePolicyContract,
  InvoiceRecord,
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
import { useInvoiceData } from "../hooks/use-invoice-data";
import { useInvoiceFormFields } from "../hooks/use-invoice-form-fields";
import styles from "./invoices-console.module.css";
import { InvoicesViewerPanel } from "./invoices-viewer-panel";
import { InvoicesWorkspacePanel } from "./invoices-workspace-panel";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INVOICE_STATUSES_FALLBACK = ["draft", "sent", "outstanding", "closed", "void"];

const INVOICE_STATUS_LABELS_FALLBACK: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  outstanding: "Outstanding",
  closed: "Closed",
  void: "Void",
};

const INVOICE_ALLOWED_STATUS_TRANSITIONS_FALLBACK: Record<string, string[]> = {
  draft: ["sent", "void"],
  sent: ["closed", "void"],
  outstanding: ["closed"],
  closed: [],
  void: [],
};

const INVOICE_DEFAULT_STATUS_FILTERS_FALLBACK = ["draft", "sent", "outstanding"];
const INVOICE_TERMINAL_STATUSES_FALLBACK = ["closed", "void"];
const INVOICE_MIN_LINE_ITEMS_ERROR = "At least one line item is required.";

// Most display helpers moved to invoices-viewer-panel.tsx. Only invoiceStatusClass
// is retained here because workspaceBadgeClass depends on it.

/** Map an invoice status to its CSS module class for badge coloring. */
function invoiceStatusClass(status: string): string {
  if (status === "draft") return styles.statusDraft;
  if (status === "sent") return styles.statusSent;
  if (status === "outstanding") return styles.statusOutstanding;
  if (status === "closed") return styles.statusClosed;
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
  const isMobile = useMediaQuery("(max-width: 850px)");
  const { token: authToken, authMessage, role, capabilities } = useSharedSessionAuth();
  const canMutateInvoices = canDo(capabilities, "invoices", "create");
  const canSendInvoices = canDo(capabilities, "invoices", "send");
  const canEditInvoiceWorkspace = canMutateInvoices;

  // -------------------------------------------------------------------------
  // Shared hooks
  // -------------------------------------------------------------------------

  const { message: statusMessage, tone: statusTone, setNeutral: setNeutralStatus, setSuccess: setSuccessStatus, setError: setErrorStatus, setMessage: setStatusMessage, clear: clearStatus } = useStatusMessage();

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

  const { ref: invoiceCreatorRef, flash: flashCreator } = useCreatorFlash();
  const { setPrintable } = usePrintable();

  // -------------------------------------------------------------------------
  // Domain hooks
  // -------------------------------------------------------------------------

  const formFields = useInvoiceFormFields({
    organizationInvoiceDefaults: null, // Populated after data loads — see resetCreateDraft override
    setLineItems,
    setNextLineId,
    resetLines,
  });

  // Stable references for status message setters (avoid re-creating on every render).
  const statusSetters = useMemo(
    () => ({ setNeutralStatus, setErrorStatus, setStatusMessage }),
    [setNeutralStatus, setErrorStatus, setStatusMessage],
  );
  const formSetters = useMemo(
    () => ({ setDueDate: formFields.setDueDate, setTermsText: formFields.setTermsText }),
    [formFields.setDueDate, formFields.setTermsText],
  );

  const handleInitialLoad = useCallback(
    (rows: InvoiceRecord[]) => {
      if (rows.length > 0) {
        formFields.loadInvoiceIntoWorkspace(rows[0]);
      } else {
        formFields.resetCreateDraft();
      }
    },
    [formFields],
  );

  const invoiceData = useInvoiceData({
    authToken,
    scopedProjectId,
    issueDate: formFields.issueDate,
    status: statusSetters,
    formSetters,
    onInitialLoad: handleInitialLoad,
  });

  // Re-bind resetCreateDraft to use the live org defaults (the formFields hook
  // was initialized with null; the data hook hydrates org defaults after mount).
  // We override the form hook's resetCreateDraft in local scope below.

  // -------------------------------------------------------------------------
  // Viewer state (local — small enough to stay in the orchestrator)
  // -------------------------------------------------------------------------

  const [viewerActionMessage, setViewerActionMessage] = useState("");
  const [viewerActionTone, setViewerActionTone] = useState<"success" | "error">("success");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("draft");
  const [statusNote, setStatusNote] = useState("");
  const [isContractBreakdownOpen, setIsContractBreakdownOpen] = useState(false);
  const [flashingButtons, setFlashingButtons] = useState<Set<string>>(new Set());

  const selectedProjectId = String(scopedProjectId);

  // -------------------------------------------------------------------------
  // Policy contract
  // -------------------------------------------------------------------------

  const {
    statuses: invoiceStatuses,
    statusLabels: invoiceStatusLabels,
    allowedTransitions: invoiceAllowedStatusTransitions,
  } = usePolicyContract<InvoicePolicyContract>({
    fetchContract: fetchInvoicePolicyContract,
    fallbackStatuses: INVOICE_STATUSES_FALLBACK,
    fallbackLabels: INVOICE_STATUS_LABELS_FALLBACK,
    fallbackTransitions: INVOICE_ALLOWED_STATUS_TRANSITIONS_FALLBACK,
    baseUrl: apiBaseUrl,
    authToken,
    onLoaded(contract) {
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

  // -------------------------------------------------------------------------
  // Line items
  // -------------------------------------------------------------------------

  const lineValidation = useMemo(() => validateInvoiceLineItems(lineItems), [lineItems]);

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  useEffect(() => {
    setPrintable(invoiceData.invoices.length > 0);
    return () => setPrintable(false);
  }, [invoiceData.invoices.length, setPrintable]);

  // Auto-select first invoice after data load — keep selectedInvoiceId in sync.
  useEffect(() => {
    if (!authToken || !scopedProjectId) {
      setSelectedInvoiceId("");
      return;
    }
    setSelectedInvoiceId((current) => {
      if (current && invoiceData.invoices.some((row) => String(row.id) === current)) {
        return current;
      }
      return invoiceData.invoices[0] ? String(invoiceData.invoices[0].id) : "";
    });
  }, [invoiceData.invoices, scopedProjectId, authToken]);

  // Pre-select the most likely next status when the selected invoice changes.
  const selectedInvoice = useMemo(
    () => invoiceData.invoices.find((invoice) => String(invoice.id) === selectedInvoiceId) ?? null,
    [invoiceData.invoices, selectedInvoiceId],
  );

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
  const filteredInvoices = useMemo(() => {
    if (!invoiceStatusFilters.length) {
      return [];
    }
    return invoiceData.invoices.filter((invoice) => invoiceStatusFilters.includes(invoice.status));
  }, [invoiceStatusFilters, invoiceData.invoices]);

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
      invoiceData.setSelectedInvoiceStatusEvents([]);
      invoiceData.setStatusEventsLoading(false);
      return;
    }
    void invoiceData.loadInvoiceStatusEvents(invoiceId);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- invoiceData setters are stable
  }, [invoiceData.loadInvoiceStatusEvents, selectedInvoiceId]);

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

  const workspaceSourceInvoice = useMemo(
    () => invoiceData.invoices.find((invoice) => invoice.id === formFields.workspaceSourceInvoiceId) ?? null,
    [invoiceData.invoices, formFields.workspaceSourceInvoiceId],
  );

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

  const invoiceStatusTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of invoiceData.invoices) {
      totals.set(row.status, (totals.get(row.status) ?? 0) + 1);
    }
    return totals;
  }, [invoiceData.invoices]);

  const selectedProject = invoiceData.projects.find((project) => String(project.id) === selectedProjectId) ?? null;
  const isProjectCancelled = selectedProject?.status === "cancelled";
  const nextDraftInvoiceNumber = useMemo(() => nextInvoiceNumberPreview(invoiceData.invoices), [invoiceData.invoices]);
  const workspaceInvoiceNumber = workspaceSourceInvoice?.invoice_number ?? nextDraftInvoiceNumber;
  const workspaceIsLockedByStatus = workspaceSourceInvoice ? workspaceSourceInvoice.status !== "draft" : false;
  const workspaceIsLocked = !canEditInvoiceWorkspace || isProjectCancelled || workspaceIsLockedByStatus;
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
    return draftLineSubtotal * (parseAmount(formFields.taxPercent) / 100);
  }, [draftLineSubtotal, formFields.taxPercent]);

  const draftTotal = useMemo(() => draftLineSubtotal + draftTaxTotal, [draftLineSubtotal, draftTaxTotal]);

  const statusLabel = useCallback(
    (status: string) => invoiceStatusLabels[status] ?? invoiceStatusLabel(status),
    [invoiceStatusLabels],
  );

  // -------------------------------------------------------------------------
  // Document adapter & branding
  // -------------------------------------------------------------------------

  const organizationBranding = useMemo(
    () => resolveOrganizationBranding(invoiceData.organizationInvoiceDefaults),
    [invoiceData.organizationInvoiceDefaults],
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
      issueDate: formFields.issueDate,
      dueDate: formFields.dueDate,
      taxPercent: formFields.taxPercent,
      termsText: formFields.termsText,
      subtotal: draftLineSubtotal,
      taxAmount: draftTaxTotal,
      totalAmount: draftTotal,
      lineItems,
    }),
    [
      draftLineSubtotal,
      draftTaxTotal,
      draftTotal,
      formFields.dueDate,
      formFields.issueDate,
      lineItems,
      formFields.taxPercent,
      formFields.termsText,
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

  // -------------------------------------------------------------------------
  // Selection & workspace handlers
  // -------------------------------------------------------------------------

  /** Select an invoice from the list and load it into the creator workspace. */
  function handleSelectInvoice(invoice: InvoiceRecord) {
    setSelectedInvoiceId(String(invoice.id));
    setSelectedStatus("");
    setViewerActionMessage("");
    formFields.loadInvoiceIntoWorkspace(invoice);
  }

  /** Reset the creator workspace to a fresh new-draft state. */
  function resetCreateDraft() {
    const nextIssueDate = todayDateInput();
    const dueDays = invoiceData.organizationInvoiceDefaults?.default_invoice_due_delta ?? 30;
    formFields.setIssueDate(nextIssueDate);
    formFields.setDueDate(dueDateFromIssueDate(nextIssueDate, dueDays));
    formFields.setTaxPercent("0");
    formFields.setTermsText(invoiceData.organizationInvoiceDefaults?.invoice_terms_and_conditions || "");
    resetLines();
    formFields.setWorkspaceSourceInvoiceId(null);
    formFields.setEditingDraftInvoiceId(null);
    formFields.setWorkspaceContext("New invoice draft");
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

    if (formFields.editingDraftInvoiceId) {
      setNeutralStatus("Saving draft invoice...");
      try {
        const currentDraft = invoiceData.invoices.find((invoice) => invoice.id === formFields.editingDraftInvoiceId);
        if (!currentDraft) {
          setErrorStatus("Draft context is stale. Re-select the invoice and try again.");
          return;
        }
        const updatePayload = invoiceCreatorAdapter.toUpdatePayload(invoiceDraftFormState, currentDraft);
        const response = await fetch(`${apiBaseUrl}/invoices/${formFields.editingDraftInvoiceId}/`, {
          method: "PATCH",
          headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
          body: JSON.stringify(updatePayload),
        });
        const payload: ApiResponse = await response.json();
        if (!response.ok) {
          setErrorStatus(readInvoiceApiError(payload, "Save draft failed."));
          return;
        }
        const updated = payload.data as InvoiceRecord;
        invoiceData.setInvoices((current) =>
          current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
        );
        formFields.setWorkspaceSourceInvoiceId(updated.id);
        setSelectedInvoiceId(String(updated.id));
        setSelectedStatus("");
        formFields.setWorkspaceContext(`Editing ${updated.invoice_number}`);
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
      const response = await fetch(`${apiBaseUrl}/projects/${scopedProjectId}/invoices/`, {
        method: "POST",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify(createPayload),
      });
      const payload: ApiResponse = await response.json();

      if (!response.ok) {
        setErrorStatus(readInvoiceApiError(payload, "Create invoice failed."));
        return;
      }

      const created = payload.data as InvoiceRecord;
      await invoiceData.loadInvoices();
      setSelectedInvoiceId(String(created.id));
      setSelectedStatus("");
      formFields.loadInvoiceIntoWorkspace(created);
      setSuccessStatus(`Created ${created.invoice_number} (${statusLabel(created.status)}).`);
      flashCreator();
    } catch {
      setErrorStatus("Could not reach invoice create endpoint.");
    }
  }

  /** Transition the selected invoice to a new status, with optional status note. */
  async function handleUpdateInvoiceStatus(): Promise<InvoiceRecord | null> {
    if (!canMutateInvoices) {
      setErrorStatus(`Role ${role} is read-only for invoice mutations.`);
      return null;
    }

    const invoiceId = Number(selectedInvoiceId);
    if (!invoiceId) {
      setErrorStatus("Select an invoice first.");
      return null;
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
      const response = await fetch(`${apiBaseUrl}/invoices/${invoiceId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify(patchPayload),
      });
      const payload: ApiResponse = await response.json();

      if (!response.ok) {
        const msg = readInvoiceApiError(payload, "Status update failed.");
        setErrorStatus(msg);
        setViewerActionMessage(msg);
        setViewerActionTone("error");
        return null;
      }

      const updated = payload.data as InvoiceRecord;
      invoiceData.setInvoices((current) =>
        current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
      );
      setSelectedStatus("");
      setStatusNote("");
      await invoiceData.loadInvoiceStatusEvents(updated.id);
      const emailNote = updated.status === "sent" && payload.email_sent === false ? " No email sent — customer has no email on file." : "";
      const msg = `Updated ${updated.invoice_number} to ${statusLabel(updated.status)}. History updated.${emailNote}`;
      setSuccessStatus(msg);
      setViewerActionMessage(msg);
      setViewerActionTone("success");
      return updated;
    } catch {
      const msg = "Could not reach invoice status endpoint.";
      setErrorStatus(msg);
      setViewerActionMessage(msg);
      setViewerActionTone("error");
      return null;
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
      const response = await fetch(`${apiBaseUrl}/invoices/${invoiceId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
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
      invoiceData.setInvoices((current) =>
        current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
      );
      setSelectedStatus("");
      setStatusNote("");
      await invoiceData.loadInvoiceStatusEvents(updated.id);
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

  /** Pre-fill workspace from selected invoice for duplication (user reviews + submits). */
  function handleDuplicateInvoiceIntoDraft() {
    if (!selectedInvoice) {
      setErrorStatus("Select an invoice first.");
      return;
    }
    formFields.populateCreateFromInvoice(selectedInvoice);
    setSelectedInvoiceId("");
    setSuccessStatus(`Copied ${selectedInvoice.invoice_number} into create form.`);
    flashCreator();
  }

  // -------------------------------------------------------------------------
  // Contract breakdown (read-only reference)
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <section className={styles.console}>
      {!authToken ? <p className={styles.authNotice}>{authMessage}</p> : null}

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

      {authToken ? (
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
            invoices={invoiceData.invoices}
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
            selectedInvoiceStatusEvents={invoiceData.selectedInvoiceStatusEvents}
            statusEventsLoading={invoiceData.statusEventsLoading}
            contractBreakdown={invoiceData.contractBreakdown}
            isContractBreakdownOpen={isContractBreakdownOpen}
            setIsContractBreakdownOpen={setIsContractBreakdownOpen}
            workspaceIsLocked={workspaceIsLocked}
            costCodes={invoiceData.costCodes}
            flashingButtons={flashingButtons}
            onDuplicateContractLine={duplicateContractLineToInvoice}
          />

          <InvoicesWorkspacePanel
            isMobile={isMobile}
            canMutateInvoices={canMutateInvoices}
            workspaceSourceInvoice={workspaceSourceInvoice}
            workspaceIsLocked={workspaceIsLocked}
            workspaceContext={formFields.workspaceContext}
            workspaceBadgeLabel={workspaceBadgeLabel}
            workspaceBadgeClass={workspaceBadgeClass}
            editingDraftInvoiceId={formFields.editingDraftInvoiceId}
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
            issueDate={formFields.issueDate}
            onIssueDateChange={formFields.setIssueDate}
            dueDate={formFields.dueDate}
            onDueDateChange={formFields.setDueDate}
            lineItems={lineItems}
            lineValidation={lineValidation}
            costCodes={invoiceData.costCodes}
            onAddLineItem={addLineItem}
            onRemoveLineItem={removeLineItem}
            onUpdateLineItem={updateLineItem}
            draftLineSubtotal={draftLineSubtotal}
            draftTaxTotal={draftTaxTotal}
            draftTotal={draftTotal}
            taxPercent={formFields.taxPercent}
            onTaxPercentChange={formFields.setTaxPercent}
            onSubmit={handleCreateInvoice}
            statusMessageAtCreator={statusMessageAtCreator}
            termsText={formFields.termsText}
            organizationInvoiceDefaults={invoiceData.organizationInvoiceDefaults}
          />
      </>
      ) : null}
    </section>
  );
}
