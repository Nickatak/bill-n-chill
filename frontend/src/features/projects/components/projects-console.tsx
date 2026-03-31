"use client";

/**
 * Primary project hub — browse, select, and manage projects.
 *
 * Three-panel layout: filterable project list (left), financial snapshot
 * with scope control and billing tree (center), and inline project
 * profile editor (right). All state is local — no extracted hooks yet.
 *
 * Parent: app/projects/page.tsx
 *
 * ## Page layout
 *
 * ┌──────────────┬──────────────────────────────────┐
 * │ Project list │ Financial snapshot                │
 * │   ├── Search │   ├── Contract / AR / AP metrics  │
 * │   ├── Status │   ├── Workflow pipeline progress   │
 * │   │   pills  │   ├── Quick-entry tabs             │
 * │   └── Cards  │   └── Billing tree (scoped links)  │
 * │              ├──────────────────────────────────┤
 * │              │ Profile editor (collapsible)      │
 * │              │   ├── Project name                │
 * │              │   ├── Status selector             │
 * │              │   └── Save                        │
 * └──────────────┴──────────────────────────────────┘
 *
 * ## State (useState) — 14 calls
 *
 * Data: projects, summary, quote/CO/bill/invoice progress,
 *       acceptedQuoteTotal, invoiceAllocationTargets
 * Selection: selectedProjectId, isProjectEditOpen
 * Filters: projectSearch, projectStatusFilters
 * Form: projectName, projectStatus
 *
 * ## Functions
 *
 * - loadProjects() — fetches all projects, auto-selects based on URL scope
 * - loadFinancialSummary() — fetches /projects/:id/financial-summary/
 * - loadQuoteProgress / loadCoProgress / loadBillProgress / loadInvoiceProgress — fetches workflow progress
 * - hydrateForm(project) — populates name + status fields
 * - handleProjectSave(event) — PATCHes project profile
 * - toggleProjectStatusFilter(status) — toggles a status pill in/out
 *
 * ## Effects (5)
 *
 * 1. Fetch projects on mount (deps: [token])
 * 2. Fetch financial summary when selection changes (deps: [selectedProjectId, token])
 * 3. Fetch workflow progress when selection changes (deps: [selectedProjectId, token])
 * 4. Fetch allocation targets when selection changes (deps: [selectedProjectId, token])
 * 5. Auto-select scoped project from URL params (deps: [projects, scopedProjectId])
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { readApiErrorMessage } from "@/shared/api/error";
import { formatCurrency } from "@/shared/money-format";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { useStatusMessage } from "@/shared/hooks/use-status-message";
import styles from "./projects-console.module.css";
import { PaymentRecorder, type AllocationTarget } from "@/features/payments";
import { ProjectListViewer } from "@/shared/project-list-viewer";
import { ApiResponse, ApprovedQuote, ProjectFinancialSummary, ProjectRecord } from "../types";
import {
  PROJECT_STATUS_VALUES,
  DEFAULT_PROJECT_STATUS_FILTERS,
  parseMoneyValue,
  formatCustomerName,
  projectStatusLabel,
  allowedProfileStatuses,
} from "../utils/project-helpers";
import type { ProjectStatusValue } from "../utils/project-helpers";

/** Renders the main project dashboard with list, financial map, and profile editor. */
export function ProjectsConsole() {
  const searchParams = useSearchParams();
  const { token: authToken, authMessage } = useSharedSessionAuth();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const {
    message: statusMessage,
    tone: statusMessageTone,
    setSuccess: setSuccessStatusMessage,
    setError: setErrorStatusMessage,
  } = useStatusMessage();
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatusFilters, setProjectStatusFilters] = useState<ProjectStatusValue[]>(
    DEFAULT_PROJECT_STATUS_FILTERS,
  );
  const [summary, setSummary] = useState<ProjectFinancialSummary | null>(null);
  const [quoteProgress, setQuoteProgress] = useState<{ total: number } | null>(null);
  const [coProgress, setCoProgress] = useState<{ done: number; total: number } | null>(null);
  const [billProgress, setBillProgress] = useState<{ done: number; total: number } | null>(null);
  const [invoiceProgress, setInvoiceProgress] = useState<{ done: number; total: number } | null>(null);
  const [acceptedQuoteTotal, setAcceptedQuoteTotal] = useState("--");
  const [invoiceAllocationTargets, setInvoiceAllocationTargets] = useState<AllocationTarget[]>([]);
  const [toolbarPanel, setToolbarPanel] = useState<"payment" | null>(null);
  const [approvedQuotes, setApprovedQuotes] = useState<ApprovedQuote[]>([]);
  const [linkedQuoteIds, setLinkedQuoteIds] = useState<Set<number>>(new Set());
  const [isProjectEditOpen, setIsProjectEditOpen] = useState(false);
  const projectEditFormRef = useRef<HTMLFormElement | null>(null);

  const [projectName, setProjectName] = useState("");
  const [projectStatus, setProjectStatus] = useState<ProjectStatusValue>("prospect");

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const scopedProjectIdParam = searchParams.get("project");
  const scopedCustomerIdParam = searchParams.get("customer");
  const scopedProjectId =
    scopedProjectIdParam && /^\d+$/.test(scopedProjectIdParam)
      ? Number(scopedProjectIdParam)
      : null;
  const scopedCustomerId =
    scopedCustomerIdParam && /^\d+$/.test(scopedCustomerIdParam)
      ? Number(scopedCustomerIdParam)
      : null;
  const customerScopedProjects = scopedCustomerId
    ? projects.filter((project) => project.customer === scopedCustomerId)
    : projects;
  const hasSelectedProject = Boolean(selectedProjectId);
  const selectedProject =
    projects.find((project) => String(project.id) === selectedProjectId) ?? null;
  const isSelectedProjectTerminal =
    selectedProject?.status === "completed" || selectedProject?.status === "cancelled";
  const isSelectedProjectProspect = selectedProject?.status === "prospect";
  const quoteDone = approvedQuotes.filter((e) => linkedQuoteIds.has(e.id)).length;
  const hasPayableInvoices = invoiceAllocationTargets.length > 0;
  const computedProfileStatuses = selectedProject
    ? allowedProfileStatuses(selectedProject.status as ProjectStatusValue)
    : [];
  const needle = projectSearch.trim().toLowerCase();
  const filteredProjects = !needle
    ? customerScopedProjects
    : customerScopedProjects.filter((project) => {
        const haystack = [
          String(project.id),
          project.name,
          formatCustomerName(project),
          project.status,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
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
  const acceptedContractRaw =
    summary?.accepted_contract_total ??
    selectedProject?.accepted_contract_total ??
    acceptedQuoteTotal;
  const acceptedContractDisplay = summary ? formatCurrency(parseMoneyValue(acceptedContractRaw)) : "--";
  const invoicedDisplay = summary ? formatCurrency(parseMoneyValue(summary.invoiced_to_date)) : "--";
  const paidDisplay = summary ? formatCurrency(parseMoneyValue(summary.paid_to_date)) : "--";
  const arOutstandingDisplay = summary ? formatCurrency(parseMoneyValue(summary.ar_outstanding)) : "--";
  const remainingToInvoiceDisplay = summary
    ? formatCurrency(parseMoneyValue(acceptedContractRaw) - parseMoneyValue(summary.invoiced_to_date))
    : "--";

  /** Maps a status value like "on_hold" to its corresponding CSS module class. */
  function projectStatusClass(statusValue: string): string {
    const key = `projectStatus${statusValue
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("")}`;
    return styles[key] ?? "";
  }

  /** Toggles a status value in or out of the active project list filters. */
  function toggleProjectStatusFilter(nextStatus: ProjectStatusValue) {
    setProjectStatusFilters((current) =>
      current.includes(nextStatus)
        ? current.filter((statusValue) => statusValue !== nextStatus)
        : [...current, nextStatus],
    );
  }

  /** Populates the profile form fields from a project record. */
  function hydrateForm(project: ProjectRecord) {
    setProjectName(project.name);
    setProjectStatus(project.status as ProjectStatusValue);
  }

  /** Fetches all projects and auto-selects based on URL scope or default filters. */
  async function loadProjects() {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        return;
      }
      const items = (payload.data as ProjectRecord[]) ?? [];
      const scopedItems = scopedCustomerId
        ? items.filter((project) => project.customer === scopedCustomerId)
        : items;
      setProjects(items);
      if (scopedItems[0]) {
        const scopedMatch = scopedProjectId
          ? scopedItems.find((project) => project.id === scopedProjectId)
          : null;
        const preferredProject =
          scopedMatch ??
          scopedItems.find((project) =>
            DEFAULT_PROJECT_STATUS_FILTERS.includes(project.status as ProjectStatusValue),
          ) ?? scopedItems[0];
        if (scopedMatch) {
          const scopedStatus = scopedMatch.status as ProjectStatusValue;
          setProjectStatusFilters((current) =>
            current.includes(scopedStatus) ? current : [...current, scopedStatus],
          );
        }
        setSelectedProjectId(String(preferredProject.id));
        hydrateForm(preferredProject);
        setSummary(null);
      } else {
        setSelectedProjectId("");
        setSummary(null);
        setQuoteProgress(null);
        setCoProgress(null);
        setBillProgress(null);
        setInvoiceProgress(null);
      }
    } catch {
      // Network error — silently fail; the empty project list is visible feedback.
    }
  }

  /** Fetches the financial summary (contract, AR, AP totals) for the selected project. */
  async function loadFinancialSummary() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      return;
    }
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/financial-summary/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        return;
      }

      setSummary(payload.data as ProjectFinancialSummary);
    } catch {
      // Network error — summary panel will remain empty.
    }
  }

  /** Loads quote progress (total non-void, approved list) for the pipeline. */
  async function loadQuoteProgress(projectId: number) {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/quotes/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setQuoteProgress(null);
        return;
      }
      const rows = (payload.data as Array<{ id?: number; status?: string; title?: string; grand_total?: string | number }>) ?? [];
      let total = 0;
      let acceptedTotal = 0;
      const approvedList: ApprovedQuote[] = [];
      for (const quote of rows) {
        if (quote.status === "void" || quote.status === "draft") continue;
        total += 1;
        if (quote.status === "approved") {
          acceptedTotal += parseMoneyValue(quote.grand_total);
          approvedList.push({
            id: quote.id ?? 0,
            title: quote.title ?? "",
            grand_total: String(quote.grand_total ?? "0"),
          });
        }
      }
      setQuoteProgress({ total });
      setAcceptedQuoteTotal(formatCurrency(acceptedTotal));
      setApprovedQuotes(approvedList);
    } catch {
      setQuoteProgress(null);
      setAcceptedQuoteTotal("--");
    }
  }

  /** Loads change order progress (accepted / total non-void) for the pipeline. */
  async function loadCoProgress(projectId: number) {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/change-orders/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setCoProgress(null);
        return;
      }
      const rows = (payload.data as Array<{ status?: string }>) ?? [];
      let total = 0;
      let done = 0;
      for (const co of rows) {
        if (co.status === "void" || co.status === "draft") continue;
        total += 1;
        if (co.status === "approved") done += 1;
      }
      setCoProgress({ done, total });
    } catch {
      setCoProgress(null);
    }
  }

  /** Loads vendor bill progress (closed / total non-void) for the pipeline. */
  async function loadBillProgress(projectId: number) {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/vendor-bills/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setBillProgress(null);
        return;
      }
      const rows = (payload.data as Array<{ status?: string }>) ?? [];
      let total = 0;
      let done = 0;
      for (const bill of rows) {
        if (bill.status === "void") continue;
        total += 1;
        if (bill.status === "closed") done += 1;
      }
      setBillProgress({ done, total });
    } catch {
      setBillProgress(null);
    }
  }

  /** Loads invoice progress (closed / total non-void) for the pipeline. */
  async function loadInvoiceProgress(projectId: number) {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/invoices/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setInvoiceProgress(null);
        return;
      }
      const rows = (payload.data as Array<{ status?: string }>) ?? [];
      let total = 0;
      let done = 0;
      for (const invoice of rows) {
        if (invoice.status === "void" || invoice.status === "draft") continue;
        total += 1;
        if (invoice.status === "closed") done += 1;
      }
      setInvoiceProgress({ done, total });
    } catch {
      setInvoiceProgress(null);
    }
  }

  /** Loads invoices for the selected project and maps them to allocation targets. */
  async function loadInvoiceAllocationTargets(projectId: number) {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/invoices/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setInvoiceAllocationTargets([]);
        return;
      }
      const rows = (payload.data as Array<{
        id: number;
        invoice_number?: string;
        balance_due?: string;
        status?: string;
        related_quote?: number | null;
      }>) ?? [];
      setInvoiceAllocationTargets(
        rows
          .filter((inv) => inv.status !== "void" && inv.status !== "draft" && Number(inv.balance_due || 0) > 0)
          .map((inv) => ({
            id: inv.id,
            label: inv.invoice_number ? `Invoice ${inv.invoice_number}` : `Invoice #${inv.id}`,
            balanceDue: inv.balance_due ?? "0.00",
          })),
      );
      // Track which quotes already have a non-void linked invoice.
      const linked = new Set<number>();
      for (const inv of rows) {
        if (inv.related_quote && inv.status !== "void") {
          linked.add(inv.related_quote);
        }
      }
      setLinkedQuoteIds(linked);
    } catch {
      setInvoiceAllocationTargets([]);
    }
  }

  // Fetch the full project list whenever auth or URL scope changes.
  useEffect(() => {
    if (!authToken) {
      return;
    }
    void loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, scopedProjectId, scopedCustomerId]);

  // Re-load financials and scope-control counts when a different project is selected.
  useEffect(() => {
    if (!authToken || !selectedProjectId) {
      return;
    }
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      return;
    }
    void loadFinancialSummary();
    void loadQuoteProgress(projectId);
    void loadCoProgress(projectId);
    void loadBillProgress(projectId);
    void loadInvoiceProgress(projectId);
    void loadInvoiceAllocationTargets(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, authToken]);

  // If the selected project is no longer visible after filtering, fall back to the first visible one.
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
    hydrateForm(fallbackProject);

    setSummary(null);
    setQuoteProgress(null);
    setCoProgress(null);
    setBillProgress(null);
    setInvoiceProgress(null);
    setAcceptedQuoteTotal("--");
  }, [selectedProjectId, statusFilteredProjects]);

  // Scroll the profile form into view when it opens, so users don't miss it off-screen.
  useEffect(() => {
    if (!isProjectEditOpen || isSelectedProjectTerminal) {
      return;
    }
    const formEl = projectEditFormRef.current;
    if (!formEl) {
      return;
    }

    const rect = formEl.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const isFullyVisible = rect.top >= 0 && rect.bottom <= viewportHeight;
    if (!isFullyVisible) {
      formEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [isProjectEditOpen, isSelectedProjectTerminal, selectedProjectId]);

  /** Switches the selected project and resets downstream financial state. */
  function handleSelectProject(project: { id: number }) {
    if (String(project.id) === selectedProjectId) {
      return;
    }
    const selected = projects.find((row) => row.id === project.id);
    if (!selected) {
      return;
    }
    setSelectedProjectId(String(project.id));
    setIsProjectEditOpen(false);
    setToolbarPanel(null);
    hydrateForm(selected);

    // Clear stale financial data so it re-loads for the new project.
    setSummary(null);
    setQuoteProgress(null);
    setCoProgress(null);
    setBillProgress(null);
    setInvoiceProgress(null);
    setAcceptedQuoteTotal("--");
  }

  /** Toggles the project profile editor open/closed, pre-selecting the first allowed status. */
  function toggleProjectEdit() {
    setIsProjectEditOpen((current) => {
      const nextOpen = !current;
      if (nextOpen && selectedProject) {
        setProjectStatus(selectedProject.status as ProjectStatusValue);
      }
      return nextOpen;
    });
  }

  /** Validates and PATCHes the project profile form to the API. */
  async function handleSaveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setErrorStatusMessage(
        "No project selected. Load projects first, then pick one from the project dropdown.",
      );
      return;
    }
    // Validation passed -- submit the PATCH.
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({
          name: projectName,
          status: projectStatus,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setErrorStatusMessage(readApiErrorMessage(payload, "Save failed. Check values and auth token."));
        return;
      }

      const updated = payload.data as ProjectRecord;
      setProjects((current) =>
        current.map((project) => (project.id === updated.id ? updated : project)),
      );
      setSuccessStatusMessage(`Project #${updated.id} saved.`);
    } catch {
      setErrorStatusMessage("Could not reach project detail endpoint.");
    }
  }

  return (
    <section className={styles.pageRoot}>
      {authMessage.startsWith("No shared session") ? <p>{authMessage}</p> : null}

      {projects.length === 0 ? (
        <p className={styles.emptyState}>
          No projects yet. Head to <Link href="/customers" style={{ fontWeight: 600 }}>Customers</Link> and
          use the &ldquo;Add Project&rdquo; button on any customer to get started.
        </p>
      ) : null}

      {projects.length > 0 ? (
        <ProjectListViewer
          title="Choose a project below"
          expandedHint="Select a project to open its map, financial snapshot, and downstream actions."
          showSearchAndFilters
          searchValue={projectSearch}
          onSearchChange={setProjectSearch}
          statusValues={[...PROJECT_STATUS_VALUES]}
          statusFilters={projectStatusFilters}
          statusCounts={projectStatusCounts}
          onToggleStatusFilter={toggleProjectStatusFilter}
          onShowAllStatuses={() =>
            setProjectStatusFilters(["active", "on_hold", "prospect", "completed", "cancelled"])
          }
          onResetStatuses={() => setProjectStatusFilters(DEFAULT_PROJECT_STATUS_FILTERS)}
          projects={statusFilteredProjects.map((project) => ({
            id: project.id,
            name: project.name,
            customer_display_name: formatCustomerName(project),
            status: project.status,
          }))}
          selectedProjectId={selectedProjectId}
          onSelectProject={handleSelectProject}
          statusLabel={projectStatusLabel}
        />
      ) : null}

      {selectedProject ? (
        <section className={styles.overview}>
          <div className={styles.overviewGrid}>
            <div className={styles.treePanel}>
              <div className={styles.treeRoot}>
                <div className={styles.rootTitleRow}>
                  <span className={styles.rootTitle}>{selectedProject.name}</span>
                  {!isSelectedProjectTerminal ? (
                    <button
                      type="button"
                      className={styles.projectSettingsToggle}
                      aria-expanded={isProjectEditOpen}
                      onClick={toggleProjectEdit}
                    >
                      {isProjectEditOpen ? "Close Edit" : "Edit Project"}
                    </button>
                  ) : (
                    <span className={styles.terminalHint}>
                      {selectedProject?.status === "completed" ? "Completed" : "Cancelled"} — no longer editable
                    </span>
                  )}
                </div>
                {isProjectEditOpen && !isSelectedProjectTerminal ? (
                  <form ref={projectEditFormRef} className={styles.projectEditForm} onSubmit={handleSaveProject}>
                    <label>
                      Project name
                      <input value={projectName} onChange={(event) => setProjectName(event.target.value)} required />
                    </label>
                    <label>
                      Status
                      <div className={styles.projectStatusPills}>
                        <span className={styles.projectStatusCurrentLabel}>
                          Current: {projectStatusLabel(selectedProject.status)}
                        </span>
                        {computedProfileStatuses.map((statusOption) => {
                          const active = projectStatus === statusOption;
                          return (
                            <button
                              key={statusOption}
                              type="button"
                              className={`${styles.projectStatusPill} ${
                                active ? projectStatusClass(statusOption) : styles.projectStatusPillInactive
                              } ${active ? styles.projectStatusPillActive : ""}`}
                              aria-pressed={active}
                              onClick={() => setProjectStatus(statusOption)}
                            >
                              {projectStatusLabel(statusOption)}
                            </button>
                          );
                        })}
                      </div>
                    </label>
                    {statusMessage ? (
                      <p
                        className={`${styles.statusMessage} ${
                          statusMessageTone === "success"
                            ? styles.statusMessageSuccess
                            : statusMessageTone === "error"
                              ? styles.statusMessageError
                              : ""
                        }`}
                      >
                        {statusMessage}
                      </p>
                    ) : null}
                    <button
                      type="submit"
                      className={styles.projectEditSubmit}
                      disabled={!hasSelectedProject}
                    >
                      Save
                    </button>
                  </form>
                ) : null}
              </div>
              <nav className={styles.pipeline} aria-label="Project workflow">
                <Link href={`/projects/${selectedProject.id}/quotes`} className={styles.pipelineStage}>
                  <svg className={styles.pipelineIcon} width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                  </svg>
                  <span className={styles.pipelineLabel}>Quotes</span>
                  <div className={styles.progressSection}>
                    {quoteProgress && quoteProgress.total > 0 ? (
                      <>
                        <div className={styles.progressTrack}>
                          <div
                            className={styles.progressFill}
                            style={{ width: `${(quoteDone / quoteProgress.total) * 100}%` }}
                          />
                        </div>
                        <span className={styles.progressText}>
                          {quoteDone} of {quoteProgress.total} invoiced
                        </span>
                      </>
                    ) : (
                      <span className={styles.progressHint}>Create an quote</span>
                    )}
                  </div>
                </Link>

                <span className={styles.pipelineArrow} aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </span>

                <Link href={`/projects/${selectedProject.id}/change-orders`} className={styles.pipelineStage}>
                  <svg className={styles.pipelineIcon} width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="17 1 21 5 17 9" />
                    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                    <polyline points="7 23 3 19 7 15" />
                    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                  </svg>
                  <span className={styles.pipelineLabel}>Change Orders</span>
                  <div className={styles.progressSection}>
                    {coProgress && coProgress.total > 0 ? (
                      <>
                        <div className={styles.progressTrack}>
                          <div
                            className={styles.progressFill}
                            style={{ width: `${(coProgress.done / coProgress.total) * 100}%` }}
                          />
                        </div>
                        <span className={styles.progressText}>
                          {coProgress.done} of {coProgress.total} accepted
                        </span>
                      </>
                    ) : (
                      <span className={styles.progressHint}>No change orders yet</span>
                    )}
                  </div>
                </Link>

                <span className={styles.pipelineArrow} aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </span>

                <Link href={`/projects/${selectedProject.id}/invoices`} className={styles.pipelineStage}>
                  <svg className={styles.pipelineIcon} width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                  <span className={styles.pipelineLabel}>Invoices</span>
                  <div className={styles.progressSection}>
                    {invoiceProgress && invoiceProgress.total > 0 ? (
                      <>
                        <div className={styles.progressTrack}>
                          <div
                            className={styles.progressFill}
                            style={{ width: `${(invoiceProgress.done / invoiceProgress.total) * 100}%` }}
                          />
                        </div>
                        <span className={styles.progressText}>
                          {invoiceProgress.done} of {invoiceProgress.total} closed
                        </span>
                      </>
                    ) : (
                      <span className={styles.progressHint}>Invoice an approved quote</span>
                    )}
                  </div>
                </Link>

                <span className={styles.pipelineArrow} aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </span>

                <Link href={`/projects/${selectedProject.id}/bills`} className={styles.pipelineStage}>
                  <svg className={styles.pipelineIcon} width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="M7 15h0M2 9.5h20" />
                  </svg>
                  <span className={styles.pipelineLabel}>Expenses</span>
                  <div className={styles.progressSection}>
                    {billProgress && billProgress.total > 0 ? (
                      <>
                        <div className={styles.progressTrack}>
                          <div
                            className={styles.progressFill}
                            style={{ width: `${(billProgress.done / billProgress.total) * 100}%` }}
                          />
                        </div>
                        <span className={styles.progressText}>
                          {billProgress.done} of {billProgress.total} paid
                        </span>
                      </>
                    ) : (
                      <span className={styles.progressHint}>No expenses yet</span>
                    )}
                  </div>
                </Link>

              </nav>

              <div className={styles.actionToolbar} role="toolbar" aria-label="Project actions">
                <button
                  type="button"
                  className={`${styles.toolbarAction} ${toolbarPanel === "payment" ? styles.toolbarActionActive : ""}`}
                  disabled={!hasPayableInvoices || isSelectedProjectProspect}
                  onClick={() => setToolbarPanel(toolbarPanel === "payment" ? null : "payment")}
                >
                  Record Payment
                </button>
              </div>

            </div>

            <div className={styles.paymentRecorderSection}>
              {toolbarPanel === "payment" ? (
                <PaymentRecorder
                  projectId={selectedProject.id}
                  direction="inbound"
                  allocationTargets={invoiceAllocationTargets}
                  hideHeader
                  createOnly
                  hideWorkspaceTitle
                  onPaymentsChanged={() => {
                    void loadFinancialSummary();
                    void loadInvoiceAllocationTargets(selectedProject.id);
                  }}
                />
              ) : (
                <p className={styles.toolbarPanelPrompt}>
                  Select an action from the toolbar to get started.
                </p>
              )}
            </div>

            <div className={styles.metricsPanel}>
              <div className={styles.metricRow}>
                <span>Contract Total</span>
                <strong>{acceptedContractDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>Invoiced</span>
                <strong>{invoicedDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>Paid</span>
                <strong>{paidDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>Outstanding</span>
                <strong>{arOutstandingDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>Remaining to Invoice</span>
                <strong>{remainingToInvoiceDisplay}</strong>
              </div>
            </div>
          </div>

        </section>
      ) : null}

    </section>
  );
}
