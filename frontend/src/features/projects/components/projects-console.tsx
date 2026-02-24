"use client";

import { buildAuthHeaders } from "@/features/session/auth-headers";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { loadClientSession } from "../../session/client-session";
import { formatDateDisplay } from "../../../shared/date-format";
import styles from "./projects-console.module.css";
import { ApiResponse, ProjectFinancialSummary, ProjectRecord } from "../types";

type ProjectStatusValue = "prospect" | "active" | "on_hold" | "completed" | "cancelled";
type StatusMessageTone = "neutral" | "success" | "error";

export function ProjectsConsole() {
  const searchParams = useSearchParams();
  const projectPageSize = 5;
  const projectStatusTransitions: Record<ProjectStatusValue, ProjectStatusValue[]> = {
    prospect: ["active", "cancelled"],
    active: ["on_hold", "completed", "cancelled"],
    on_hold: ["active", "completed", "cancelled"],
    completed: [],
    cancelled: [],
  };
  const defaultProjectStatusFilters: ProjectStatusValue[] = ["active", "prospect"];
  const [token, setToken] = useState("");
  const [authMessage, setAuthMessage] = useState("Checking session...");
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusMessageTone, setStatusMessageTone] = useState<StatusMessageTone>("neutral");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatusFilters, setProjectStatusFilters] = useState<ProjectStatusValue[]>(
    defaultProjectStatusFilters,
  );
  const [currentProjectPage, setCurrentProjectPage] = useState(1);
  const [summary, setSummary] = useState<ProjectFinancialSummary | null>(null);
  const [estimateStatusCounts, setEstimateStatusCounts] = useState<{
    draft: number;
    sent: number;
    approved: number;
  } | null>(null);
  const [isProjectProfileOpen, setIsProjectProfileOpen] = useState(false);

  const [projectName, setProjectName] = useState("");
  const [projectStatus, setProjectStatus] = useState<ProjectStatusValue>("prospect");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

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
  const allowedNextProjectStatuses = selectedProject
    ? projectStatusTransitions[selectedProject.status as ProjectStatusValue] ?? []
    : [];
  const allowedProfileStatuses = selectedProject
    ? [selectedProject.status as ProjectStatusValue, ...allowedNextProjectStatuses]
        .filter((value, index, source) => source.indexOf(value) === index)
    : [];
  const hasInvalidDateRange = Boolean(startDate && endDate && endDate < startDate);
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
  const statusFilteredProjects = filteredProjects.filter((project) =>
    projectStatusFilters.includes(project.status as ProjectStatusValue),
  );
  const totalProjectPages = Math.max(1, Math.ceil(statusFilteredProjects.length / projectPageSize));
  const currentProjectPageSafe = Math.min(currentProjectPage, totalProjectPages);
  const projectPageStartIndex = (currentProjectPageSafe - 1) * projectPageSize;
  const pagedProjects = statusFilteredProjects.slice(
    projectPageStartIndex,
    projectPageStartIndex + projectPageSize,
  );
  const summaryCounts = summary
    ? {
        changeOrders: summary.traceability.approved_change_orders.records.length,
        invoices: summary.traceability.ar_invoices.records.length,
        arPayments: summary.traceability.ar_payments.records.length,
        vendorBills: summary.traceability.ap_vendor_bills.records.length,
        apPayments: summary.traceability.ap_payments.records.length,
      }
    : null;
  const contractOriginalDisplay =
    summary?.contract_value_original ?? selectedProject?.contract_value_original ?? "--";
  const contractCurrentDisplay =
    summary?.contract_value_current ?? selectedProject?.contract_value_current ?? "--";
  const arOutstandingDisplay = summary?.ar_outstanding ?? "--";
  const apOutstandingDisplay = summary?.ap_outstanding ?? "--";
  const invoicedDisplay = summary?.invoiced_to_date ?? "--";
  const paidDisplay = summary?.paid_to_date ?? "--";
  const inboundCreditDisplay = summary?.inbound_unapplied_credit ?? "--";
  const outboundCreditDisplay = summary?.outbound_unapplied_credit ?? "--";

  function formatCustomerName(project: ProjectRecord): string {
    return project.customer_display_name || `Customer #${project.customer}`;
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

  function toggleProjectStatusFilter(nextStatus: ProjectStatusValue) {
    setProjectStatusFilters((current) =>
      current.includes(nextStatus)
        ? current.filter((statusValue) => statusValue !== nextStatus)
        : [...current, nextStatus],
    );
  }

  function hydrateForm(project: ProjectRecord) {
    setProjectName(project.name);
    setProjectStatus(project.status as ProjectStatusValue);
    setStartDate(project.start_date_planned ?? "");
    setEndDate(project.end_date_planned ?? "");
  }

  function setNeutralStatusMessage(message: string) {
    setStatusMessageTone("neutral");
    setStatusMessage(message);
  }

  function setSuccessStatusMessage(message: string) {
    setStatusMessageTone("success");
    setStatusMessage(message);
  }

  function setErrorStatusMessage(message: string) {
    setStatusMessageTone("error");
    setStatusMessage(message);
  }

  async function loadProjects() {
    setNeutralStatusMessage("Loading projects...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setErrorStatusMessage("Could not load projects.");
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
            defaultProjectStatusFilters.includes(project.status as ProjectStatusValue),
          ) ?? scopedItems[0];
        setSelectedProjectId(String(preferredProject.id));
        hydrateForm(preferredProject);
        setSummary(null);
        if (scopedProjectId && !scopedMatch) {
          setNeutralStatusMessage(
            `Project #${scopedProjectId} is not available in your scope. Loaded default project.`,
          );
          return;
        }
        if (scopedCustomerId) {
          setStatusMessage("");
          return;
        }
        setStatusMessage("");
      } else if (scopedCustomerId) {
        setSelectedProjectId("");
        setSummary(null);
        setEstimateStatusCounts(null);
        setNeutralStatusMessage(`No projects found for customer #${scopedCustomerId}.`);
      } else {
        setSelectedProjectId("");
        setSummary(null);
        setEstimateStatusCounts(null);
        setNeutralStatusMessage(
          "No projects found for this user. Create one from Intake -> Convert Lead to Project.",
        );
      }
    } catch {
      setErrorStatusMessage("Could not reach projects endpoint.");
    }
  }

  async function loadFinancialSummary() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setErrorStatusMessage("Select a project first.");
      return;
    }
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/financial-summary/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setErrorStatusMessage("Could not load financial summary.");
        return;
      }

      setSummary(payload.data as ProjectFinancialSummary);
    } catch {
      setErrorStatusMessage("Could not reach financial summary endpoint.");
    }
  }

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
      const rows = (payload.data as Array<{ status?: string }>) ?? [];
      let draft = 0;
      let sent = 0;
      let approved = 0;
      for (const estimate of rows) {
        if (estimate.status === "draft") {
          draft += 1;
        } else if (estimate.status === "sent") {
          sent += 1;
        } else if (estimate.status === "approved" || estimate.status === "accepted") {
          approved += 1;
        }
      }
      setEstimateStatusCounts({ draft, sent, approved });
    } catch {
      setEstimateStatusCounts(null);
    }
  }

  useEffect(() => {
    const session = loadClientSession();
    if (!session?.token) {
      setToken("");
      setAuthMessage("No shared session found. Go to / and login first.");
      return;
    }
    setToken(session.token);
    setAuthMessage(`Using shared session for ${session.email || "user"}.`);
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    void loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, scopedProjectId, scopedCustomerId]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, token]);

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
    hydrateForm(fallbackProject);
    setSummary(null);
    setEstimateStatusCounts(null);
  }, [selectedProjectId, statusFilteredProjects]);

  function handleSelectProject(project: ProjectRecord) {
    if (String(project.id) === selectedProjectId) {
      return;
    }
    setSelectedProjectId(String(project.id));
    setIsProjectProfileOpen(false);
    setSummary(null);
    setEstimateStatusCounts(null);
    hydrateForm(project);
  }

  async function handleSaveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setErrorStatusMessage(
        "No project selected. Load projects first, then pick one from the project dropdown.",
      );
      return;
    }
    if (hasInvalidDateRange) {
      setErrorStatusMessage("Planned end date cannot be before planned start date.");
      return;
    }

    setNeutralStatusMessage("Saving project profile...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          name: projectName,
          status: projectStatus,
          start_date_planned: startDate || null,
          end_date_planned: endDate || null,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setErrorStatusMessage("Save failed. Check values and auth token.");
        return;
      }

      const updated = payload.data as ProjectRecord;
      setProjects((current) =>
        current.map((project) => (project.id === updated.id ? updated : project)),
      );
      setIsProjectProfileOpen(false);
      setSuccessStatusMessage(`Project #${updated.id} saved.`);
    } catch {
      setErrorStatusMessage("Could not reach project detail endpoint.");
    }
  }

  async function downloadAccountingExport() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setErrorStatusMessage("Select a project first.");
      return;
    }

    setNeutralStatusMessage("Downloading accounting export...");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/projects/${projectId}/accounting-export/?export_format=csv`,
        {
          headers: buildAuthHeaders(token),
        },
      );
      if (!response.ok) {
        setErrorStatusMessage("Could not download accounting export.");
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `project-${projectId}-accounting-export.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
      setSuccessStatusMessage("Accounting export downloaded.");
    } catch {
      setErrorStatusMessage("Could not reach accounting export endpoint.");
    }
  }

  return (
    <section>
      {authMessage.startsWith("No shared session") ? <p>{authMessage}</p> : null}

      {projects.length === 0 ? (
        <p>
          No projects yet. Create one from <code>/customers</code> or <code>/intake/quick-add</code>.
        </p>
      ) : null}

      {projects.length > 0 ? (
        <section>
          <h3>Project List</h3>
          <p>Select a project to open its map, financial snapshot, and downstream actions.</p>
          <label className={styles.searchField}>
            Search projects
            <input
              value={projectSearch}
              onChange={(event) => setProjectSearch(event.target.value)}
              placeholder="ID, name, customer, or status"
            />
          </label>
          <div className={styles.projectFilters}>
            <span className={styles.projectFiltersLabel}>Project status filter</span>
            <div className={styles.projectFilterButtons}>
              {(["prospect", "active", "on_hold", "cancelled", "completed"] as ProjectStatusValue[]).map(
                (statusValue) => {
                  const active = projectStatusFilters.includes(statusValue);
                  return (
                    <button
                      key={statusValue}
                      type="button"
                      className={`${styles.projectFilterButton} ${
                        active ? projectStatusClass(statusValue) : styles.projectFilterButtonInactive
                      } ${active ? styles.projectFilterButtonActive : ""}`}
                      aria-pressed={active}
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
                Show All Projects
              </button>
              <button
                type="button"
                className={styles.projectFilterActionButton}
                onClick={() => setProjectStatusFilters(defaultProjectStatusFilters)}
              >
                Reset Filters
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
                  <th>Workflow</th>
                  <th>Accepted Contract Total</th>
                  <th>Start</th>
                  <th>End</th>
                </tr>
              </thead>
              <tbody>
                {pagedProjects.map((project) => {
                  const isActive = String(project.id) === selectedProjectId;
                  const startLabel = formatDateDisplay(project.start_date_planned, "TBD");
                  const endLabel = formatDateDisplay(project.end_date_planned, "TBD");
                  return (
                    <tr
                      key={project.id}
                      className={`${styles.projectRow} ${isActive ? styles.projectRowActive : ""}`}
                      onClick={() => handleSelectProject(project)}
                    >
                      <td>
                        <div className={styles.projectCellTitle}>
                          <strong>
                            #{project.id} {project.name}
                          </strong>
                        </div>
                      </td>
                      <td>{formatCustomerName(project)}</td>
                      <td>
                        <span className={`${styles.projectStatus} ${projectStatusClass(project.status)}`}>
                          {project.status}
                        </span>
                      </td>
                      <td>
                        <Link
                          href={`/projects/${project.id}/estimates`}
                          className={styles.projectActionLink}
                        >
                          Open Estimates
                        </Link>
                      </td>
                      <td>{project.contract_value_current}</td>
                      <td>{startLabel}</td>
                      <td>{endLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className={styles.projectPagination}>
              <button
                type="button"
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
                onClick={() => setCurrentProjectPage((page) => Math.min(totalProjectPages, page + 1))}
                disabled={currentProjectPageSafe >= totalProjectPages}
              >
                Next
              </button>
            </div>
          </div>
          {statusFilteredProjects.length === 0 ? (
            <p className={styles.searchEmpty}>No projects match your search/filter.</p>
          ) : null}
        </section>
      ) : null}

      {selectedProject ? (
        <section className={styles.overview}>
          <div className={styles.overviewHeader}>
            <div>
              <h3>Project Map</h3>
              <p>Downstream workflow map with quick financial context.</p>
            </div>
            <div className={styles.overviewActions}>
              <button type="button" onClick={loadFinancialSummary}>
                {summary ? "Refresh Summary" : "Load Summary"}
              </button>
              <button type="button" onClick={downloadAccountingExport}>
                Download Accounting Export
              </button>
            </div>
          </div>
          <div className={styles.overviewGrid}>
            <div className={styles.treePanel}>
              <div className={styles.treeRoot}>
                <span className={styles.rootLabel}>Project</span>
                <div className={styles.rootTitleRow}>
                  <span className={styles.rootTitle}>{selectedProject.name}</span>
                  {!isSelectedProjectTerminal ? (
                    <button
                      type="button"
                      className={styles.projectSettingsToggle}
                      aria-expanded={isProjectProfileOpen}
                      onClick={() => setIsProjectProfileOpen((current) => !current)}
                    >
                      {isProjectProfileOpen ? "Close Settings" : "Edit Project"}
                    </button>
                  ) : null}
                </div>
                <span className={styles.rootMeta}>
                  {formatCustomerName(selectedProject)} • {projectStatusLabel(selectedProject.status)}
                </span>
              </div>
              <div className={styles.treeBranches}>
                <div className={styles.branch}>
                  <span className={styles.branchLabel}>Scope</span>
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
                    <Link
                      href={`/projects/${selectedProject.id}/budgets/analytics`}
                      prefetch={false}
                    >
                      Budget Analytics
                    </Link>
                    <span className={styles.nodeCount}>Auto</span>
                  </div>
                  <div className={styles.node}>
                    <Link href={`/projects/${selectedProject.id}/change-orders`}>Change Orders</Link>
                    <span className={styles.nodeCount}>
                      {summaryCounts ? summaryCounts.changeOrders : "--"}
                    </span>
                  </div>
                  <div className={styles.node}>
                    <Link href={`/projects/${selectedProject.id}/activity`}>Activity Timeline</Link>
                  </div>
                </div>
                <div className={styles.branch}>
                  <span className={styles.branchLabel}>Receivables</span>
                  <div className={styles.node}>
                    <Link href="/invoices">Invoices</Link>
                    <span className={styles.nodeCount}>
                      {summaryCounts ? summaryCounts.invoices : "--"}
                    </span>
                  </div>
                  <div className={styles.node}>
                    <Link href="/payments">Payments (AR)</Link>
                    <span className={styles.nodeCount}>
                      {summaryCounts ? summaryCounts.arPayments : "--"}
                    </span>
                  </div>
                </div>
                <div className={styles.branch}>
                  <span className={styles.branchLabel}>Payables</span>
                  <div className={styles.node}>
                    <Link href={`/projects/${selectedProject.id}/vendor-bills`}>Vendor Bills</Link>
                    <span className={styles.nodeCount}>
                      {summaryCounts ? summaryCounts.vendorBills : "--"}
                    </span>
                  </div>
                  <div className={styles.node}>
                    <Link href={`/projects/${selectedProject.id}/expenses`}>Expenses</Link>
                  </div>
                  <div className={styles.node}>
                    <Link href="/payments">Payments (AP)</Link>
                    <span className={styles.nodeCount}>
                      {summaryCounts ? summaryCounts.apPayments : "--"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.metricsPanel}>
              <div className={styles.metricRow}>
                <span>Eyeball / Initial Estimate</span>
                <strong>{contractOriginalDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>Accepted Contract Total</span>
                <strong>{contractCurrentDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>Invoiced to date</span>
                <strong>{invoicedDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>Paid to date</span>
                <strong>{paidDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>AR outstanding</span>
                <strong>{arOutstandingDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>AP outstanding</span>
                <strong>{apOutstandingDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>Inbound credit</span>
                <strong>{inboundCreditDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>Outbound credit</span>
                <strong>{outboundCreditDisplay}</strong>
              </div>
              <p className={styles.metricHint}>
                {summary
                  ? "Summary auto-refreshed on project selection."
                  : "Load summary to populate totals."}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {selectedProject && isProjectProfileOpen && !isSelectedProjectTerminal ? (
        <form className={styles.projectProfileForm} onSubmit={handleSaveProject}>
          <h3>Project Details</h3>
          <label>
            Project name
            <input value={projectName} onChange={(event) => setProjectName(event.target.value)} required />
          </label>
          <label>
            Status
            <div className={styles.projectStatusPills}>
              {allowedProfileStatuses.map((statusOption) => {
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
          <label>
            Planned start date
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <label>
            Planned end date
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
          {hasInvalidDateRange ? (
            <p className={styles.projectProfileError}>
              Planned end date cannot be before planned start date.
            </p>
          ) : null}
          <button type="submit" disabled={!hasSelectedProject || hasInvalidDateRange}>
            Save Project Profile
          </button>
        </form>
      ) : null}

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
    </section>
  );
}
