"use client";

import { buildAuthHeaders } from "@/features/session/auth-headers";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useSharedSessionAuth } from "@/features/session/use-shared-session";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { ApiResponse, BudgetRecord, ProjectRecord } from "../types";
import { formatDateTimeDisplay } from "@/shared/date-format";
import styles from "./budget-analytics-console.module.css";

type BudgetAnalyticsConsoleProps = {
  initialProjectId?: string | null;
};

function toAmount(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: string | number): string {
  const amount = typeof value === "number" ? value : toAmount(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function BudgetAnalyticsConsole({ initialProjectId }: BudgetAnalyticsConsoleProps) {
  const { token, authMessage } = useSharedSessionAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    initialProjectId && /^\d+$/.test(initialProjectId)
      ? ""
      : "Budget analytics requires a scoped project.",
  );
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [budgets, setBudgets] = useState<BudgetRecord[]>([]);
  const [selectedBudgetId, setSelectedBudgetId] = useState("");

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const projectId =
    initialProjectId && /^\d+$/.test(initialProjectId) ? Number(initialProjectId) : 0;
  const activeBudget = useMemo(
    () => budgets.find((budget) => budget.status === "active") ?? null,
    [budgets],
  );
  const selectedBudget =
    budgets.find((budget) => String(budget.id) === selectedBudgetId) ?? activeBudget ?? budgets[0] ?? null;
  const selectedLineSummary = useMemo(() => {
    if (!selectedBudget) {
      return { planned: 0, committed: 0, actual: 0, remaining: 0, variance: 0 };
    }
    const totals = selectedBudget.line_items.reduce(
      (totals, line) => {
        totals.planned += toAmount(line.planned_amount ?? line.budget_amount);
        totals.committed += toAmount(line.committed_amount);
        totals.actual += toAmount(line.actual_spend ?? line.actual_amount);
        totals.remaining += toAmount(line.remaining_amount);
        return totals;
      },
      { planned: 0, committed: 0, actual: 0, remaining: 0 },
    );
    return { ...totals, variance: totals.planned - totals.actual };
  }, [selectedBudget]);
  const spendPercent =
    selectedLineSummary.planned > 0
      ? (selectedLineSummary.actual / selectedLineSummary.planned) * 100
      : 0;
  const footerStatus = isLoading ? "Loading budget analytics..." : statusMessage;

  function varianceClass(value: number): string {
    return value < 0 ? styles.negative : styles.positive;
  }

  useEffect(() => {
    if (!token || !projectId) {
      return;
    }

    let cancelled = false;

    async function loadScopedBudgetAnalytics() {
      setIsLoading(true);
      try {
        const [projectResponse, budgetsResponse] = await Promise.all([
          fetch(`${normalizedBaseUrl}/projects/${projectId}/`, {
            headers: buildAuthHeaders(token),
          }),
          fetch(`${normalizedBaseUrl}/projects/${projectId}/budgets/`, {
            headers: buildAuthHeaders(token),
          }),
        ]);

        const projectPayload: ApiResponse = await projectResponse.json();
        const budgetsPayload: ApiResponse = await budgetsResponse.json();
        if (!projectResponse.ok) {
          if (!cancelled) {
            setProject(null);
            setBudgets([]);
            setSelectedBudgetId("");
            setStatusMessage("Could not load scoped project.");
          }
          return;
        }
        if (!budgetsResponse.ok) {
          if (!cancelled) {
            setProject(projectPayload.data as ProjectRecord);
            setBudgets([]);
            setSelectedBudgetId("");
            setStatusMessage("Could not load budget analytics.");
          }
          return;
        }
        const rows = (budgetsPayload.data as BudgetRecord[]) ?? [];
        if (!cancelled) {
          setProject(projectPayload.data as ProjectRecord);
          setBudgets(rows);
          setSelectedBudgetId((current) => {
            const currentMatch = rows.find((budget) => String(budget.id) === current);
            if (currentMatch) {
              return current;
            }
            const nextSelectedBudget =
              rows.find((budget) => budget.status === "active")?.id ?? rows[0]?.id ?? null;
            return nextSelectedBudget ? String(nextSelectedBudget) : "";
          });
          setStatusMessage("");
        }
      } catch {
        if (!cancelled) {
          setProject(null);
          setBudgets([]);
          setSelectedBudgetId("");
          setStatusMessage("Could not reach budget analytics endpoint.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadScopedBudgetAnalytics();
    return () => {
      cancelled = true;
    };
  }, [normalizedBaseUrl, projectId, token]);

  return (
    <section className={styles.console}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Budget Analytics Snapshot</h2>
          <p className={styles.subtitle}>
            Read-only budget visibility across versions, source estimate lineage, and line-level
            spend variance.
          </p>
        </div>
      </header>
      <p className={styles.authMessage}>{authMessage}</p>
      {project ? (
        <p className={styles.scope}>
          Scoped project: #{project.id} - {project.name} ({project.customer_display_name})
        </p>
      ) : null}

      {selectedBudget ? (
        <div className={styles.summaryGrid}>
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>Estimates Accepted</span>
            <strong className={styles.metricValue}>{budgets.length}</strong>
            <span className={styles.metricHint}>
              Selected: {selectedBudget ? `#${selectedBudget.id}` : "none"}
            </span>
          </article>
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>Base Working Total</span>
            <strong className={styles.metricValue}>{formatMoney(selectedBudget.base_working_total)}</strong>
            <span className={styles.metricHint}>Budget #{selectedBudget.id}</span>
          </article>
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>Current Working Total</span>
            <strong className={styles.metricValue}>{formatMoney(selectedBudget.current_working_total)}</strong>
            <span className={styles.metricHint}>Estimate #{selectedBudget.source_estimate}</span>
          </article>
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>Actual Spend</span>
            <strong className={styles.metricValue}>{formatMoney(selectedLineSummary.actual)}</strong>
            <span className={styles.metricHint}>
              {spendPercent.toFixed(1)}% of planned ({formatMoney(selectedLineSummary.planned)})
            </span>
          </article>
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>Variance</span>
            <strong className={`${styles.metricValue} ${varianceClass(selectedLineSummary.variance)}`}>
              {formatMoney(selectedLineSummary.variance)}
            </strong>
            <span className={styles.metricHint}>Remaining: {formatMoney(selectedLineSummary.remaining)}</span>
          </article>
        </div>
      ) : (
        <p className={styles.emptyState}>
          No budgets yet for this project. Approve an estimate to auto-create the first budget.
        </p>
      )}

      {budgets.length > 0 ? (
        <>
          <h3 className={styles.sectionTitle}>Budget Versions</h3>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Budget</th>
                <th>Source Estimate</th>
                <th>Base</th>
                <th>Current</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {budgets.map((budget) => (
                <tr key={budget.id}>
                  <td>#{budget.id}</td>
                  <td>
                    <Link
                      className={styles.sourceEstimateLink}
                      href={`/projects/${projectId}/estimates?estimate=${budget.source_estimate}`}
                    >
                      #{budget.source_estimate} v{budget.source_estimate_version}
                    </Link>
                  </td>
                  <td>{formatMoney(budget.base_working_total)}</td>
                  <td>{formatMoney(budget.current_working_total)}</td>
                  <td>{formatDateTimeDisplay(budget.updated_at, budget.updated_at)}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.inlineButton}
                      onClick={() => setSelectedBudgetId(String(budget.id))}
                      disabled={String(budget.id) === selectedBudgetId}
                    >
                      {String(budget.id) === selectedBudgetId ? "Selected" : "Inspect"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {selectedBudget ? (
        <>
          <h3 className={styles.sectionTitle}>Budget Line Analytics</h3>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Cost Code</th>
                <th>Description</th>
                <th>Planned</th>
                <th>Committed</th>
                <th>Actual</th>
                <th>Remaining</th>
                <th>Variance</th>
              </tr>
            </thead>
            <tbody>
              {selectedBudget.line_items.length > 0 ? (
                selectedBudget.line_items.map((line) => {
                  const planned = toAmount(line.planned_amount ?? line.budget_amount);
                  const actual = toAmount(line.actual_spend ?? line.actual_amount);
                  const variance = planned - actual;
                  return (
                    <tr key={line.id}>
                      <td>
                        {line.cost_code_code} - {line.cost_code_name}
                      </td>
                      <td>{line.description}</td>
                      <td>{formatMoney(planned)}</td>
                      <td>{formatMoney(line.committed_amount)}</td>
                      <td>{formatMoney(actual)}</td>
                      <td>{formatMoney(line.remaining_amount)}</td>
                      <td className={varianceClass(variance)}>{formatMoney(variance)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7}>No line items on this budget version yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      ) : null}

      <p className={styles.statusMessage}>{footerStatus}</p>
    </section>
  );
}
