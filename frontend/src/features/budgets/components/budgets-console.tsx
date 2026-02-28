"use client";

/**
 * Budget baseline console for converting approved estimates into budgets
 * and inspecting budget-line breakdowns. Scoped to a single project and
 * provides the estimate-to-budget conversion workflow.
 */

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { parseAmount, formatCurrency } from "@/shared/money-format";
import { useEffect, useState } from "react";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import { ApiResponse, BudgetRecord, EstimateRecord, ProjectRecord } from "../types";
import styles from "./budgets-console.module.css";

type BudgetsConsoleProps = {
  scopedProjectId: string;
};

/** Budget baseline workspace: estimate conversion, budget selection, and line-level inspection. */
export function BudgetsConsole({ scopedProjectId }: BudgetsConsoleProps) {
  const { token } = useSharedSessionAuth();
  const [statusMessage, setStatusMessage] = useState("");
  const [convertErrorMessage, setConvertErrorMessage] = useState("");

  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [estimates, setEstimates] = useState<EstimateRecord[]>([]);
  const [selectedEstimateId, setSelectedEstimateId] = useState("");

  const [budgets, setBudgets] = useState<BudgetRecord[]>([]);
  const [selectedBudgetId, setSelectedBudgetId] = useState("");

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const projectId = Number(scopedProjectId);
  const approvedEstimates = estimates.filter((estimate) => estimate.status === "approved");
  const budgetSourceEstimateIds = new Set(budgets.map((budget) => budget.source_estimate));
  const conversionCandidates = approvedEstimates.filter(
    (estimate) => !budgetSourceEstimateIds.has(estimate.id),
  );
  const selectedEstimate = estimates.find(
    (estimate) => String(estimate.id) === selectedEstimateId,
  );
  const selectedEstimateCandidate = conversionCandidates.find(
    (estimate) => String(estimate.id) === selectedEstimateId,
  );
  const selectedBudget = budgets.find((budget) => String(budget.id) === selectedBudgetId);
  const selectedBudgetTotals = selectedBudget
    ? selectedBudget.line_items.reduce(
        (totals, line) => {
          totals.budget += parseAmount(line.budget_amount);
          totals.committed += parseAmount(line.committed_amount);
          totals.actual += parseAmount(line.actual_amount);
          return totals;
        },
        { budget: 0, committed: 0, actual: 0 },
      )
    : null;
  const selectedBudgetVariance = selectedBudgetTotals
    ? selectedBudgetTotals.budget - selectedBudgetTotals.actual
    : 0;

  /** Map internal budget status values to user-facing labels. */
  function formatBudgetStatus(status: string): string {
    if (status === "superseded") {
      return "voided";
    }
    return status;
  }

  /** Ensure the scoped project is loaded into local state, fetching if needed. */
  async function ensureScopedProjectLoaded() {
    if (project?.id === projectId) {
      return true;
    }
    if (!token) {
      setStatusMessage("No shared session found. Go to / and login first.");
      return false;
    }

    setStatusMessage("Loading project...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setProject(null);
        setStatusMessage("Could not load project.");
        return false;
      }

      setProject(payload.data as ProjectRecord);
      setEstimates([]);
      setBudgets([]);
      setSelectedEstimateId("");
      setSelectedBudgetId("");
      setStatusMessage(`Loaded project #${projectId}.`);
      return true;
    } catch {
      setProject(null);
      setStatusMessage("Could not reach project endpoint.");
      return false;
    }
  }

  /** Load approved estimates and existing budgets to determine conversion candidates. */
  async function loadConversionCandidates() {
    const scopedReady = await ensureScopedProjectLoaded();
    if (!scopedReady) {
      return;
    }

    setStatusMessage("Loading estimates and budgets...");
    try {
      const [estimatesResponse, budgetsResponse] = await Promise.all([
        fetch(`${normalizedBaseUrl}/projects/${projectId}/estimates/`, {
          headers: buildAuthHeaders(token),
        }),
        fetch(`${normalizedBaseUrl}/projects/${projectId}/budgets/`, {
          headers: buildAuthHeaders(token),
        }),
      ]);
      const estimatesPayload: ApiResponse = await estimatesResponse.json();
      const budgetsPayload: ApiResponse = await budgetsResponse.json();

      if (!estimatesResponse.ok || !budgetsResponse.ok) {
        setStatusMessage("Could not load conversion candidates.");
        return;
      }

      const estimateRows = (estimatesPayload.data as EstimateRecord[]) ?? [];
      const budgetRows = (budgetsPayload.data as BudgetRecord[]) ?? [];
      setEstimates(estimateRows);
      setBudgets(budgetRows);
      if (budgetRows[0]) {
        setSelectedBudgetId(String(budgetRows[0].id));
      } else {
        setSelectedBudgetId("");
      }

      const sourceEstimateIds = new Set(budgetRows.map((budget) => budget.source_estimate));
      const approved = estimateRows.filter((estimate) => estimate.status === "approved");
      const candidates = approved.filter((estimate) => !sourceEstimateIds.has(estimate.id));
      if (candidates[0]) {
        setSelectedEstimateId(String(candidates[0].id));
      } else {
        setSelectedEstimateId("");
      }

      setStatusMessage(
        `Loaded ${approved.length} approved estimate(s); ${candidates.length} available for conversion.`,
      );
    } catch {
      setStatusMessage("Could not reach conversion-candidate endpoints.");
    }
  }

  // Kick off the initial data load once auth is available.
  useEffect(() => {
    if (!token) {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadConversionCandidates();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, scopedProjectId]);

  /** Convert the selected approved estimate into a budget record. */
  async function handleConvertToBudget() {
    if (conversionCandidates.length === 0) {
      if (approvedEstimates.length === 0) {
        setConvertErrorMessage("No approved estimates are available for conversion.");
      } else {
        setConvertErrorMessage(
          "No estimates are available for conversion. All approved estimates already have budgets.",
        );
      }
      return;
    }

    if (!selectedEstimateId) {
      setConvertErrorMessage("Select an origin estimate from the conversion table first.");
      return;
    }

    const estimateId = Number(selectedEstimateId);
    if (!estimateId) {
      setConvertErrorMessage("Select an origin estimate from the conversion table first.");
      return;
    }
    if (!selectedEstimateCandidate) {
      setConvertErrorMessage("Selected estimate is not available for conversion.");
      return;
    }
    if (selectedEstimate?.status !== "approved") {
      setConvertErrorMessage("Selected estimate must be approved before conversion.");
      return;
    }

    setConvertErrorMessage("");
    setStatusMessage("Converting estimate to budget...");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/estimates/${estimateId}/convert-to-budget/`,
        {
          method: "POST",
          headers: buildAuthHeaders(token, { contentType: "application/json" }),
          body: JSON.stringify({}),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        const message = payload.error?.message ?? "Estimate conversion failed.";
        setStatusMessage(message);
        return;
      }
      const conversionStatus = payload.meta?.conversion_status ?? "converted";
      await loadConversionCandidates();
      setStatusMessage(`Estimate conversion ${conversionStatus}.`);
    } catch {
      setStatusMessage("Could not reach estimate conversion endpoint.");
    }
  }

  /** Update the selected budget for line-level inspection. */
  function handleBudgetSelection(budgetId: string) {
    setSelectedBudgetId(budgetId);
  }

  return (
    <section className={styles.console}>
      <h2>Budget Baseline Console</h2>
      <p>Convert approved estimates to budgets and edit working budget lines.</p>

      {project ? (
        <p>
          Scoped project: #{project.id} - {project.name} ({project.customer_display_name})
        </p>
      ) : null}

      {conversionCandidates.length > 0 ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Estimate</th>
              <th>Version</th>
              <th>Title</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {conversionCandidates.map((estimate) => {
              const isSelected = String(estimate.id) === selectedEstimateId;
              return (
                <tr key={estimate.id}>
                  <td>#{estimate.id}</td>
                  <td>v{estimate.version}</td>
                  <td>{estimate.title}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => setSelectedEstimateId(String(estimate.id))}
                      disabled={isSelected}
                    >
                      {isSelected ? "Selected" : "Select"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
      {estimates.length > 0 && approvedEstimates.length === 0 ? (
        <p>No approved estimates for this project yet. Approve one in Estimates before conversion.</p>
      ) : null}
      {approvedEstimates.length > 0 && conversionCandidates.length === 0 ? (
        <p>All approved estimates already have a budget conversion.</p>
      ) : null}

      <button
        type="button"
        className={styles.inlineButton}
        onClick={handleConvertToBudget}
        disabled={!token}
      >
        Convert Selected Approved Estimate to Budget
      </button>
      {convertErrorMessage ? <p className={styles.actionError}>{convertErrorMessage}</p> : null}

      {budgets.length > 0 ? (
        <label className={styles.fieldLabel}>
          Budget
          <select
            className={styles.select}
            value={selectedBudgetId}
            onChange={(event) => handleBudgetSelection(event.target.value)}
          >
            {budgets.map((budget) => (
              <option key={budget.id} value={budget.id}>
                #{budget.id} ({formatBudgetStatus(budget.status)}) from estimate #
                {budget.source_estimate} v
                {budget.source_estimate_version}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {selectedBudget ? (
        <>
          <div className={styles.summaryGrid}>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Budget Total</span>
              <span className={styles.metricValue}>{formatCurrency(selectedBudgetTotals?.budget ?? 0)}</span>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Committed Total</span>
              <span className={styles.metricValue}>{formatCurrency(selectedBudgetTotals?.committed ?? 0)}</span>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Actual Total</span>
              <span className={styles.metricValue}>{formatCurrency(selectedBudgetTotals?.actual ?? 0)}</span>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Variance</span>
              <span
                className={`${styles.metricValue} ${
                  selectedBudgetVariance < 0 ? styles.negative : styles.positive
                }`}
              >
                {formatCurrency(selectedBudgetVariance)}
              </span>
            </div>
          </div>

          <h3>Budget Lines</h3>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Line</th>
                <th>Cost Code</th>
                <th>Description</th>
                <th>Budget</th>
                <th>Committed</th>
                <th>Actual</th>
                <th>Variance</th>
              </tr>
            </thead>
            <tbody>
              {selectedBudget.line_items.map((line) => {
                const budgetAmount = parseAmount(line.budget_amount);
                const committedAmount = parseAmount(line.committed_amount);
                const actualAmount = parseAmount(line.actual_amount);
                const variance = budgetAmount - actualAmount;
                return (
                  <tr key={line.id}>
                    <td>#{line.id}</td>
                    <td>{line.cost_code_code}</td>
                    <td>{line.description}</td>
                    <td>{formatCurrency(budgetAmount)}</td>
                    <td>{formatCurrency(committedAmount)}</td>
                    <td>{formatCurrency(actualAmount)}</td>
                    <td className={variance < 0 ? styles.negative : styles.positive}>
                      {formatCurrency(variance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : null}

      <p>{statusMessage}</p>
    </section>
  );
}
