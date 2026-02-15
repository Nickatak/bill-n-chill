"use client";

import { FormEvent, useMemo, useState } from "react";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { ApiResponse, ChangeOrderRecord, ProjectRecord, UserData } from "../types";

export function ChangeOrdersConsole() {
  const [apiBaseUrl, setApiBaseUrl] = useState(defaultApiBaseUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [changeOrders, setChangeOrders] = useState<ChangeOrderRecord[]>([]);
  const [selectedChangeOrderId, setSelectedChangeOrderId] = useState("");

  const [newTitle, setNewTitle] = useState("Owner requested scope change");
  const [newAmountDelta, setNewAmountDelta] = useState("0.00");
  const [newDaysDelta, setNewDaysDelta] = useState("0");
  const [newReason, setNewReason] = useState("");

  const [editTitle, setEditTitle] = useState("");
  const [editAmountDelta, setEditAmountDelta] = useState("0.00");
  const [editDaysDelta, setEditDaysDelta] = useState("0");
  const [editReason, setEditReason] = useState("");
  const [editStatus, setEditStatus] = useState("draft");

  const normalizedBaseUrl = useMemo(() => normalizeApiBaseUrl(apiBaseUrl), [apiBaseUrl]);

  function hydrateEditForm(changeOrder: ChangeOrderRecord | undefined) {
    if (!changeOrder) {
      setSelectedChangeOrderId("");
      setEditTitle("");
      setEditAmountDelta("0.00");
      setEditDaysDelta("0");
      setEditReason("");
      setEditStatus("draft");
      return;
    }

    setSelectedChangeOrderId(String(changeOrder.id));
    setEditTitle(changeOrder.title);
    setEditAmountDelta(changeOrder.amount_delta);
    setEditDaysDelta(String(changeOrder.days_delta));
    setEditReason(changeOrder.reason);
    setEditStatus(changeOrder.status);
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
      setChangeOrders([]);
      hydrateEditForm(undefined);
      setStatusMessage(`Loaded ${rows.length} project(s).`);
    } catch {
      setStatusMessage("Could not reach projects endpoint.");
    }
  }

  function handleProjectSelect(projectId: string) {
    setSelectedProjectId(projectId);
    setChangeOrders([]);
    hydrateEditForm(undefined);
  }

  async function fetchProjectChangeOrders(projectId: number) {
    const response = await fetch(
      `${normalizedBaseUrl}/projects/${projectId}/change-orders/`,
      {
        headers: { Authorization: `Token ${token}` },
      },
    );
    const payload: ApiResponse = await response.json();
    if (!response.ok) {
      return { rows: null as ChangeOrderRecord[] | null, error: "Could not load change orders." };
    }
    return { rows: (payload.data as ChangeOrderRecord[]) ?? [], error: "" };
  }

  async function loadChangeOrders() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    setStatusMessage("Loading change orders...");
    try {
      const { rows, error } = await fetchProjectChangeOrders(projectId);
      if (!rows) {
        setStatusMessage(error);
        return;
      }

      setChangeOrders(rows);
      hydrateEditForm(rows[0]);
      setStatusMessage(`Loaded ${rows.length} change order(s).`);
    } catch {
      setStatusMessage("Could not reach change order endpoint.");
    }
  }

  async function handleCreateChangeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    setStatusMessage("Creating change order...");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/projects/${projectId}/change-orders/`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Token ${token}`,
          },
          body: JSON.stringify({
            title: newTitle,
            amount_delta: newAmountDelta,
            days_delta: Number(newDaysDelta),
            reason: newReason,
          }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Create change order failed.");
        return;
      }
      const created = payload.data as ChangeOrderRecord;

      const { rows } = await fetchProjectChangeOrders(projectId);
      if (rows) {
        setChangeOrders(rows);
        const persisted = rows.find((row) => row.id === created.id);
        hydrateEditForm(persisted ?? created);
      } else {
        setChangeOrders((current) => [created, ...current]);
        hydrateEditForm(created);
      }
      setStatusMessage(`Created change order CO-${created.number} (${created.status}).`);
    } catch {
      setStatusMessage("Could not reach change order create endpoint.");
    }
  }

  async function handleUpdateChangeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const changeOrderId = Number(selectedChangeOrderId);
    if (!changeOrderId) {
      setStatusMessage("Select a change order first.");
      return;
    }

    setStatusMessage("Saving change order...");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/change-orders/${changeOrderId}/`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Token ${token}`,
          },
          body: JSON.stringify({
            title: editTitle,
            amount_delta: editAmountDelta,
            days_delta: Number(editDaysDelta),
            reason: editReason,
            status: editStatus,
          }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Save change order failed.");
        return;
      }
      const updated = payload.data as ChangeOrderRecord;
      const projectId = Number(selectedProjectId);
      const { rows } = await fetchProjectChangeOrders(projectId);
      if (rows) {
        setChangeOrders(rows);
        const persisted = rows.find((row) => row.id === updated.id);
        hydrateEditForm(persisted ?? updated);
        const persistedStatus = persisted?.status ?? updated.status;
        setStatusMessage(
          `Saved change order CO-${updated.number}. Persisted status: ${persistedStatus}.`,
        );
      } else {
        setChangeOrders((current) =>
          current.map((row) => (row.id === updated.id ? updated : row)),
        );
        hydrateEditForm(updated);
        setStatusMessage(`Saved change order CO-${updated.number} (${updated.status}).`);
      }
    } catch {
      setStatusMessage("Could not reach change order detail endpoint.");
    }
  }

  return (
    <section>
      <h2>Change Orders</h2>
      <p>Create and route project change orders through approval states.</p>

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
            onChange={(event) => handleProjectSelect(event.target.value)}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                #{project.id} - {project.name} ({project.customer_display_name})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <button type="button" onClick={loadChangeOrders} disabled={!selectedProjectId}>
        Load Change Orders for Selected Project
      </button>

      <form onSubmit={handleCreateChangeOrder}>
        <h3>Create Change Order</h3>
        <label>
          Title
          <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} required />
        </label>
        <label>
          Amount delta
          <input
            value={newAmountDelta}
            onChange={(event) => setNewAmountDelta(event.target.value)}
            inputMode="decimal"
            required
          />
        </label>
        <label>
          Days delta
          <input
            value={newDaysDelta}
            onChange={(event) => setNewDaysDelta(event.target.value)}
            inputMode="numeric"
            required
          />
        </label>
        <label>
          Reason
          <textarea value={newReason} onChange={(event) => setNewReason(event.target.value)} rows={3} />
        </label>
        <button type="submit" disabled={!selectedProjectId}>
          Create Change Order
        </button>
      </form>

      {changeOrders.length > 0 ? (
        <label>
          Change order
          <select
            value={selectedChangeOrderId}
            onChange={(event) =>
              hydrateEditForm(
                changeOrders.find((row) => String(row.id) === event.target.value),
              )
            }
          >
            {changeOrders.map((changeOrder) => (
              <option key={changeOrder.id} value={changeOrder.id}>
                CO-{changeOrder.number} {changeOrder.title} ({changeOrder.status})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <form onSubmit={handleUpdateChangeOrder}>
        <h3>Edit Change Order</h3>
        <label>
          Title
          <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} required />
        </label>
        <label>
          Amount delta
          <input
            value={editAmountDelta}
            onChange={(event) => setEditAmountDelta(event.target.value)}
            inputMode="decimal"
            required
          />
        </label>
        <label>
          Days delta
          <input
            value={editDaysDelta}
            onChange={(event) => setEditDaysDelta(event.target.value)}
            inputMode="numeric"
            required
          />
        </label>
        <label>
          Reason
          <textarea value={editReason} onChange={(event) => setEditReason(event.target.value)} rows={3} />
        </label>
        <label>
          Status
          <select value={editStatus} onChange={(event) => setEditStatus(event.target.value)}>
            <option value="draft">draft</option>
            <option value="pending_approval">pending_approval</option>
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
            <option value="void">void</option>
          </select>
        </label>
        <button type="submit" disabled={!selectedChangeOrderId}>
          Save Change Order
        </button>
      </form>

      <p>{statusMessage}</p>
    </section>
  );
}
