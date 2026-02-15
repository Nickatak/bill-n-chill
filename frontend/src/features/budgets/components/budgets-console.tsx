"use client";

import { FormEvent, useMemo, useState } from "react";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { ApiResponse, BudgetLineRecord, BudgetRecord, EstimateRecord, ProjectRecord, UserData } from "../types";

export function BudgetsConsole() {
  const [apiBaseUrl, setApiBaseUrl] = useState(defaultApiBaseUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [estimates, setEstimates] = useState<EstimateRecord[]>([]);
  const [selectedEstimateId, setSelectedEstimateId] = useState("");

  const [budgets, setBudgets] = useState<BudgetRecord[]>([]);
  const [selectedBudgetId, setSelectedBudgetId] = useState("");
  const [selectedLineId, setSelectedLineId] = useState("");
  const [lineDescription, setLineDescription] = useState("");
  const [lineBudgetAmount, setLineBudgetAmount] = useState("");

  const normalizedBaseUrl = useMemo(() => normalizeApiBaseUrl(apiBaseUrl), [apiBaseUrl]);

  const selectedEstimate = estimates.find(
    (estimate) => String(estimate.id) === selectedEstimateId,
  );
  const selectedBudget = budgets.find((budget) => String(budget.id) === selectedBudgetId);
  const selectedBudgetLine = selectedBudget?.line_items.find(
    (line) => String(line.id) === selectedLineId,
  );

  function hydrateLineForm(line: BudgetLineRecord | undefined) {
    if (!line) {
      setSelectedLineId("");
      setLineDescription("");
      setLineBudgetAmount("");
      return;
    }
    setSelectedLineId(String(line.id));
    setLineDescription(line.description);
    setLineBudgetAmount(line.budget_amount);
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthMessage("Logging in...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/auth/login/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload: ApiResponse = await response.json();
      const user = payload.data as UserData;
      if (!response.ok || !user?.token) {
        setAuthMessage("Login failed.");
        return;
      }
      setToken(user.token);
      setAuthMessage(`Logged in as ${user.email ?? email}.`);
    } catch {
      setAuthMessage("Could not reach login endpoint.");
    }
  }

  async function loadProjects() {
    setStatusMessage("Loading projects...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/`, {
        headers: { Authorization: `Token ${token}` },
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Could not load projects.");
        return;
      }
      const rows = (payload.data as ProjectRecord[]) ?? [];
      setProjects(rows);
      if (rows[0]) {
        setSelectedProjectId(String(rows[0].id));
      } else {
        setSelectedProjectId("");
      }
      setEstimates([]);
      setBudgets([]);
      setSelectedEstimateId("");
      setSelectedBudgetId("");
      hydrateLineForm(undefined);
      setStatusMessage(`Loaded ${rows.length} project(s).`);
    } catch {
      setStatusMessage("Could not reach projects endpoint.");
    }
  }

  async function loadEstimates() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    setStatusMessage("Loading estimates...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/estimates/`, {
        headers: { Authorization: `Token ${token}` },
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Could not load estimates.");
        return;
      }
      const rows = (payload.data as EstimateRecord[]) ?? [];
      setEstimates(rows);
      if (rows[0]) {
        setSelectedEstimateId(String(rows[0].id));
      } else {
        setSelectedEstimateId("");
      }
      setStatusMessage(`Loaded ${rows.length} estimate version(s).`);
    } catch {
      setStatusMessage("Could not reach estimates endpoint.");
    }
  }

  async function loadBudgets() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    setStatusMessage("Loading budgets...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/budgets/`, {
        headers: { Authorization: `Token ${token}` },
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Could not load budgets.");
        return;
      }
      const rows = (payload.data as BudgetRecord[]) ?? [];
      setBudgets(rows);
      if (rows[0]) {
        setSelectedBudgetId(String(rows[0].id));
        hydrateLineForm(rows[0].line_items[0]);
      } else {
        setSelectedBudgetId("");
        hydrateLineForm(undefined);
      }
      setStatusMessage(`Loaded ${rows.length} budget(s).`);
    } catch {
      setStatusMessage("Could not reach budgets endpoint.");
    }
  }

  async function handleConvertToBudget() {
    const estimateId = Number(selectedEstimateId);
    if (!estimateId) {
      setStatusMessage("Select an estimate first.");
      return;
    }
    if (selectedEstimate?.status !== "approved") {
      setStatusMessage("Selected estimate must be approved before conversion.");
      return;
    }

    setStatusMessage("Converting estimate to budget...");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/estimates/${estimateId}/convert-to-budget/`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Token ${token}`,
          },
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
      await loadBudgets();
      setStatusMessage(`Estimate conversion ${conversionStatus}.`);
    } catch {
      setStatusMessage("Could not reach estimate conversion endpoint.");
    }
  }

  function handleProjectSelection(projectId: string) {
    setSelectedProjectId(projectId);
    setEstimates([]);
    setBudgets([]);
    setSelectedEstimateId("");
    setSelectedBudgetId("");
    hydrateLineForm(undefined);
  }

  function handleBudgetSelection(budgetId: string) {
    setSelectedBudgetId(budgetId);
    const budget = budgets.find((row) => String(row.id) === budgetId);
    hydrateLineForm(budget?.line_items[0]);
  }

  function handleLineSelection(lineId: string) {
    const line = selectedBudget?.line_items.find((row) => String(row.id) === lineId);
    hydrateLineForm(line);
  }

  async function handleSaveBudgetLine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const budgetId = Number(selectedBudgetId);
    const lineId = Number(selectedLineId);
    if (!budgetId || !lineId) {
      setStatusMessage("Select a budget line first.");
      return;
    }

    setStatusMessage("Saving budget line...");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/budgets/${budgetId}/lines/${lineId}/`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Token ${token}`,
          },
          body: JSON.stringify({
            description: lineDescription,
            budget_amount: lineBudgetAmount,
          }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        const message = payload.error?.message ?? "Budget line update failed.";
        setStatusMessage(message);
        return;
      }

      const updated = payload.data as BudgetLineRecord;
      setBudgets((current) =>
        current.map((budget) => {
          if (budget.id !== budgetId) return budget;
          return {
            ...budget,
            line_items: budget.line_items.map((line) =>
              line.id === updated.id ? updated : line,
            ),
          };
        }),
      );
      setStatusMessage(`Updated budget line #${updated.id}.`);
    } catch {
      setStatusMessage("Could not reach budget line endpoint.");
    }
  }

  return (
    <section>
      <h2>Budget Baseline Console</h2>
      <p>Convert approved estimates to budgets and edit working budget lines.</p>

      <label>
        API base URL
        <input value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} />
      </label>

      <form onSubmit={handleLogin}>
        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <button type="submit">Login</button>
      </form>

      <label>
        Auth token
        <input value={token} onChange={(event) => setToken(event.target.value)} />
      </label>
      <p>{authMessage}</p>

      <button type="button" onClick={loadProjects}>
        Load Projects
      </button>

      {projects.length > 0 ? (
        <label>
          Project
          <select
            value={selectedProjectId}
            onChange={(event) => handleProjectSelection(event.target.value)}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                #{project.id} - {project.name} ({project.customer_display_name})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <button type="button" onClick={loadEstimates} disabled={!selectedProjectId}>
        Load Estimates for Selected Project
      </button>

      {estimates.length > 0 ? (
        <label>
          Estimate version
          <select
            value={selectedEstimateId}
            onChange={(event) => setSelectedEstimateId(event.target.value)}
          >
            {estimates.map((estimate) => (
              <option key={estimate.id} value={estimate.id}>
                #{estimate.id} v{estimate.version} - {estimate.title} ({estimate.status})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <button
        type="button"
        onClick={handleConvertToBudget}
        disabled={!selectedEstimateId || selectedEstimate?.status !== "approved"}
      >
        Convert Selected Approved Estimate to Budget
      </button>

      <button type="button" onClick={loadBudgets} disabled={!selectedProjectId}>
        Load Budgets for Selected Project
      </button>

      {budgets.length > 0 ? (
        <label>
          Budget
          <select
            value={selectedBudgetId}
            onChange={(event) => handleBudgetSelection(event.target.value)}
          >
            {budgets.map((budget) => (
              <option key={budget.id} value={budget.id}>
                #{budget.id} ({budget.status}) from estimate #{budget.source_estimate} v
                {budget.source_estimate_version}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {selectedBudget ? (
        <>
          <label>
            Budget line
            <select value={selectedLineId} onChange={(event) => handleLineSelection(event.target.value)}>
              {selectedBudget.line_items.map((line) => (
                <option key={line.id} value={line.id}>
                  #{line.id} {line.cost_code_code} - {line.description}
                </option>
              ))}
            </select>
          </label>

          {selectedBudgetLine ? (
            <form onSubmit={handleSaveBudgetLine}>
              <h3>Edit Working Budget Line</h3>
              <label>
                Description
                <input
                  value={lineDescription}
                  onChange={(event) => setLineDescription(event.target.value)}
                  required
                />
              </label>
              <label>
                Budget amount
                <input
                  value={lineBudgetAmount}
                  onChange={(event) => setLineBudgetAmount(event.target.value)}
                  inputMode="decimal"
                  required
                />
              </label>
              <button type="submit">Save Budget Line</button>
            </form>
          ) : null}
        </>
      ) : null}

      <p>{statusMessage}</p>
    </section>
  );
}
