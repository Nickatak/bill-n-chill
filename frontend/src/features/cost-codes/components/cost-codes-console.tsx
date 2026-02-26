"use client";

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import styles from "./cost-codes-console.module.css";
import { ApiResponse, CostCode, CsvImportResult } from "../types";

type StatusTone = "neutral" | "success" | "error";
type VisibilityFilter = "active" | "all";

export function CostCodesConsole() {
  const { token, authMessage } = useSharedSessionAuth();

  const [rows, setRows] = useState<CostCode[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");
  const [searchTerm, setSearchTerm] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("active");

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newIsActive, setNewIsActive] = useState(true);
  const [importCsvText, setImportCsvText] = useState("code,name,is_active\n");
  const [importResult, setImportResult] = useState<CsvImportResult | null>(null);
  const selectedIdRef = useRef<string>("");

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const orderedRows = useMemo(
    () => [...rows].sort((left, right) => left.code.localeCompare(right.code)),
    [rows],
  );
  const filteredRows = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return orderedRows.filter((row) => {
      if (visibilityFilter === "active" && !row.is_active) {
        return false;
      }
      if (!needle) {
        return true;
      }
      const haystack = `${row.code} ${row.name} ${row.id}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [orderedRows, searchTerm, visibilityFilter]);
  const includeArchived = visibilityFilter === "all";
  const activeRowCount = rows.filter((row) => row.is_active).length;
  const archivedRowCount = rows.length - activeRowCount;

  function hydrate(item: CostCode) {
    setCode(item.code);
    setName(item.name);
    setIsActive(item.is_active);
  }

  function setNeutralStatus(message: string) {
    setStatusTone("neutral");
    setStatusMessage(message);
  }

  function setSuccessStatus(message: string) {
    setStatusTone("success");
    setStatusMessage(message);
  }

  function setErrorStatus(message: string) {
    setStatusTone("error");
    setStatusMessage(message);
  }

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadCostCodes = useCallback(
    async (options?: { keepStatusOnSuccess?: boolean }) => {
      setNeutralStatus("Loading cost codes...");
      try {
        const response = await fetch(`${normalizedBaseUrl}/cost-codes/`, {
          headers: buildAuthHeaders(token),
        });
        const payload: ApiResponse = await response.json();
        if (!response.ok) {
          setErrorStatus(payload.error?.message ?? "Could not load cost codes.");
          return;
        }

        const items = (payload.data as CostCode[]) ?? [];
        setRows(items);

        if (!items.length) {
          setSelectedId("");
          setCode("");
          setName("");
          setIsActive(true);
          if (!options?.keepStatusOnSuccess) {
            setNeutralStatus("No cost codes found. Create one to get started.");
          }
          return;
        }

        const preferred =
          items.find((row) => String(row.id) === selectedIdRef.current) ?? items[0];
        setSelectedId(String(preferred.id));
        hydrate(preferred);
        if (!options?.keepStatusOnSuccess) {
          setStatusMessage("");
        }
      } catch {
        setErrorStatus("Could not reach cost code endpoint.");
      }
    },
    [normalizedBaseUrl, token],
  );

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
    if (item) {
      hydrate(item);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNeutralStatus("Creating cost code...");

    try {
      const response = await fetch(`${normalizedBaseUrl}/cost-codes/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          code: newCode.trim(),
          name: newName.trim(),
          is_active: newIsActive,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setErrorStatus(payload.error?.message ?? "Create failed. Check values and uniqueness.");
        return;
      }
      const created = payload.data as CostCode;
      setRows((current) => [...current, created]);
      setSelectedId(String(created.id));
      hydrate(created);
      setNewCode("");
      setNewName("");
      setNewIsActive(true);
      setSuccessStatus(`Created cost code #${created.id} (${created.code} - ${created.name}).`);
    } catch {
      setErrorStatus("Could not reach cost code create endpoint.");
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = Number(selectedId);
    if (!id) {
      setErrorStatus("Select a cost code first.");
      return;
    }

    setNeutralStatus("Saving cost code...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/cost-codes/${id}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({ code: code.trim(), name: name.trim(), is_active: isActive }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setErrorStatus(payload.error?.message ?? "Save failed. Check values and uniqueness.");
        return;
      }
      const updated = payload.data as CostCode;
      setRows((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      hydrate(updated);
      setSuccessStatus(`Saved cost code #${updated.id} (${updated.code} - ${updated.name}).`);
    } catch {
      setErrorStatus("Could not reach cost code detail endpoint.");
    }
  }

  async function runCsvImport(dryRun: boolean) {
    setNeutralStatus(dryRun ? "Previewing CSV import..." : "Applying CSV import...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/cost-codes/import-csv/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({ csv_text: importCsvText, dry_run: dryRun }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setErrorStatus(payload.error?.message ?? "CSV import failed.");
        return;
      }

      const result = payload.data as CsvImportResult;
      setImportResult(result);
      setSuccessStatus(
        `${dryRun ? "Previewed" : "Applied"} ${result.total_rows} row(s): create ${result.created_count}, update ${result.updated_count}, errors ${result.error_count}.`,
      );
      if (!dryRun) {
        await loadCostCodes({ keepStatusOnSuccess: true });
      }
    } catch {
      setErrorStatus("Could not reach cost code CSV import endpoint.");
    }
  }

  const selectedCostCode = rows.find((row) => String(row.id) === selectedId) ?? null;

  return (
    <section className={styles.console}>
      <div className={styles.headerRow}>
        <div className={styles.headerCopy}>
          <h2 className={styles.headerTitle}>Cost Codes</h2>
          <p className={styles.headerSubtitle}>
            Manage coding standards for estimates, budgets, and downstream reporting.
          </p>
        </div>
        <div className={styles.headerStats}>
          <span className={styles.headerStatPill}>Total {rows.length}</span>
          <span className={styles.headerStatPill}>Active {activeRowCount}</span>
          <span className={styles.headerStatPill}>Archived {archivedRowCount}</span>
        </div>
      </div>

      {!token ? <p className={styles.authNotice}>{authMessage}</p> : null}

      {statusMessage ? (
        <p
          className={`${styles.statusBanner} ${
            statusTone === "success"
              ? styles.statusSuccess
              : statusTone === "error"
                ? styles.statusError
                : ""
          }`}
        >
          {statusMessage}
        </p>
      ) : null}

      {token ? (
        <div className={styles.layout}>
          <section className={`${styles.panel} ${styles.existingPanel}`}>
            <div className={styles.panelHeader}>
              <h3 className={styles.panelTitle}>Existing Codes</h3>
              <span className={styles.countBadge}>{rows.length}</span>
            </div>
            <p className={styles.panelIntro}>
              Search and select a code to edit details or adjust active status.
            </p>

            <div className={styles.filterSwitchCard}>
              <div className={styles.filterSwitchHeader}>
                <span className={styles.filterSwitchTitle}>Visibility</span>
              </div>
              <div
                className={styles.filterSegmentRow}
                role="group"
                aria-label="Cost code visibility filter"
              >
                <button
                  type="button"
                  className={`${styles.filterSegmentButton} ${
                    !includeArchived ? styles.filterSegmentButtonActive : ""
                  }`}
                  onClick={() => setVisibilityFilter("active")}
                  aria-pressed={!includeArchived}
                >
                  Active
                  <span className={styles.filterSegmentCount}>{activeRowCount}</span>
                </button>
                <button
                  type="button"
                  className={`${styles.filterSegmentButton} ${
                    includeArchived ? styles.filterSegmentButtonActive : ""
                  }`}
                  onClick={() => setVisibilityFilter("all")}
                  aria-pressed={includeArchived}
                >
                  All
                  <span className={styles.filterSegmentCount}>{rows.length}</span>
                </button>
              </div>
              <p className={styles.filterSwitchSummary}>
                {includeArchived
                  ? `${activeRowCount} active, ${archivedRowCount} archived`
                  : `${activeRowCount} active`}
              </p>
            </div>

            <label className={styles.searchBlock} htmlFor="cost-code-search-input">
              <span className={styles.searchLabel}>Search</span>
              <input
                id="cost-code-search-input"
                className={styles.searchInput}
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search by code or name"
              />
            </label>

            <div className={styles.list}>
              {filteredRows.length ? (
                filteredRows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={`${styles.listItem} ${
                      String(row.id) === selectedId ? styles.listItemSelected : ""
                    }`}
                    onClick={() => handleSelect(String(row.id))}
                  >
                    <span className={styles.itemTop}>
                      <span className={styles.itemCode}>{row.code}</span>
                      <span
                        className={`${styles.itemStatusBadge} ${
                          row.is_active ? styles.itemStatusActive : styles.itemStatusArchived
                        }`}
                      >
                        {row.is_active ? "Active" : "Archived"}
                      </span>
                    </span>
                    <p className={styles.itemName}>{row.name}</p>
                  </button>
                ))
              ) : (
                <p className={styles.emptyState}>No codes match this search.</p>
              )}
            </div>
          </section>

          <div className={styles.layoutRight}>
            <section className={styles.panel}>
              <h3 className={styles.panelTitle}>Create Cost Code</h3>
              <p className={styles.panelIntro}>
                Add a new code with a human-readable name for estimating and billing workflows.
              </p>
              <form className={styles.form} onSubmit={handleCreate}>
                <label className={styles.field}>
                  Code
                  <input
                    value={newCode}
                    onChange={(event) => setNewCode(event.target.value)}
                    required
                  />
                </label>
                <label className={styles.field}>
                  Name
                  <input
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    required
                  />
                </label>
                <div className={styles.field}>
                  Active
                  <div className={styles.segmentRow}>
                    <button
                      type="button"
                      className={`${styles.segmentButton} ${newIsActive ? styles.segmentButtonActive : ""}`}
                      onClick={() => setNewIsActive(true)}
                    >
                      Active
                    </button>
                    <button
                      type="button"
                      className={`${styles.segmentButton} ${!newIsActive ? styles.segmentButtonActive : ""}`}
                      onClick={() => setNewIsActive(false)}
                    >
                      Inactive
                    </button>
                  </div>
                </div>
                <div className={styles.buttonRow}>
                  <button type="submit" className={styles.primaryButton}>
                    Create
                  </button>
                </div>
              </form>
            </section>

            <section className={styles.panel}>
              <h3 className={styles.panelTitle}>Edit Cost Code</h3>
              <p className={styles.panelIntro}>
                Update naming and active status while keeping original code values stable.
              </p>
              {selectedCostCode ? (
                <form className={styles.form} onSubmit={handleSave}>
                  <label className={styles.field}>
                    Code (locked)
                    <input value={code} disabled aria-readonly="true" />
                  </label>
                  <label className={styles.field}>
                    Name
                    <input value={name} onChange={(event) => setName(event.target.value)} required />
                  </label>
                  <div className={styles.field}>
                    Active
                    <div className={styles.segmentRow}>
                      <button
                        type="button"
                        className={`${styles.segmentButton} ${isActive ? styles.segmentButtonActive : ""}`}
                        onClick={() => setIsActive(true)}
                      >
                        Active
                      </button>
                      <button
                        type="button"
                        className={`${styles.segmentButton} ${!isActive ? styles.segmentButtonActive : ""}`}
                        onClick={() => setIsActive(false)}
                      >
                        Inactive
                      </button>
                    </div>
                  </div>
                  <div className={styles.buttonRow}>
                    <button type="submit" className={styles.primaryButton}>
                      Save
                    </button>
                  </div>
                </form>
              ) : (
                <p className={styles.emptyState}>Create a code first, then select it to edit.</p>
              )}
            </section>

            <section className={styles.panel}>
              <h3 className={styles.panelTitle}>CSV Import</h3>
              <p className={styles.importSummary}>
                Headers: code,name,is_active. Existing code updates; unknown code creates.
              </p>
              <label className={styles.field}>
                CSV text
                <textarea
                  value={importCsvText}
                  onChange={(event) => setImportCsvText(event.target.value)}
                  rows={8}
                />
              </label>
              <div className={styles.buttonRow}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void runCsvImport(true)}
                >
                  Preview
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void runCsvImport(false)}
                >
                  Apply
                </button>
              </div>
              {importResult ? (
                <div className={styles.importResult}>
                  <p className={styles.importSummary}>
                    Rows: {importResult.total_rows} | Create: {importResult.created_count} | Update: {" "}
                    {importResult.updated_count} | Errors: {importResult.error_count}
                  </p>
                  <ul className={styles.resultRows}>
                    {importResult.rows.map((row) => (
                      <li
                        key={`${row.row_number}-${row.code ?? "none"}-${row.status}`}
                        className={`${styles.resultRow} ${
                          row.status === "error" ? styles.resultRowError : ""
                        }`}
                      >
                        row {row.row_number} | {row.status} | {row.code || "(no code)"}: {row.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      ) : null}
    </section>
  );
}
