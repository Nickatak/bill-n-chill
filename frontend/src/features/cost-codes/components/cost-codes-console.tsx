"use client";

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import { ApiResponse, CostCode, CsvImportResult } from "../types";

export function CostCodesConsole() {
  const { token, authMessage } = useSharedSessionAuth();

  const [rows, setRows] = useState<CostCode[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState("");

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [importCsvText, setImportCsvText] = useState("code,name,is_active\n");
  const [importResult, setImportResult] = useState<CsvImportResult | null>(null);

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);

  function hydrate(item: CostCode) {
    setCode(item.code);
    setName(item.name);
    setIsActive(item.is_active);
  }

  const loadCostCodes = useCallback(async () => {
    setStatusMessage("Loading cost codes...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/cost-codes/`, {
        headers: buildAuthHeaders(token),
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
  }, [normalizedBaseUrl, token]);

  useEffect(() => {
    if (!token) {
      return;
    }
    const run = window.setTimeout(() => {
      void loadCostCodes();
    }, 0);
    return () => window.clearTimeout(run);
  }, [loadCostCodes, token]);

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
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
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
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
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

  async function runCsvImport(dryRun: boolean) {
    setStatusMessage(dryRun ? "Previewing CSV import..." : "Applying CSV import...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/cost-codes/import-csv/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({ csv_text: importCsvText, dry_run: dryRun }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "CSV import failed.");
        return;
      }
      const result = payload.data as CsvImportResult;
      setImportResult(result);
      setStatusMessage(
        `${dryRun ? "Previewed" : "Applied"} ${result.total_rows} row(s): create ${result.created_count}, update ${result.updated_count}, errors ${result.error_count}.`,
      );
      if (!dryRun) {
        await loadCostCodes();
      }
    } catch {
      setStatusMessage("Could not reach cost code CSV import endpoint.");
    }
  }

  return (
    <section>
      <h2>Cost Code Management</h2>
      <p>Create, update, and deactivate cost codes.</p>

      <p>{authMessage}</p>

      <button type="button" onClick={loadCostCodes}>
        Reload Cost Codes
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

      <section>
        <h3>CSV Import</h3>
        <p>Headers: code,name,is_active. Existing rows update by code; unknown rows create.</p>
        <label>
          CSV text
          <textarea
            value={importCsvText}
            onChange={(event) => setImportCsvText(event.target.value)}
            rows={8}
          />
        </label>
        <button type="button" onClick={() => runCsvImport(true)}>
          Preview Import
        </button>
        <button type="button" onClick={() => runCsvImport(false)}>
          Apply Import
        </button>
        {importResult ? (
          <label>
            Import result
            <textarea
              readOnly
              rows={Math.min(10, importResult.rows.length + 2)}
              value={importResult.rows
                .map(
                  (row) =>
                    `row ${row.row_number} | ${row.status} | code=${row.code || ""} name=${row.name || ""} | ${row.message}`,
                )
                .join("\n")}
            />
          </label>
        ) : null}
      </section>

      <p>{statusMessage}</p>
    </section>
  );
}
