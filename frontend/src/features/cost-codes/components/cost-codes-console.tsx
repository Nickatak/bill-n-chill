"use client";

import { FormEvent, useMemo, useState } from "react";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { ApiResponse, CostCode, UserData } from "../types";

export function CostCodesConsole() {
  const [apiBaseUrl, setApiBaseUrl] = useState(defaultApiBaseUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [authMessage, setAuthMessage] = useState("");

  const [rows, setRows] = useState<CostCode[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState("");

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");

  const normalizedBaseUrl = useMemo(() => normalizeApiBaseUrl(apiBaseUrl), [apiBaseUrl]);

  function hydrate(item: CostCode) {
    setCode(item.code);
    setName(item.name);
    setIsActive(item.is_active);
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

  async function loadCostCodes() {
    setStatusMessage("Loading cost codes...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/cost-codes/`, {
        headers: { Authorization: `Token ${token}` },
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Could not load cost codes.");
        return;
      }
      const items = (payload.data as CostCode[]) ?? [];
      setRows(items);
      if (items[0]) {
        setSelectedId(String(items[0].id));
        hydrate(items[0]);
        setStatusMessage(`Loaded ${items.length} cost code(s).`);
      } else {
        setSelectedId("");
        setStatusMessage("No cost codes found. Create one below.");
      }
    } catch {
      setStatusMessage("Could not reach cost code endpoint.");
    }
  }

  function handleSelect(id: string) {
    setSelectedId(id);
    const item = rows.find((row) => String(row.id) === id);
    if (item) hydrate(item);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage("Creating cost code...");

    try {
      const response = await fetch(`${normalizedBaseUrl}/cost-codes/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({ code: newCode, name: newName, is_active: true }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Create failed. Check values and uniqueness.");
        return;
      }
      const created = payload.data as CostCode;
      setRows((current) => [...current, created]);
      setSelectedId(String(created.id));
      hydrate(created);
      setNewCode("");
      setNewName("");
      setStatusMessage(`Created cost code #${created.id}.`);
    } catch {
      setStatusMessage("Could not reach cost code create endpoint.");
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = Number(selectedId);
    if (!id) {
      setStatusMessage("Select a cost code first.");
      return;
    }

    setStatusMessage("Saving cost code...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/cost-codes/${id}/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({ code, name, is_active: isActive }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Save failed. Check values and uniqueness.");
        return;
      }
      const updated = payload.data as CostCode;
      setRows((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      setStatusMessage(`Saved cost code #${updated.id}.`);
    } catch {
      setStatusMessage("Could not reach cost code detail endpoint.");
    }
  }

  return (
    <section>
      <h2>Cost Code Management</h2>
      <p>Create, update, and deactivate cost codes.</p>

      <label>
        API base URL
        <input value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} />
      </label>

      <form onSubmit={handleLogin}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
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

      <button type="button" onClick={loadCostCodes}>
        Load Cost Codes
      </button>

      {rows.length > 0 ? (
        <label>
          Cost code
          <select value={selectedId} onChange={(event) => handleSelect(event.target.value)}>
            {rows.map((row) => (
              <option key={row.id} value={row.id}>
                #{row.id} - {row.code} ({row.name}) {row.is_active ? "active" : "inactive"}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <form onSubmit={handleCreate}>
        <h3>Create Cost Code</h3>
        <label>
          Code
          <input value={newCode} onChange={(event) => setNewCode(event.target.value)} required />
        </label>
        <label>
          Name
          <input value={newName} onChange={(event) => setNewName(event.target.value)} required />
        </label>
        <button type="submit">Create Cost Code</button>
      </form>

      <form onSubmit={handleSave}>
        <h3>Edit Cost Code</h3>
        <label>
          Code
          <input value={code} onChange={(event) => setCode(event.target.value)} required />
        </label>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Active
          <select
            value={isActive ? "true" : "false"}
            onChange={(event) => setIsActive(event.target.value === "true")}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </label>
        <button type="submit" disabled={!selectedId}>
          Save Cost Code
        </button>
      </form>

      <p>{statusMessage}</p>
    </section>
  );
}
