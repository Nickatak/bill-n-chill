"use client";

import { FormEvent, useMemo, useState } from "react";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import {
  ApiResponse,
  CostCode,
  EstimateLineInput,
  EstimateRecord,
  EstimateStatusEventRecord,
  ProjectRecord,
  UserData,
} from "../types";

function emptyLine(localId: number, defaultCostCodeId = ""): EstimateLineInput {
  return {
    localId,
    costCodeId: defaultCostCodeId,
    description: "Scope item",
    quantity: "1",
    unit: "ea",
    unitCost: "0",
    markupPercent: "0",
  };
}

export function EstimatesConsole() {
  const [apiBaseUrl, setApiBaseUrl] = useState(defaultApiBaseUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);

  const [estimates, setEstimates] = useState<EstimateRecord[]>([]);
  const [selectedEstimateId, setSelectedEstimateId] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("draft");
  const [statusNote, setStatusNote] = useState("");
  const [statusEvents, setStatusEvents] = useState<EstimateStatusEventRecord[]>([]);

  const [estimateTitle, setEstimateTitle] = useState("Initial Estimate");
  const [taxPercent, setTaxPercent] = useState("0");
  const [lineItems, setLineItems] = useState<EstimateLineInput[]>([emptyLine(1)]);
  const [nextLineId, setNextLineId] = useState(2);

  const normalizedBaseUrl = useMemo(() => normalizeApiBaseUrl(apiBaseUrl), [apiBaseUrl]);

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

  async function loadDependencies() {
    setStatusMessage("Loading projects and cost codes...");
    try {
      const [projectsRes, codesRes] = await Promise.all([
        fetch(`${normalizedBaseUrl}/projects/`, {
          headers: { Authorization: `Token ${token}` },
        }),
        fetch(`${normalizedBaseUrl}/cost-codes/`, {
          headers: { Authorization: `Token ${token}` },
        }),
      ]);

      const projectsJson: ApiResponse = await projectsRes.json();
      const codesJson: ApiResponse = await codesRes.json();

      if (!projectsRes.ok || !codesRes.ok) {
        setStatusMessage("Failed loading dependencies.");
        return;
      }

      const projectRows = (projectsJson.data as ProjectRecord[]) ?? [];
      const codeRows = ((codesJson.data as CostCode[]) ?? []).filter((code) => code.is_active);
      setProjects(projectRows);
      setCostCodes(codeRows);

      if (projectRows[0]) setSelectedProjectId(String(projectRows[0].id));

      if (codeRows[0]) {
        const defaultCostCodeId = String(codeRows[0].id);
        setLineItems((current) =>
          current.map((line) =>
            line.costCodeId ? line : { ...line, costCodeId: defaultCostCodeId },
          ),
        );
      }

      setStatusMessage(
        `Loaded ${projectRows.length} project(s) and ${codeRows.length} cost code(s).`,
      );
    } catch {
      setStatusMessage("Could not reach dependency endpoints.");
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
        setStatusMessage("Failed loading estimates.");
        return;
      }
      const rows = (payload.data as EstimateRecord[]) ?? [];
      setEstimates(rows);
      if (rows[0]) {
        setSelectedEstimateId(String(rows[0].id));
        setSelectedStatus(rows[0].status);
      }
      setStatusMessage(`Loaded ${rows.length} estimate version(s).`);
    } catch {
      setStatusMessage("Could not reach estimate endpoint.");
    }
  }

  function addLineItem() {
    const defaultCostCodeId = costCodes[0] ? String(costCodes[0].id) : "";
    setLineItems((current) => [...current, emptyLine(nextLineId, defaultCostCodeId)]);
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

  function updateLineItem(localId: number, key: keyof Omit<EstimateLineInput, "localId">, value: string) {
    setLineItems((current) =>
      current.map((line) => (line.localId === localId ? { ...line, [key]: value } : line)),
    );
  }

  async function handleCreateEstimate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    const hasMissingCostCode = lineItems.some((line) => !line.costCodeId);
    if (hasMissingCostCode) {
      setStatusMessage("Every line item must have a cost code.");
      return;
    }

    setStatusMessage("Creating estimate...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/estimates/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          title: estimateTitle,
          tax_percent: taxPercent,
          line_items: lineItems.map((line) => ({
            cost_code: Number(line.costCodeId),
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            unit_cost: line.unitCost,
            markup_percent: line.markupPercent,
          })),
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Create estimate failed.");
        return;
      }
      const created = payload.data as EstimateRecord;
      setEstimates((current) => [created, ...current]);
      setSelectedEstimateId(String(created.id));
      setSelectedStatus(created.status);
      setStatusEvents([]);
      setStatusMessage(`Created estimate #${created.id} v${created.version}.`);
    } catch {
      setStatusMessage("Could not reach estimate create endpoint.");
    }
  }

  async function handleCloneEstimate() {
    const estimateId = Number(selectedEstimateId);
    if (!estimateId) {
      setStatusMessage("Select an estimate first.");
      return;
    }

    setStatusMessage("Cloning estimate version...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/estimates/${estimateId}/clone-version/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({}),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Clone failed.");
        return;
      }
      const cloned = payload.data as EstimateRecord;
      setEstimates((current) => [cloned, ...current]);
      setSelectedEstimateId(String(cloned.id));
      setSelectedStatus(cloned.status);
      setStatusEvents([]);
      setStatusMessage(`Cloned estimate to version ${cloned.version}.`);
    } catch {
      setStatusMessage("Could not reach clone endpoint.");
    }
  }

  async function handleUpdateEstimateStatus() {
    const estimateId = Number(selectedEstimateId);
    if (!estimateId) {
      setStatusMessage("Select an estimate first.");
      return;
    }

    setStatusMessage("Updating estimate status...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/estimates/${estimateId}/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({ status: selectedStatus, status_note: statusNote }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Status update failed.");
        return;
      }
      const updated = payload.data as EstimateRecord;
      setEstimates((current) =>
        current.map((estimate) => (estimate.id === updated.id ? updated : estimate)),
      );
      setStatusNote("");
      setStatusMessage(`Updated estimate #${updated.id} to ${updated.status}.`);
    } catch {
      setStatusMessage("Could not reach estimate status endpoint.");
    }
  }

  async function loadStatusEvents() {
    const estimateId = Number(selectedEstimateId);
    if (!estimateId) {
      setStatusMessage("Select an estimate first.");
      return;
    }

    setStatusMessage("Loading status events...");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/estimates/${estimateId}/status-events/`,
        {
          headers: { Authorization: `Token ${token}` },
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Failed loading status events.");
        return;
      }
      const rows = (payload.data as EstimateStatusEventRecord[]) ?? [];
      setStatusEvents(rows);
      setStatusMessage(`Loaded ${rows.length} status event(s).`);
    } catch {
      setStatusMessage("Could not reach status events endpoint.");
    }
  }

  return (
    <section>
      <h2>Estimate Authoring and Versioning</h2>
      <p>Create draft estimates and clone new versions for revision history.</p>

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

      <button type="button" onClick={loadDependencies}>
        Load Projects + Cost Codes
      </button>

      {projects.length > 0 ? (
        <label>
          Project
          <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                #{project.id} - {project.name} ({project.customer_display_name})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <form onSubmit={handleCreateEstimate}>
        <h3>Create Estimate Version</h3>
        <label>
          Estimate title
          <input value={estimateTitle} onChange={(event) => setEstimateTitle(event.target.value)} required />
        </label>
        <label>
          Tax %
          <input value={taxPercent} onChange={(event) => setTaxPercent(event.target.value)} inputMode="decimal" required />
        </label>

        <h3>Line Items</h3>
        {lineItems.map((line, index) => (
          <div key={line.localId}>
            <p>Line {index + 1}</p>
            <label>
              Cost code
              <select
                value={line.costCodeId}
                onChange={(event) => updateLineItem(line.localId, "costCodeId", event.target.value)}
                required
              >
                <option value="">Select cost code</option>
                {costCodes.map((code) => (
                  <option key={code.id} value={code.id}>
                    {code.code} - {code.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Description
              <input
                value={line.description}
                onChange={(event) => updateLineItem(line.localId, "description", event.target.value)}
                required
              />
            </label>
            <label>
              Quantity
              <input
                value={line.quantity}
                onChange={(event) => updateLineItem(line.localId, "quantity", event.target.value)}
                inputMode="decimal"
                required
              />
            </label>
            <label>
              Unit
              <input
                value={line.unit}
                onChange={(event) => updateLineItem(line.localId, "unit", event.target.value)}
                required
              />
            </label>
            <label>
              Unit cost
              <input
                value={line.unitCost}
                onChange={(event) => updateLineItem(line.localId, "unitCost", event.target.value)}
                inputMode="decimal"
                required
              />
            </label>
            <label>
              Markup %
              <input
                value={line.markupPercent}
                onChange={(event) => updateLineItem(line.localId, "markupPercent", event.target.value)}
                inputMode="decimal"
                required
              />
            </label>
            <button type="button" onClick={() => removeLineItem(line.localId)}>
              Remove Line
            </button>
          </div>
        ))}

        <button type="button" onClick={addLineItem}>
          Add Line Item
        </button>
        <button type="submit">Create Estimate</button>
      </form>

      <button type="button" onClick={loadEstimates}>
        Load Estimates for Selected Project
      </button>

      {estimates.length > 0 ? (
        <label>
          Estimate version
          <select
            value={selectedEstimateId}
            onChange={(event) => {
              const nextId = event.target.value;
              setSelectedEstimateId(nextId);
              const selected = estimates.find((estimate) => String(estimate.id) === nextId);
              if (selected) setSelectedStatus(selected.status);
              setStatusEvents([]);
            }}
          >
            {estimates.map((estimate) => (
              <option key={estimate.id} value={estimate.id}>
                #{estimate.id} v{estimate.version} - {estimate.title} ({estimate.status})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <button type="button" onClick={handleCloneEstimate} disabled={!selectedEstimateId}>
        Clone Selected Estimate Version
      </button>

      <h3>Estimate Status Lifecycle</h3>
      <label>
        Next status
        <select value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value)}>
          <option value="draft">draft</option>
          <option value="sent">sent</option>
          <option value="approved">approved</option>
          <option value="rejected">rejected</option>
          <option value="archived">archived</option>
        </select>
      </label>
      <label>
        Status note
        <input
          value={statusNote}
          onChange={(event) => setStatusNote(event.target.value)}
          placeholder="Optional note for this transition"
        />
      </label>
      <button type="button" onClick={handleUpdateEstimateStatus} disabled={!selectedEstimateId}>
        Update Selected Estimate Status
      </button>
      <button type="button" onClick={loadStatusEvents} disabled={!selectedEstimateId}>
        Load Status Events
      </button>

      {statusEvents.length > 0 ? (
        <div>
          <h4>Status Events</h4>
          <ul>
            {statusEvents.map((event) => (
              <li key={event.id}>
                {event.from_status ?? "none"} -&gt; {event.to_status} by {event.changed_by_email} at{" "}
                {new Date(event.changed_at).toLocaleString()}
                {event.note ? ` (${event.note})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p>{statusMessage}</p>
    </section>
  );
}
