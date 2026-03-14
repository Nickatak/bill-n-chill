"use client";

/**
 * Cost code management console. Supports browsing, searching, creating, and editing
 * individual cost codes as well as bulk CSV import with dry-run preview. Cost codes
 * are the shared coding standard for estimates, budgets, and downstream reporting.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { canDo } from "@/shared/session/rbac";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { useStatusMessage } from "@/shared/hooks/use-status-message";
import { useClientPagination } from "@/shared/hooks/use-client-pagination";
import { PaginationControls } from "@/shared/components/pagination-controls";
import styles from "./cost-codes-console.module.css";
import { ApiResponse, CostCode, CsvImportResult } from "../types";

type VisibilityFilter = "active" | "all";
type FormMode = "create" | "edit";

/** Full CRUD console for cost codes with search, visibility filter, and CSV import. */
export function CostCodesConsole() {
  const { token, authMessage, capabilities } = useSharedSessionAuth();
  const canMutateCostCodes = canDo(capabilities, "cost_codes", "create");

  const [rows, setRows] = useState<CostCode[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const {
    message: statusMessage,
    tone: statusTone,
    setNeutral: setNeutralStatus,
    setSuccess: setSuccessStatus,
    setError: setErrorStatus,
    setMessage: setStatusMessage,
  } = useStatusMessage();
  const [searchTerm, setSearchTerm] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("active");

  const [formMode, setFormMode] = useState<FormMode>("create");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [importCsvText, setImportCsvText] = useState("code,name\n");
  const [importResult, setImportResult] = useState<CsvImportResult | null>(null);
  const [importExpanded, setImportExpanded] = useState(false);
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
  const { paginatedItems: pageRows, page, totalPages, totalCount, setPage } =
    useClientPagination(filteredRows, 25);
  const includeArchived = visibilityFilter === "all";
  const activeRowCount = rows.filter((row) => row.is_active).length;
  const archivedRowCount = rows.length - activeRowCount;
  const selectedCostCode = rows.find((row) => String(row.id) === selectedId) ?? null;
  const isEditing = formMode === "edit" && selectedCostCode;

  /** Populate the form fields from a cost code record and switch to edit mode. */
  function hydrate(item: CostCode) {
    setCode(item.code);
    setName(item.name);
    setIsActive(item.is_active);
    setFormMode("edit");
  }

  /** Clear the form and switch to create mode. */
  function switchToCreate() {
    setSelectedId("");
    setCode("");
    setName("");
    setIsActive(true);
    setFormMode("create");
  }

  // Keep ref in sync so the async loadCostCodes callback can read the latest selection
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  /** Fetch all cost codes and re-select the previously-selected row if still present. */
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
          switchToCreate();
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
    [normalizedBaseUrl, setErrorStatus, setNeutralStatus, setStatusMessage, token],
  );

  // Initial data load once a session token is available
  useEffect(() => {
    if (!token) {
      return;
    }
    const run = window.setTimeout(() => {
      void loadCostCodes();
    }, 0);
    return () => window.clearTimeout(run);
  }, [loadCostCodes, token]);

  /** Select a cost code row and populate the edit form. */
  function handleSelect(id: string) {
    setSelectedId(id);
    const item = rows.find((row) => String(row.id) === id);
    if (item) {
      hydrate(item);
    }
  }

  /** POST a new cost code and select it on success. */
  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutateCostCodes) {
      setErrorStatus("Your role is read-only for cost code mutations.");
      return;
    }
    setNeutralStatus("Creating cost code...");

    try {
      const response = await fetch(`${normalizedBaseUrl}/cost-codes/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          is_active: true,
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
      setSuccessStatus(`Created cost code #${created.id} (${created.code} - ${created.name}).`);
    } catch {
      setErrorStatus("Could not reach cost code create endpoint.");
    }
  }

  /** PATCH the selected cost code with edited name and active status. */
  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutateCostCodes) {
      setErrorStatus("Your role is read-only for cost code mutations.");
      return;
    }
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

  /** Run a CSV import (preview or apply) and reload cost codes on successful apply. */
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

  return (
    <section className={styles.console}>
      <div className={styles.headerRow}>
        <div className={styles.headerCopy}>
          <h2 className={styles.headerTitle}>Cost Codes</h2>
        </div>
        <div className={styles.headerStats}>
          <span className={styles.headerStatPill}>Total {rows.length}</span>
          <span className={`${styles.headerStatPill} ${styles.headerStatActive}`}>Active {activeRowCount}</span>
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
              <span className={styles.countBadge}>{filteredRows.length}</span>
            </div>

            <div className={styles.filterRow}>
              <input
                className={styles.searchInput}
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search by code or name"
                aria-label="Search cost codes"
              />
              <div className={styles.filterPills} role="group" aria-label="Cost code visibility filter">
                <button
                  type="button"
                  className={`${styles.filterPill} ${!includeArchived ? styles.filterPillActive : ""}`}
                  onClick={() => setVisibilityFilter("active")}
                  aria-pressed={!includeArchived}
                >
                  Active
                  <span className={styles.filterPillCount}>{activeRowCount}</span>
                </button>
                <button
                  type="button"
                  className={`${styles.filterPill} ${includeArchived ? styles.filterPillActive : ""}`}
                  onClick={() => setVisibilityFilter("all")}
                  aria-pressed={includeArchived}
                >
                  All
                  <span className={styles.filterPillCount}>{rows.length}</span>
                </button>
              </div>
            </div>

            <div className={styles.list}>
              {pageRows.length ? (
                pageRows.map((row) => (
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
            <PaginationControls
              page={page}
              totalPages={totalPages}
              totalCount={totalCount}
              onPageChange={setPage}
            />
          </section>

          <div className={styles.layoutRight}>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h3 className={styles.panelTitle}>
                  {isEditing ? `Edit: ${selectedCostCode.code}` : "New Cost Code"}
                </h3>
                {isEditing ? (
                  <button type="button" className={styles.newButton} onClick={switchToCreate}>
                    + New
                  </button>
                ) : null}
              </div>

              <form className={styles.form} onSubmit={isEditing ? handleSave : handleCreate}>
                <label className={styles.field}>
                  Code{isEditing ? " (locked)" : ""}
                  <input
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    disabled={!!isEditing}
                    aria-readonly={!!isEditing || undefined}
                    required
                  />
                </label>
                <label className={styles.field}>
                  Name
                  <input value={name} onChange={(event) => setName(event.target.value)} required />
                </label>
                {isEditing ? (
                  <div className={styles.field}>
                    Status
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
                        className={`${styles.segmentButton} ${!isActive ? styles.segmentButtonInactive : ""}`}
                        onClick={() => setIsActive(false)}
                      >
                        Archived
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className={styles.buttonRow}>
                  <button type="submit" className={styles.primaryButton} disabled={!canMutateCostCodes}>
                    {isEditing ? "Save" : "Create"}
                  </button>
                  {isEditing ? (
                    <button type="button" className={styles.secondaryButton} onClick={switchToCreate}>
                      Cancel
                    </button>
                  ) : null}
                </div>
              </form>
            </section>

            <section className={styles.panel}>
              <button
                type="button"
                className={styles.importToggle}
                onClick={() => setImportExpanded((current) => !current)}
                aria-expanded={importExpanded}
              >
                <h3 className={styles.panelTitle}>CSV Import</h3>
                <span className={styles.importToggleArrow}>{importExpanded ? "▲" : "▼"}</span>
              </button>
              {importExpanded ? (
                <>
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
                      disabled={!canMutateCostCodes}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => void runCsvImport(false)}
                      disabled={!canMutateCostCodes}
                    >
                      Apply
                    </button>
                  </div>
                  {importResult ? (
                    <div className={styles.importResult}>
                      <p className={styles.importHint}>
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
                </>
              ) : null}
            </section>
          </div>
        </div>
      ) : null}
    </section>
  );
}
