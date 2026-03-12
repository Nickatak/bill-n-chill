"use client";

/**
 * Primary project hub that lets users browse, select, and manage projects.
 * Shows a paginated/filterable project list, a financial snapshot with scope
 * control and billing tree, and an inline project profile editor.
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
import { ProjectListViewer } from "@/shared/project-list-viewer";
import { ApiResponse, ProjectFinancialSummary, ProjectRecord } from "../types";
import {
  PROJECT_STATUS_VALUES,
  PROJECT_STATUS_TRANSITIONS,
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
  const { token, authMessage } = useSharedSessionAuth();
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
  const [isProjectListExpanded, setIsProjectListExpanded] = useState(true);
  const [summary, setSummary] = useState<ProjectFinancialSummary | null>(null);
  const [estimateStatusCounts, setEstimateStatusCounts] = useState<{
    draft: number;
    sent: number;
    approved: number;
  } | null>(null);
  const [changeOrderStatusCounts, setChangeOrderStatusCounts] = useState<{
    draft: number;
    sent: number;
    accepted: number;
  } | null>(null);
  const [acceptedEstimateTotal, setAcceptedEstimateTotal] = useState("--");
  const [acceptedChangeOrderDeltaTotal, setAcceptedChangeOrderDeltaTotal] = useState("--");
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
  const contractOriginalDisplay =
    summary?.contract_value_original ?? selectedProject?.contract_value_original ?? "--";
  const acceptedContractDisplay =
    summary?.accepted_contract_total ??
    selectedProject?.accepted_contract_total ??
    acceptedEstimateTotal;
  const arOutstandingDisplay = summary?.ar_outstanding ?? "--";
  const unbilledFromAcceptedDisplay = summary
    ? formatCurrency(
        parseMoneyValue(acceptedContractDisplay) - parseMoneyValue(arOutstandingDisplay),
      )
    : "--";
  const apOutstandingDisplay = summary?.ap_outstanding ?? "--";
  const apTotalDisplay = summary?.ap_total ?? "--";
  const apPaidDisplay = summary?.ap_paid ?? "--";
  const invoicedDisplay = summary?.invoiced_to_date ?? "--";
  const paidDisplay = summary?.paid_to_date ?? "--";
  const inboundCreditDisplay = summary?.inbound_unapplied_credit ?? "--";
  const outboundCreditDisplay = summary?.outbound_unapplied_credit ?? "--";
  const activeFinancialEstimateDisplay = "--";
  const activeFinancialBudgetDisplay = "--";
  const unspentFromAcceptedDisplay = summary
    ? formatCurrency(
        parseMoneyValue(acceptedContractDisplay) - parseMoneyValue(apOutstandingDisplay),
      )
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
        headers: buildAuthHeaders(token),
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
        setEstimateStatusCounts(null);
        setChangeOrderStatusCounts(null);
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
        headers: buildAuthHeaders(token),
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

  /** Loads estimate counts by status for the scope-control badges. */
  async function loadEstimateStatusCounts(projectId: number) {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/estimates/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setEstimateStatusCounts(null);
        return;
      }
      const rows = (payload.data as Array<{ status?: string; grand_total?: string | number }>) ?? [];
      let draft = 0;
      let sent = 0;
      let approved = 0;
      let acceptedTotal = 0;
      for (const estimate of rows) {
        if (estimate.status === "draft") {
          draft += 1;
        } else if (estimate.status === "sent") {
          sent += 1;
        } else if (estimate.status === "approved" || estimate.status === "accepted") {
          approved += 1;
          acceptedTotal += parseMoneyValue(estimate.grand_total);
        }
      }
      setEstimateStatusCounts({ draft, sent, approved });
      setAcceptedEstimateTotal(formatCurrency(acceptedTotal));
    } catch {
      setEstimateStatusCounts(null);
      setAcceptedEstimateTotal("--");
    }
  }

  /** Loads change order counts by status for the scope-control badges. */
  async function loadChangeOrderStatusCounts(projectId: number) {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/change-orders/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setChangeOrderStatusCounts(null);
        return;
      }
      const rows = (payload.data as Array<{ status?: string; amount_delta?: string | number }>) ?? [];
      let draft = 0;
      let sent = 0;
      let accepted = 0;
      let acceptedDelta = 0;
      for (const changeOrder of rows) {
        if (changeOrder.status === "draft") {
          draft += 1;
        } else if (changeOrder.status === "pending_approval" || changeOrder.status === "sent") {
          sent += 1;
        } else if (changeOrder.status === "accepted" || changeOrder.status === "approved") {
          accepted += 1;
          acceptedDelta += parseMoneyValue(changeOrder.amount_delta);
        }
      }
      setChangeOrderStatusCounts({ draft, sent, accepted });
      setAcceptedChangeOrderDeltaTotal(formatCurrency(acceptedDelta));
    } catch {
      setChangeOrderStatusCounts(null);
      setAcceptedChangeOrderDeltaTotal("--");
    }
  }

  // Fetch the full project list whenever auth or URL scope changes.
  useEffect(() => {
    if (!token) {
      return;
    }
    void loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, scopedProjectId, scopedCustomerId]);

  // Re-load financials and scope-control counts when a different project is selected.
  useEffect(() => {
    if (!token || !selectedProjectId) {
      return;
    }
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      return;
    }
    void loadFinancialSummary();
    void loadEstimateStatusCounts(projectId);
    void loadChangeOrderStatusCounts(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, token]);

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
    setEstimateStatusCounts(null);
    setChangeOrderStatusCounts(null);
    setAcceptedEstimateTotal("--");
    setAcceptedChangeOrderDeltaTotal("--");
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
    hydrateForm(selected);

    // Clear stale financial data so it re-loads for the new project.
    setSummary(null);
    setEstimateStatusCounts(null);
    setChangeOrderStatusCounts(null);
    setAcceptedEstimateTotal("--");
    setAcceptedChangeOrderDeltaTotal("--");
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
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
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
    <section>
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
          isExpanded={isProjectListExpanded}
          onToggleExpanded={() => setIsProjectListExpanded((current) => !current)}
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
                  ) : null}
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
              <div className={styles.treeBranches}>
                <div className={styles.branch}>
                  <div className={styles.node}>
                    <Link href={`/projects/${selectedProject.id}/estimates`}>Estimates</Link>
                    <span className={styles.nodeEstimateMeta}>
                      <span className={`${styles.estimateCountPill} ${styles.estimateCountDraft}`}>
                        D{estimateStatusCounts ? estimateStatusCounts.draft : "--"}
                      </span>
                      <span className={`${styles.estimateCountPill} ${styles.estimateCountSent}`}>
                        S{estimateStatusCounts ? estimateStatusCounts.sent : "--"}
                      </span>
                      <span className={`${styles.estimateCountPill} ${styles.estimateCountApproved}`}>
                        A{estimateStatusCounts ? estimateStatusCounts.approved : "--"}
                      </span>
                    </span>
                  </div>
                  <div className={styles.node}>
                    <Link href={`/projects/${selectedProject.id}/change-orders`}>Change Orders</Link>
                    <span className={styles.nodeEstimateMeta}>
                      <span className={`${styles.estimateCountPill} ${styles.estimateCountDraft}`}>
                        D{changeOrderStatusCounts ? changeOrderStatusCounts.draft : "--"}
                      </span>
                      <span className={`${styles.estimateCountPill} ${styles.estimateCountSent}`}>
                        S{changeOrderStatusCounts ? changeOrderStatusCounts.sent : "--"}
                      </span>
                      <span className={`${styles.estimateCountPill} ${styles.estimateCountApproved}`}>
                        A{changeOrderStatusCounts ? changeOrderStatusCounts.accepted : "--"}
                      </span>
                    </span>
                  </div>
                  <div className={styles.node}>
                    <Link href={`/projects/${selectedProject.id}/invoices`}>Invoices</Link>
                  </div>
                  <div className={styles.node}>
                    <Link href={`/projects/${selectedProject.id}/audit-trail`}>Event History</Link>
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.metricsPanel}>
              <div className={`${styles.baselineCard} ${styles.baselineInactive}`}>
                <span className={styles.baselineCardLabel}>Project Baseline</span>
                <strong className={styles.baselineCardValue}>{activeFinancialEstimateDisplay}</strong>
                <span className={styles.baselineCardMeta}>{activeFinancialBudgetDisplay}</span>
              </div>
              <section className={styles.metricSection}>
                <h4 className={styles.metricSectionTitle}>Estimates / Approvals</h4>
                <div className={styles.metricRow}>
                  <span>Eyeball / Initial Estimate</span>
                  <strong>{contractOriginalDisplay}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>Accepted Contract Total</span>
                  <strong>{acceptedContractDisplay}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>Accepted CO Delta</span>
                  <strong>{acceptedChangeOrderDeltaTotal}</strong>
                </div>
              </section>
              <section className={styles.metricSection}>
                <h4 className={styles.metricSectionTitle}>Income</h4>
                <div className={styles.metricRow}>
                  <span>Invoiced to date</span>
                  <strong>{invoicedDisplay}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>Inbound payments to date</span>
                  <strong>{paidDisplay}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>Inbound credit</span>
                  <strong>{inboundCreditDisplay}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>AR outstanding</span>
                  <strong>{arOutstandingDisplay}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>Not Yet Billed</span>
                  <strong>{unbilledFromAcceptedDisplay}</strong>
                </div>
              </section>
              <section className={styles.metricSection}>
                <h4 className={styles.metricSectionTitle}>Expenses</h4>
                <div className={styles.metricRow}>
                  <span>Bills to date</span>
                  <strong>{apTotalDisplay}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>Payments out to date</span>
                  <strong>{apPaidDisplay}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>Outbound credit</span>
                  <strong>{outboundCreditDisplay}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>AP outstanding</span>
                  <strong>{apOutstandingDisplay}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>Not Yet Expensed</span>
                  <strong>{unspentFromAcceptedDisplay}</strong>
                </div>
              </section>
            </div>
          </div>
        </section>
      ) : null}

    </section>
  );
}
