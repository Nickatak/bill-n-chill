"use client";

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatDateDisplay, formatDateTimeDisplay } from "@/shared/date-format";
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
import { DocumentComposer } from "@/shared/document-composer";
import {
  resolveOrganizationBranding,
  toAddressLines,
} from "@/shared/document-composer";
import {
  createInvoiceDocumentAdapter,
  InvoiceFormState,
  toInvoiceStatusPolicy,
} from "../document-adapter";
import styles from "./invoices-console.module.css";
import estimateStyles from "../../estimates/components/estimates-console.module.css";

type StatusTone = "neutral" | "success" | "error";
type ProjectStatusValue = "prospect" | "active" | "on_hold" | "completed" | "cancelled";
type ProjectBudgetRecord = {
  id: number;
  status: string;
  source_estimate: number | null;
  source_estimate_version?: number | null;
  baseline_snapshot_json?: {
    estimate?: {
      title?: string;
    };
  };
  line_items?: Array<{
    id: number;
    scope_item: number | null;
    cost_code_code: string;
    description: string;
  }>;
};
type BudgetLineOption = {
  id: number;
  scopeItemId: number | null;
  costCodeCode: string;
  description: string;
  label: string;
  groupLabel: string;
};

const INVOICE_STATUSES_FALLBACK = ["draft", "sent", "partially_paid", "paid", "overdue", "void"];

const INVOICE_STATUS_LABELS_FALLBACK: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_paid: "Partially Paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

const INVOICE_ALLOWED_STATUS_TRANSITIONS_FALLBACK: Record<string, string[]> = {
  draft: ["sent", "void"],
  sent: ["draft", "partially_paid", "paid", "overdue", "void"],
  partially_paid: ["sent", "paid", "overdue", "void"],
  paid: ["void"],
  overdue: ["partially_paid", "paid", "void"],
  void: [],
};

const INVOICE_DEFAULT_STATUS_FILTERS_FALLBACK = ["draft", "sent", "partially_paid", "overdue"];
const INVOICE_TERMINAL_STATUSES_FALLBACK = ["paid", "void"];
const DEFAULT_PROJECT_STATUS_FILTERS: ProjectStatusValue[] = ["active", "prospect"];
const GENERIC_BUDGET_COST_CODES = new Set(["99-901", "99-902", "99-903"]);

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function dueDateIsoDate(daysFromNow = 30) {
  const current = new Date();
  current.setDate(current.getDate() + daysFromNow);
  return current.toISOString().slice(0, 10);
}

function dueDateFromIssueDate(issueDate: string, dueDays: number) {
  const base = issueDate ? new Date(`${issueDate}T00:00:00`) : new Date();
  const safeDueDays = Number.isFinite(dueDays) ? Math.max(1, Math.min(365, Math.round(dueDays))) : 30;
  base.setDate(base.getDate() + safeDueDays);
  return base.toISOString().slice(0, 10);
}

function parseAmount(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number): string {
  return value.toFixed(2);
}

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

function invoiceStatusLabel(status: string): string {
  return INVOICE_STATUS_LABELS_FALLBACK[status] ?? status;
}

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
  if (status === "overdue") {
    return "Next: follow up with customer and record payment once received.";
  }
  if (status === "paid") {
    return "Invoice is fully settled.";
  }
  if (status === "void") {
    return "Invoice is void and no longer billable.";
  }
  return "Select a status transition as needed.";
}

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
  if (status === "overdue") {
    return styles.statusOverdue;
  }
  if (status === "void") {
    return styles.statusVoid;
  }
  return "";
}

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
  if (status === "overdue") {
    return styles.statusToneOverdue;
  }
  if (status === "void") {
    return styles.statusToneVoid;
  }
  return "";
}

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
  if (event.from_status === event.to_status && (event.note || "").trim()) {
    return "Notated";
  }
  if (event.from_status === "sent" && event.to_status === "sent") {
    return "Re-sent";
  }
  if (!event.from_status) {
    return `Created as ${statusLabel(event.to_status)}`;
  }
  return `${statusLabel(event.from_status)} to ${statusLabel(event.to_status)}`;
}

function readApiError(payload: ApiResponse | undefined, fallback: string): string {
  const message = payload?.error?.message?.trim();
  return message || fallback;
}

function projectStatusClass(statusValue: string): string {
  const key = `projectStatus${statusValue
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}`;
  return styles[key] ?? "";
}

function projectStatusLabel(statusValue: string): string {
  return statusValue.replace("_", " ");
}

export function InvoicesConsole() {
  const { token, authMessage, role } = useSharedSessionAuth();
  const canMutateInvoices = hasAnyRole(role, ["owner", "pm", "bookkeeping"]);
  const canEditInvoiceWorkspace = canMutateInvoices;

  const searchParams = useSearchParams();
  const scopedProjectIdParam = searchParams.get("project");
  const scopedProjectId =
    scopedProjectIdParam && /^\d+$/.test(scopedProjectIdParam) ? Number(scopedProjectIdParam) : null;

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);

  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatusFilters, setProjectStatusFilters] = useState<ProjectStatusValue[]>(
    DEFAULT_PROJECT_STATUS_FILTERS,
  );
  const [currentProjectPage, setCurrentProjectPage] = useState(1);

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
  const [scopeOverride, setScopeOverride] = useState(false);
  const [scopeOverrideNote, setScopeOverrideNote] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [organizationInvoiceDefaults, setOrganizationInvoiceDefaults] = useState<OrganizationInvoiceDefaults | null>(null);

  const [issueDate, setIssueDate] = useState(todayIsoDate());
  const [dueDate, setDueDate] = useState(dueDateIsoDate());
  const [senderName, setSenderName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [senderAddress, setSenderAddress] = useState("");
  const [senderLogoUrl, setSenderLogoUrl] = useState("");
  const [termsText, setTermsText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [notesText, setNotesText] = useState("");
  const [taxPercent, setTaxPercent] = useState("0");
  const [lineItems, setLineItems] = useState<InvoiceLineInput[]>([emptyLine(1)]);
  const [nextLineId, setNextLineId] = useState(2);

  const selectedInvoice = useMemo(
    () => invoices.find((invoice) => String(invoice.id) === selectedInvoiceId) ?? null,
    [invoices, selectedInvoiceId],
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
  const projectPageSize = 5;
  const projectNeedle = projectSearch.trim().toLowerCase();
  const filteredProjects = !projectNeedle
    ? projects
    : projects.filter((project) => {
        const haystack = [String(project.id), project.name, project.customer_display_name, project.status]
          .join(" ")
          .toLowerCase();
        return haystack.includes(projectNeedle);
      });
  const statusFilteredProjects = filteredProjects.filter((project) =>
    projectStatusFilters.includes(project.status as ProjectStatusValue),
  );
  const totalProjectPages = Math.max(1, Math.ceil(statusFilteredProjects.length / projectPageSize));
  const currentProjectPageSafe = Math.min(currentProjectPage, totalProjectPages);
  const projectPageStart = (currentProjectPageSafe - 1) * projectPageSize;
  const pagedProjects = statusFilteredProjects.slice(projectPageStart, projectPageStart + projectPageSize);
  const filteredInvoices = useMemo(() => {
    if (!invoiceStatusFilters.length) {
      return [];
    }
    return invoices.filter((invoice) => invoiceStatusFilters.includes(invoice.status));
  }, [invoiceStatusFilters, invoices]);
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

  const invoiceCounts = useMemo(() => {
    const byStatus = new Map<string, number>();
    for (const row of invoices) {
      byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
    }
    return {
      total: invoices.length,
      draft: byStatus.get("draft") ?? 0,
      sent: byStatus.get("sent") ?? 0,
      overdue: byStatus.get("overdue") ?? 0,
      paid: byStatus.get("paid") ?? 0,
    };
  }, [invoices]);

  const balanceSummary = useMemo(() => {
    return invoices.reduce(
      (acc, row) => {
        acc.total += parseAmount(row.total);
        acc.balanceDue += parseAmount(row.balance_due);
        return acc;
      },
      { total: 0, balanceDue: 0 },
    );
  }, [invoices]);

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

  const setNeutralStatus = useCallback((message: string) => {
    setStatusTone("neutral");
    setStatusMessage(message);
  }, []);

  const setSuccessStatus = useCallback((message: string) => {
    setStatusTone("success");
    setStatusMessage(message);
  }, []);

  const setErrorStatus = useCallback((message: string) => {
    setStatusTone("error");
    setStatusMessage(message);
  }, []);

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
        if (orgRes.ok && organizationData) {
          const organizationBranding = resolveOrganizationBranding(organizationData);
          setOrganizationInvoiceDefaults(organizationData);
          setSenderName(organizationBranding.senderName);
          setSenderEmail(organizationBranding.senderEmail);
          setSenderAddress(organizationBranding.senderAddress);
          setSenderLogoUrl(organizationBranding.logoUrl);
          setTermsText(organizationData.invoice_default_terms || "");
          setFooterText(organizationData.invoice_default_footer || "");
          setNotesText(organizationData.invoice_default_notes || "");
          setDueDate(dueDateFromIssueDate(issueDate, organizationData.invoice_default_due_days || 30));
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
    [issueDate, normalizedBaseUrl, scopedProjectId, setErrorStatus, setNeutralStatus, token],
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

      setNeutralStatus("Loading invoices...");
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
    [normalizedBaseUrl, selectedProjectId, setErrorStatus, setNeutralStatus, token],
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
        const options =
          activeBudget?.line_items?.map((line) => ({
            id: line.id,
            scopeItemId: line.scope_item,
            costCodeCode: line.cost_code_code,
            description: line.description,
            label: `${line.cost_code_code || "CC"} - ${line.description}`,
            groupLabel,
          }))
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

  useEffect(() => {
    if (!token) {
      return;
    }
    void loadInvoicePolicy();
  }, [loadInvoicePolicy, token]);

  useEffect(() => {
    if (!token) {
      return;
    }
    void loadDependencies();
  }, [loadDependencies, token]);

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

  useEffect(() => {
    setCurrentProjectPage(1);
  }, [projectSearch, projectStatusFilters]);

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

  useEffect(() => {
    if (!selectedProjectId || statusFilteredProjects.length === 0) {
      return;
    }
    const selectedIndex = statusFilteredProjects.findIndex(
      (project) => String(project.id) === selectedProjectId,
    );
    if (selectedIndex < 0) {
      return;
    }
    const targetPage = Math.floor(selectedIndex / projectPageSize) + 1;
    if (targetPage !== currentProjectPageSafe) {
      setCurrentProjectPage(targetPage);
    }
  }, [currentProjectPageSafe, selectedProjectId, statusFilteredProjects]);

  useEffect(() => {
    if (!selectedInvoice) {
      setSelectedStatus("draft");
      setStatusNote("");
      return;
    }
    const preferredStatus = nextStatusOptions[0] ?? selectedInvoice.status;
    setSelectedStatus((current) =>
      nextStatusOptions.includes(current) ? current : preferredStatus,
    );
    setStatusNote("");
  }, [nextStatusOptions, selectedInvoice]);

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
    setSelectedStatus(fallbackInvoice.status);
  }, [filteredInvoices, selectedInvoiceId]);

  useEffect(() => {
    const invoiceId = Number(selectedInvoiceId);
    if (!invoiceId) {
      setSelectedInvoiceStatusEvents([]);
      setStatusEventsLoading(false);
      return;
    }
    void loadInvoiceStatusEvents(invoiceId);
  }, [loadInvoiceStatusEvents, selectedInvoiceId]);

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

  function addLineItem() {
    const defaultBudgetLineId = budgetLineOptions[0] ? String(budgetLineOptions[0].id) : "";
    setLineItems((current) => [...current, emptyLine(nextLineId, defaultBudgetLineId)]);
    setNextLineId((value) => value + 1);
  }

  function removeLineItem(localId: number) {
    setLineItems((current) => {
      if (current.length <= 1) {
        return current;
      }
      return current.filter((line) => line.localId !== localId);
    });
  }

  function updateLineItem(localId: number, key: keyof Omit<InvoiceLineInput, "localId">, value: string) {
    setLineItems((current) =>
      current.map((line) => (line.localId === localId ? { ...line, [key]: value } : line)),
    );
  }

  function toggleInvoiceStatusFilter(statusValue: string) {
    setInvoiceStatusFilters((current) =>
      current.includes(statusValue)
        ? current.filter((status) => status !== statusValue)
        : [...current, statusValue],
    );
  }

  function toggleProjectStatusFilter(statusValue: ProjectStatusValue) {
    setProjectStatusFilters((current) =>
      current.includes(statusValue)
        ? current.filter((status) => status !== statusValue)
        : [...current, statusValue],
    );
  }

  function handleSelectProject(project: ProjectRecord) {
    if (String(project.id) === selectedProjectId) {
      return;
    }
    setSelectedProjectId(String(project.id));
  }

  function resetCreateDraft() {
    const defaultBudgetLineId = budgetLineOptions[0] ? String(budgetLineOptions[0].id) : "";
    const nextIssueDate = todayIsoDate();
    const dueDays = organizationInvoiceDefaults?.invoice_default_due_days ?? 30;
    const organizationBranding = resolveOrganizationBranding(organizationInvoiceDefaults);
    setIssueDate(nextIssueDate);
    setDueDate(dueDateFromIssueDate(nextIssueDate, dueDays));
    setSenderName(organizationBranding.senderName);
    setSenderEmail(organizationBranding.senderEmail);
    setSenderAddress(organizationBranding.senderAddress);
    setSenderLogoUrl(organizationBranding.logoUrl);
    setTermsText(organizationInvoiceDefaults?.invoice_default_terms || "");
    setFooterText(organizationInvoiceDefaults?.invoice_default_footer || "");
    setNotesText(organizationInvoiceDefaults?.invoice_default_notes || "");
    setTaxPercent("0");
    setLineItems([emptyLine(1, defaultBudgetLineId)]);
    setNextLineId(2);
  }

  async function handleCreateInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutateInvoices) {
      setErrorStatus(`Role ${role} is read-only for invoice mutations.`);
      return;
    }

    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setErrorStatus("Select a project first.");
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

    setNeutralStatus("Creating invoice...");
    try {
      const createPayload = invoiceComposerAdapter.toCreatePayload(invoiceDraftFormState);
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
      resetCreateDraft();
      setSuccessStatus(`Created ${created.invoice_number} (${statusLabel(created.status)}).`);
    } catch {
      setErrorStatus("Could not reach invoice create endpoint.");
    }
  }

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
      const response = await fetch(`${normalizedBaseUrl}/invoices/${invoiceId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          status: selectedStatus,
          status_note: statusNote,
          scope_override: scopeOverride,
          scope_override_note: scopeOverrideNote,
        }),
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
      setSuccessStatus(`Updated ${updated.invoice_number} to ${statusLabel(updated.status)}.`);
    } catch {
      setErrorStatus("Could not reach invoice status endpoint.");
    }
  }

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
      setSuccessStatus(`Added status note on ${updated.invoice_number}.`);
    } catch {
      setErrorStatus("Could not reach invoice status note endpoint.");
    }
  }

  async function handleSendInvoice() {
    if (!canMutateInvoices) {
      setErrorStatus(`Role ${role} is read-only for invoice mutations.`);
      return;
    }

    const invoiceId = Number(selectedInvoiceId);
    if (!invoiceId) {
      setErrorStatus("Select an invoice first.");
      return;
    }

    setNeutralStatus("Sending invoice...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/invoices/${invoiceId}/send/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          scope_override: scopeOverride,
          scope_override_note: scopeOverrideNote,
        }),
      });
      const payload: ApiResponse = await response.json();

      if (!response.ok) {
        setErrorStatus(readApiError(payload, "Send invoice failed."));
        return;
      }

      const updated = payload.data as InvoiceRecord;
      setInvoices((current) =>
        current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
      );
      setSelectedStatus(updated.status);
      await loadInvoiceStatusEvents(updated.id);
      setSuccessStatus(`Sent ${updated.invoice_number}.`);
    } catch {
      setErrorStatus("Could not reach invoice send endpoint.");
    }
  }

  function handleDuplicateInvoiceIntoDraft() {
    if (!selectedInvoice) {
      setErrorStatus("Select an invoice first.");
      return;
    }

    const duplicateSourceLines = selectedInvoice.line_items ?? [];
    const fallbackBudgetLineId = budgetLineOptions[0] ? String(budgetLineOptions[0].id) : "";
    const nextDraftLines: InvoiceLineInput[] = duplicateSourceLines.length
      ? duplicateSourceLines.map((line, index) => {
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
        })
      : [emptyLine(1, fallbackBudgetLineId)];

    const nextIssueDate = todayIsoDate();
    const organizationBranding = resolveOrganizationBranding(organizationInvoiceDefaults);
    setIssueDate(nextIssueDate);
    setDueDate(
      selectedInvoice.due_date ||
        dueDateFromIssueDate(
          nextIssueDate,
          organizationInvoiceDefaults?.invoice_default_due_days ?? 30,
        ),
    );
    setSenderName(
      selectedInvoice.sender_name ||
        organizationBranding.senderName ||
        "",
    );
    setSenderEmail(
      selectedInvoice.sender_email || organizationBranding.senderEmail || "",
    );
    setSenderAddress(
      selectedInvoice.sender_address || organizationBranding.senderAddress || "",
    );
    setSenderLogoUrl(selectedInvoice.sender_logo_url || organizationBranding.logoUrl || "");
    setTermsText(selectedInvoice.terms_text || organizationInvoiceDefaults?.invoice_default_terms || "");
    setFooterText(
      selectedInvoice.footer_text || organizationInvoiceDefaults?.invoice_default_footer || "",
    );
    setNotesText(selectedInvoice.notes_text || organizationInvoiceDefaults?.invoice_default_notes || "");
    setTaxPercent(selectedInvoice.tax_percent || "0");
    setLineItems(nextDraftLines);
    setNextLineId(nextDraftLines.length + 1);
    setSuccessStatus(`Loaded ${selectedInvoice.invoice_number} into a new draft. A new invoice # is assigned on create.`);
  }

  const selectedProject = projects.find((project) => String(project.id) === selectedProjectId) ?? null;
  const senderDisplayName = (
    senderName ||
    organizationInvoiceDefaults?.display_name ||
    "Your Company"
  ).trim();
  const senderAddressLines = useMemo(() => toAddressLines(senderAddress), [senderAddress]);
  const invoiceComposerStatusPolicy = useMemo(
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
      senderName,
      senderEmail,
      senderAddress,
      senderLogoUrl,
      termsText,
      footerText,
      notesText,
      taxPercent,
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
      footerText,
      issueDate,
      lineItems,
      notesText,
      senderAddress,
      senderEmail,
      senderLogoUrl,
      senderName,
      taxPercent,
      termsText,
    ],
  );
  const invoiceComposerAdapter = useMemo(
    () => createInvoiceDocumentAdapter(invoiceComposerStatusPolicy, []),
    [invoiceComposerStatusPolicy],
  );

  return (
    <section className={styles.console}>
      <section className={styles.quickView} aria-label="Billing quick view">
        <h2 className={styles.quickViewTitle}>Billing Quick View</h2>
        <div className={styles.statsGrid}>
          <article className={styles.statCard}>
            <span>Total invoices</span>
            <strong>{invoiceCounts.total}</strong>
          </article>
          <article className={styles.statCard}>
            <span>Awaiting action</span>
            <strong>{invoiceCounts.draft + invoiceCounts.sent + invoiceCounts.overdue}</strong>
          </article>
          <article className={styles.statCard}>
            <span>Total invoiced</span>
            <strong>${formatMoney(balanceSummary.total)}</strong>
          </article>
          <article className={styles.statCard}>
            <span>Balance due</span>
            <strong>${formatMoney(balanceSummary.balanceDue)}</strong>
          </article>
        </div>
      </section>

      {!token ? <p className={styles.authNotice}>{authMessage}</p> : null}

      {statusMessage ? (
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

          <section className={styles.controlBar}>
            <div className={styles.projectSelector}>
              <div className={styles.panelHeader}>
                <h3>Project List</h3>
                <span className={styles.countBadge}>
                  {statusFilteredProjects.length}/{projects.length}
                </span>
              </div>
              <label className={styles.searchField}>
                <span>Search projects</span>
                <input
                  value={projectSearch}
                  onChange={(event) => setProjectSearch(event.target.value)}
                  placeholder="Search by id, name, customer, or status"
                />
              </label>
              <div className={styles.projectFilters}>
                <span className={styles.projectFiltersLabel}>Project status filter</span>
                <div className={styles.projectFilterButtons}>
                  {(["prospect", "active", "on_hold", "completed", "cancelled"] as ProjectStatusValue[]).map(
                    (statusValue) => {
                      const active = projectStatusFilters.includes(statusValue);
                      return (
                        <button
                          key={statusValue}
                          type="button"
                          className={`${styles.projectFilterButton} ${
                            active
                              ? `${styles.projectFilterButtonActive} ${projectStatusClass(statusValue)}`
                              : styles.projectFilterButtonInactive
                          }`}
                          onClick={() => toggleProjectStatusFilter(statusValue)}
                        >
                          {projectStatusLabel(statusValue)}
                        </button>
                      );
                    },
                  )}
                </div>
                <div className={styles.projectFilterActions}>
                  <button
                    type="button"
                    className={styles.projectFilterActionButton}
                    onClick={() =>
                      setProjectStatusFilters(["active", "on_hold", "prospect", "completed", "cancelled"])
                    }
                  >
                    Show all projects
                  </button>
                  <button
                    type="button"
                    className={styles.projectFilterActionButton}
                    onClick={() => setProjectStatusFilters(DEFAULT_PROJECT_STATUS_FILTERS)}
                  >
                    Reset default
                  </button>
                </div>
              </div>
              <div className={styles.projectTableWrap}>
                <table className={styles.projectTable}>
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Customer</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedProjects.length ? (
                      pagedProjects.map((project) => {
                        const isActive = String(project.id) === selectedProjectId;
                        return (
                          <tr
                            key={project.id}
                            className={`${styles.projectRow} ${isActive ? styles.projectRowActive : ""}`}
                            onClick={() => handleSelectProject(project)}
                          >
                            <td className={styles.projectCellTitle}>
                              <strong>#{project.id}</strong> {project.name}
                            </td>
                            <td>{project.customer_display_name}</td>
                            <td>
                              <span className={`${styles.projectStatus} ${projectStatusClass(project.status)}`}>
                                {projectStatusLabel(project.status)}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={3} className={styles.projectEmptyCell}>
                          No projects match your filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <div className={styles.projectPagination}>
                  <button
                    type="button"
                    className={styles.projectFilterActionButton}
                    onClick={() => setCurrentProjectPage((page) => Math.max(1, page - 1))}
                    disabled={currentProjectPageSafe <= 1}
                  >
                    Prev
                  </button>
                  <span>
                    Page {currentProjectPageSafe} of {totalProjectPages}
                  </span>
                  <button
                    type="button"
                    className={styles.projectFilterActionButton}
                    onClick={() => setCurrentProjectPage((page) => Math.min(totalProjectPages, page + 1))}
                    disabled={currentProjectPageSafe >= totalProjectPages}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>

          </section>

          <section className={`${styles.panel} ${styles.viewerPanel}`}>
              <div className={styles.panelHeader}>
                <h3>Project Invoices</h3>
                <span className={styles.countBadge}>
                  {filteredInvoices.length}/{invoices.length}
                </span>
              </div>

              {selectedProject ? (
                <p className={styles.inlineHint}>
                  {selectedProject.name} · {selectedProject.customer_display_name}
                </p>
              ) : null}

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
                      {statusLabel(status)}
                    </button>
                  );
                })}
              </div>

              <div className={styles.invoiceRail}>
                {filteredInvoices.length ? (
                  filteredInvoices.map((invoice) => {
                    const isSelected = String(invoice.id) === selectedInvoiceId;
                    return (
                      <button
                        key={invoice.id}
                        type="button"
                        className={`${styles.invoiceCard} ${isSelected ? styles.invoiceCardSelected : ""}`}
                        onClick={() => {
                          setSelectedInvoiceId(String(invoice.id));
                          setSelectedStatus(invoice.status);
                        }}
                      >
                        <div className={styles.invoiceCardRow}>
                          <strong>{invoice.invoice_number}</strong>
                          <span className={`${styles.statusBadge} ${invoiceStatusClass(invoice.status)}`}>
                            {statusLabel(invoice.status)}
                          </span>
                        </div>
                        <div className={styles.invoiceMetaGrid}>
                          <span>Total ${invoice.total}</span>
                          <span>Due ${invoice.balance_due}</span>
                          <span>Issue {formatDateDisplay(invoice.issue_date)}</span>
                          <span>Due {formatDateDisplay(invoice.due_date)}</span>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <p className={styles.emptyState}>
                    {invoices.length
                      ? "No invoices match the selected status filters."
                      : "No invoices yet for this project."}
                  </p>
                )}
              </div>

              <div className={styles.viewerStatusPanel}>
                <div className={styles.panelHeader}>
                  <h3>Invoice Status & Send</h3>
                  <span className={styles.countBadge}>
                    {selectedInvoice ? selectedInvoice.invoice_number : "No selection"}
                  </span>
                </div>

                {selectedInvoice ? (
                  <>
                    {canMutateInvoices ? (
                      <div className={styles.viewerStatusActions}>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={handleDuplicateInvoiceIntoDraft}
                        >
                          Duplicate as New Invoice
                        </button>
                        <p className={styles.inlineHint}>
                          Invoices do not use revision families. Duplicate always creates a new invoice #.
                        </p>
                      </div>
                    ) : (
                      <p className={styles.inlineHint}>
                        Status and duplication actions are read-only for your role.
                      </p>
                    )}

                    <div className={styles.selectedInvoiceSummary}>
                      <span className={`${styles.statusBadge} ${invoiceStatusClass(selectedInvoice.status)}`}>
                        {statusLabel(selectedInvoice.status)}
                      </span>
                      <p>{invoiceNextActionHint(selectedInvoice.status)}</p>
                    </div>

                    <section className={styles.statusHistoryBlock}>
                      <div className={styles.statusHistoryHeader}>
                        <h4>Status History</h4>
                        <span>
                          {statusEventsLoading
                            ? "Loading..."
                            : `${selectedInvoiceStatusEvents.length} event${
                                selectedInvoiceStatusEvents.length === 1 ? "" : "s"
                              }`}
                        </span>
                      </div>
                      {selectedInvoiceStatusEvents.length ? (
                        <div className={styles.statusHistoryTableWrap}>
                          <table className={styles.statusHistoryTable}>
                            <thead>
                              <tr>
                                <th>When</th>
                                <th>Action</th>
                                <th>By</th>
                                <th>Note</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedInvoiceStatusEvents.map((event) => (
                                <tr key={event.id}>
                                  <td>{formatDateTimeDisplay(event.changed_at, "--")}</td>
                                  <td>{invoiceStatusEventActionLabel(event, statusLabel)}</td>
                                  <td>{event.changed_by_email || `User #${event.changed_by}`}</td>
                                  <td>{event.note || "--"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className={styles.inlineHint}>
                          {statusEventsLoading ? "Loading status history..." : "No status history yet."}
                        </p>
                      )}
                    </section>

                    {canMutateInvoices ? (
                      <>
                        <div className={styles.statusPicker}>
                          <span className={styles.lifecycleFieldLabel}>Next status</span>
                          <div className={styles.statusPills}>
                            {nextStatusOptions.map((status) => {
                              const isSelected = selectedStatus === status;
                              return (
                                <button
                                  key={status}
                                  type="button"
                                  className={`${styles.statusPill} ${
                                    isSelected
                                      ? `${styles.statusPillActive} ${invoiceStatusToneClass(status)}`
                                      : styles.statusPillInactive
                                  }`}
                                  onClick={() => setSelectedStatus(status)}
                                  aria-pressed={isSelected}
                                >
                                  {selectedInvoice.status === "sent" && status === "sent"
                                    ? "Re-send"
                                    : statusLabel(status)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        {!nextStatusOptions.length ? (
                          <p className={styles.inlineHint}>No next statuses available for this invoice.</p>
                        ) : null}
                        <label className={styles.field}>
                          <span>Status note</span>
                          <textarea
                            value={statusNote}
                            onChange={(event) => setStatusNote(event.target.value)}
                            placeholder="Optional note for this status action or history-only note."
                            className={styles.invoiceLockableControl}
                          />
                        </label>

                        <label className={styles.toggleRow}>
                          <input
                            type="checkbox"
                            checked={scopeOverride}
                            onChange={(event) => setScopeOverride(event.target.checked)}
                            className={styles.invoiceLockableControl}
                          />
                          <span>Allow unapproved scope billing</span>
                        </label>

                        {scopeOverride ? (
                          <label className={styles.field}>
                            <span>Override audit note</span>
                            <textarea
                              value={scopeOverrideNote}
                              onChange={(event) => setScopeOverrideNote(event.target.value)}
                              placeholder="Required when override is enabled and invoice exceeds approved scope."
                              className={styles.invoiceLockableControl}
                            />
                          </label>
                        ) : null}

                        <div className={styles.buttonRow}>
                          {nextStatusOptions.length ? (
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              onClick={handleUpdateInvoiceStatus}
                            >
                              Save Status
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={handleAddInvoiceStatusNote}
                            disabled={!statusNote.trim()}
                          >
                            Add Status Note
                          </button>
                          <button
                            type="button"
                            className={styles.primaryButton}
                            onClick={handleSendInvoice}
                          >
                            Send Invoice
                          </button>
                        </div>
                      </>
                    ) : null}
                  </>
                ) : (
                  <p className={styles.emptyState}>Select an invoice from the project rail to manage status and send operations.</p>
                )}
              </div>
            </section>

          <div className={styles.workspace}>
              <DocumentComposer
                adapter={invoiceComposerAdapter}
                document={null}
                formState={invoiceDraftFormState}
                className={`${estimateStyles.sheet} ${styles.invoiceComposerSheet} ${!canEditInvoiceWorkspace ? styles.invoiceComposerSheetLocked : ""}`}
                sectionClassName={styles.invoiceComposerSection}
                onSubmit={handleCreateInvoice}
                sections={[{ slot: "context" }]}
                renderers={{
                  context: () => (
                    <>
                      <div className={estimateStyles.sheetHeader}>
                        <div className={styles.invoicePartyStack}>
                          <div className={estimateStyles.fromBlock}>
                            <span className={estimateStyles.blockLabel}>From</span>
                            <p className={estimateStyles.blockText}>
                              {senderDisplayName}
                            </p>
                            {senderEmail ? (
                              <p className={estimateStyles.blockMuted}>{senderEmail}</p>
                            ) : null}
                            {senderAddressLines.length
                              ? senderAddressLines.map((line, index) => (
                                  <p key={`${line}-${index}`} className={estimateStyles.blockMuted}>
                                    {line}
                                  </p>
                                ))
                              : (
                                <p className={estimateStyles.blockMuted}>
                                  Set sender address in Organization settings.
                                </p>
                              )}
                          </div>
                          <div className={estimateStyles.toBlock}>
                            <span className={estimateStyles.blockLabel}>To</span>
                            <p className={estimateStyles.blockText}>
                              {selectedProject?.customer_display_name || "Select project"}
                            </p>
                            <p className={estimateStyles.blockMuted}>
                              {selectedProject
                                ? `#${selectedProject.id} ${selectedProject.name}`
                                : "Choose a project from the project list"}
                            </p>
                          </div>
                        </div>
                        <div className={estimateStyles.headerRight}>
                          <div className={estimateStyles.logoBox}>
                            {senderLogoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={senderLogoUrl} alt="Organization logo" className={styles.invoiceLogoImage} />
                            ) : (
                              "Logo"
                            )}
                          </div>
                          <div className={estimateStyles.sheetTitle}>Invoice</div>
                        </div>
                      </div>

                      <div className={styles.invoiceMetaLayout}>
                        <div className={styles.invoiceMetaSpacer} />
                        <div className={estimateStyles.metaBlock}>
                          <span className={estimateStyles.metaTitle}>Invoice details</span>
                          <div className={estimateStyles.metaLine}>
                            <span>Invoice #</span>
                            <strong className={styles.invoiceMetaStrong}>Auto on create</strong>
                          </div>
                          <label className={estimateStyles.inlineField}>
                            Issue date
                            <input
                              className={`${estimateStyles.fieldInput} ${styles.invoiceLockableControl}`}
                              type="date"
                              value={issueDate}
                              onChange={(event) => setIssueDate(event.target.value)}
                              required
                              disabled={!canEditInvoiceWorkspace}
                            />
                          </label>
                          <label className={estimateStyles.inlineField}>
                            Due date
                            <input
                              className={`${estimateStyles.fieldInput} ${styles.invoiceLockableControl}`}
                              type="date"
                              value={dueDate}
                              onChange={(event) => setDueDate(event.target.value)}
                              required
                              disabled={!canEditInvoiceWorkspace}
                            />
                          </label>
                          <label className={estimateStyles.inlineField}>
                            Organization sender name
                            <input
                              className={`${estimateStyles.fieldInput} ${styles.invoiceLockableControl}`}
                              value={senderName}
                              onChange={(event) => setSenderName(event.target.value)}
                              placeholder="Your company name"
                              disabled={!canEditInvoiceWorkspace}
                            />
                          </label>
                          <label className={estimateStyles.inlineField}>
                            Organization sender email
                            <input
                              className={`${estimateStyles.fieldInput} ${styles.invoiceLockableControl}`}
                              type="email"
                              value={senderEmail}
                              onChange={(event) => setSenderEmail(event.target.value)}
                              placeholder="billing@example.com"
                              disabled={!canEditInvoiceWorkspace}
                            />
                          </label>
                        </div>
                      </div>

                      <div className={styles.invoiceTemplateGrid}>
                        <label className={styles.invoiceTemplateField}>
                          <span>Organization sender address</span>
                          <textarea
                            className={styles.invoiceLockableControl}
                            value={senderAddress}
                            onChange={(event) => setSenderAddress(event.target.value)}
                            rows={3}
                            placeholder="Street, city, state, ZIP"
                            disabled={!canEditInvoiceWorkspace}
                          />
                        </label>
                        <label className={styles.invoiceTemplateField}>
                          <span>Organization logo URL</span>
                          <input
                            className={styles.invoiceLockableControl}
                            value={senderLogoUrl}
                            onChange={(event) => setSenderLogoUrl(event.target.value)}
                            placeholder="https://example.com/logo.png"
                            disabled={!canEditInvoiceWorkspace}
                          />
                        </label>
                        <label className={styles.invoiceTemplateField}>
                          <span>Default notes</span>
                          <textarea
                            className={styles.invoiceLockableControl}
                            value={notesText}
                            onChange={(event) => setNotesText(event.target.value)}
                            rows={3}
                            placeholder="Optional billing notes shown on invoice"
                            disabled={!canEditInvoiceWorkspace}
                          />
                        </label>
                        <label className={styles.invoiceTemplateField}>
                          <span>Terms</span>
                          <textarea
                            className={styles.invoiceLockableControl}
                            value={termsText}
                            onChange={(event) => setTermsText(event.target.value)}
                            rows={3}
                            placeholder="Payment terms"
                            disabled={!canEditInvoiceWorkspace}
                          />
                        </label>
                        <label className={styles.invoiceTemplateField}>
                          <span>Footer</span>
                          <textarea
                            className={styles.invoiceLockableControl}
                            value={footerText}
                            onChange={(event) => setFooterText(event.target.value)}
                            rows={3}
                            placeholder="Footer message"
                            disabled={!canEditInvoiceWorkspace}
                          />
                        </label>
                      </div>
                      <p className={estimateStyles.inlineHint}>
                        Sender fields are prefilled from Organization settings and can be overridden per invoice.
                      </p>

                      <div className={styles.invoiceLineSectionIntro}>
                        <h3>Line Items</h3>
                      </div>
                      {budgetLineOptions.length === 0 ? (
                        <p className={estimateStyles.inlineHint}>
                          Scope lines require an active project budget line. Convert an approved estimate to budget or
                          use adjustment lines with a reason. Internal generic lines are not billable here.
                        </p>
                      ) : null}

                      <div className={estimateStyles.lineTable}>
                        <div className={styles.invoiceLineHeader}>
                          <span>Type</span>
                          <span>Scope source / Reason</span>
                          <span>Qty</span>
                          <span>Description</span>
                          <span>Unit</span>
                          <span>Unit price</span>
                          <span>Amount</span>
                          <span>{canEditInvoiceWorkspace ? "Actions" : ""}</span>
                        </div>
                        {lineItems.map((line, index) => {
                          const lineAmount = parseAmount(line.quantity) * parseAmount(line.unitPrice);
                          return (
                            <div
                              key={line.localId}
                              className={`${styles.invoiceLineRow} ${index % 2 === 1 ? styles.invoiceLineRowAlt : ""}`}
                            >
                              <select
                                className={`${estimateStyles.lineInput} ${styles.invoiceLockableControl}`}
                                value={line.lineType}
                                onChange={(event) =>
                                  updateLineItem(
                                    line.localId,
                                    "lineType",
                                    event.target.value as InvoiceLineInput["lineType"],
                                  )
                                }
                                disabled={!canEditInvoiceWorkspace}
                              >
                                <option value="scope">Scope</option>
                                <option value="adjustment">Adjustment</option>
                              </select>
                              {line.lineType === "scope" ? (
                                <select
                                  className={`${estimateStyles.lineInput} ${styles.invoiceLockableControl}`}
                                  value={line.budgetLineId}
                                  onChange={(event) =>
                                    updateLineItem(line.localId, "budgetLineId", event.target.value)
                                  }
                                  required
                                  disabled={!canEditInvoiceWorkspace}
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
                                  className={`${estimateStyles.lineInput} ${styles.invoiceLockableControl}`}
                                  value={line.adjustmentReason}
                                  onChange={(event) =>
                                    updateLineItem(line.localId, "adjustmentReason", event.target.value)
                                  }
                                  placeholder="Adjustment reason"
                                  required
                                  disabled={!canEditInvoiceWorkspace}
                                />
                              )}
                              <input
                                className={`${estimateStyles.lineInput} ${styles.invoiceLockableControl}`}
                                value={line.quantity}
                                onChange={(event) =>
                                  updateLineItem(line.localId, "quantity", event.target.value)
                                }
                                inputMode="decimal"
                                required
                                disabled={!canEditInvoiceWorkspace}
                              />
                              <input
                                className={`${estimateStyles.lineInput} ${styles.invoiceLockableControl}`}
                                value={line.description}
                                onChange={(event) =>
                                  updateLineItem(line.localId, "description", event.target.value)
                                }
                                required
                                disabled={!canEditInvoiceWorkspace}
                              />
                              <input
                                className={`${estimateStyles.lineInput} ${styles.invoiceLockableControl}`}
                                value={line.unit}
                                onChange={(event) => updateLineItem(line.localId, "unit", event.target.value)}
                                required
                                disabled={!canEditInvoiceWorkspace}
                              />
                              <input
                                className={`${estimateStyles.lineInput} ${styles.invoiceLockableControl}`}
                                value={line.unitPrice}
                                onChange={(event) =>
                                  updateLineItem(line.localId, "unitPrice", event.target.value)
                                }
                                inputMode="decimal"
                                required
                                disabled={!canEditInvoiceWorkspace}
                              />
                              <span className={`${estimateStyles.amountCell} ${styles.invoiceReadAmount}`}>
                                ${formatMoney(lineAmount)}
                              </span>
                              <div className={styles.invoiceLineActionsCell}>
                                {canEditInvoiceWorkspace ? (
                                  <button
                                    type="button"
                                    className={estimateStyles.smallButton}
                                    onClick={() => removeLineItem(line.localId)}
                                    disabled={lineItems.length <= 1}
                                  >
                                    Remove
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {canEditInvoiceWorkspace ? (
                        <div className={styles.invoiceLineActions}>
                          <button
                            type="button"
                            className={estimateStyles.secondaryButton}
                            onClick={addLineItem}
                          >
                            Add Line Item
                          </button>
                        </div>
                      ) : null}

                      {!selectedProjectId ? (
                        <p className={estimateStyles.inlineHint}>Select a project before creating an invoice.</p>
                      ) : null}

                      <div className={styles.invoiceSheetFooter}>
                        <div className={estimateStyles.summary}>
                          <div className={estimateStyles.summaryRow}>
                            <span>Subtotal</span>
                            <strong>${formatMoney(draftLineSubtotal)}</strong>
                          </div>
                          <div className={estimateStyles.summaryRow}>
                            <span>Sales Tax</span>
                            <span className={estimateStyles.summaryTaxLine}>
                              <label className={estimateStyles.summaryTaxRate}>
                                <input
                                  className={`${estimateStyles.summaryTaxInput} ${styles.invoiceLockableControl}`}
                                  value={taxPercent}
                                  onChange={(event) => setTaxPercent(event.target.value)}
                                  inputMode="decimal"
                                  disabled={!canEditInvoiceWorkspace}
                                />
                                <span className={estimateStyles.summaryTaxSuffix}>%</span>
                              </label>
                              <span className={estimateStyles.summaryTaxAmount}>
                                ${formatMoney(draftTaxTotal)}
                              </span>
                            </span>
                          </div>
                          <div className={`${estimateStyles.summaryRow} ${estimateStyles.summaryTotal}`}>
                            <span>Total</span>
                            <strong>${formatMoney(draftTotal)}</strong>
                          </div>
                        </div>
                        {canEditInvoiceWorkspace ? (
                          <div className={styles.invoiceCreateActions}>
                            <button
                              type="submit"
                              className={estimateStyles.primaryButton}
                              disabled={!selectedProjectId}
                            >
                              Create Invoice
                            </button>
                          </div>
                        ) : null}
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
        </>
      ) : null}
    </section>
  );
}
