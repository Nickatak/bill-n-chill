"use client";

/**
 * Cost code management console — root component for the /cost-codes page.
 *
 * Pure orchestrator — composes hooks for list fetching, form CRUD,
 * and filtering. Owns no domain state itself.
 *
 * Parent: app/cost-codes/page.tsx
 *
 * ## Page layout
 *
 * ┌─────────────────────────────────────────────────────┐
 * │ Header (title + stat pills)                         │
 * ├─────────────────────────────────────────────────────┤
 * │ Status banner (conditional)                         │
 * ├──────────────────────┬──────────────────────────────┤
 * │ Existing Codes       │ Create/Edit Form             │
 * │   ├── Search input   │   ├── Code (locked in edit)  │
 * │   ├── Filter pills   │   ├── Name                   │
 * │   ├── Code list      │   ├── Status toggle (edit)   │
 * │   └── Pagination     │   └── Submit / Cancel        │
 * └──────────────────────┴──────────────────────────────┘
 *
 * ## Hook dependency graph
 *
 * useApiList (shared — owns list data, selection, status messaging)
 *   ├── useCostCodeFilters  (reads costCodes)
 *   └── useCostCodeForm     (reads + writes costCodes, reads selectedId)
 * useClientPagination       (reads filteredRows)
 *
 * ## Orchestration (in JSX)
 *
 * - useApiList's onSuccess hydrates the form or switches to create mode
 *   depending on whether items were returned. Uses form functions via
 *   closure (safe because useApiList stores onSuccess in a ref).
 * - List row clicks go through form.handleSelect.
 * - Form submit dispatches to form.handleCreate or form.handleSave
 *   based on form.formMode.
 */

import { canDo } from "@/shared/session/rbac";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { useApiList } from "@/shared/hooks/use-api-list";
import { useClientPagination } from "@/shared/hooks/use-client-pagination";
import { PaginationControls } from "@/shared/components/pagination-controls";

import { useCostCodeForm } from "../hooks/use-cost-code-form";
import { useCostCodeFilters } from "../hooks/use-cost-code-filters";
import type { CostCode } from "../types";
import styles from "./cost-codes-console.module.css";

/** Full CRUD console for cost codes with search and visibility filter. */
export function CostCodesConsole() {
  const { token: authToken, authMessage, capabilities } = useSharedSessionAuth();
  const canMutateCostCodes = canDo(capabilities, "cost_codes", "create");

  const {
    items: costCodes,
    setItems: setCostCodes,
    selectedId,
    setSelectedId,
    status: {
      message: statusMessage,
      tone: statusTone,
      setNeutral: setNeutralStatus,
      setSuccess: setSuccessStatus,
      setError: setErrorStatus,
    },
  } = useApiList<CostCode>({
    endpoint: "/cost-codes/",
    token: authToken,
    autoSelect: true,
    onSuccess(items) {
      if (!items.length) {
        form.switchToCreate();
        return;
      }
      const preferred = items.find((row) => String(row.id) === selectedId) ?? items[0];
      form.hydrate(preferred);
    },
  });

  const form = useCostCodeForm({
    authToken,
    canMutate: canMutateCostCodes,
    costCodes,
    setCostCodes,
    selectedId,
    setSelectedId,
    status: { setNeutral: setNeutralStatus, setSuccess: setSuccessStatus, setError: setErrorStatus },
  });

  const filters = useCostCodeFilters(costCodes);

  const { paginatedItems: pageRows, page, totalPages, totalCount, setPage } =
    useClientPagination(filters.filteredRows, 25);

  const selectedCostCode = costCodes.find((row) => String(row.id) === selectedId) ?? null;
  const isEditing = form.formMode === "edit" && selectedCostCode;

  return (
    <section className={styles.console}>
      {!authToken ? <p className={styles.authNotice}>{authMessage}</p> : null}

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

      {authToken ? (
        <div className={styles.layout}>
          <section className={`${styles.panel} ${styles.existingPanel}`}>
            <div className={styles.panelHeader}>
              <h3 className={styles.panelTitle}>Existing Codes</h3>
              <span className={styles.countBadge}>{filters.filteredRows.length}</span>
            </div>

            <div className={styles.filterRow}>
              <input
                className={styles.searchInput}
                value={filters.searchTerm}
                onChange={(event) => filters.setSearchTerm(event.target.value)}
                placeholder="Search by code or name"
                aria-label="Search cost codes"
              />
              <div className={styles.filterPills} role="group" aria-label="Cost code visibility filter">
                <button
                  type="button"
                  className={`${styles.filterPill} ${!filters.includeArchived ? styles.filterPillActive : ""}`}
                  onClick={() => filters.setVisibilityFilter("active")}
                  aria-pressed={!filters.includeArchived}
                >
                  Active
                </button>
                <button
                  type="button"
                  className={`${styles.filterPill} ${filters.includeArchived ? styles.filterPillActive : ""}`}
                  onClick={() => filters.setVisibilityFilter("all")}
                  aria-pressed={filters.includeArchived}
                >
                  All
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
                    onClick={() => form.handleSelect(String(row.id))}
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
                  <button type="button" className={styles.newButton} onClick={form.switchToCreate}>
                    + New
                  </button>
                ) : null}
              </div>

              <form className={styles.form} onSubmit={isEditing ? form.handleSave : form.handleCreate}>
                <label className={styles.field}>
                  Code{isEditing ? " (locked)" : ""}
                  <input
                    value={form.code}
                    onChange={(event) => form.setCode(event.target.value)}
                    disabled={!!isEditing}
                    aria-readonly={!!isEditing || undefined}
                    required
                  />
                </label>
                <label className={styles.field}>
                  Name
                  <input value={form.name} onChange={(event) => form.setName(event.target.value)} required />
                </label>
                <label className={styles.toggleField}>
                  Taxable
                  <span className={styles.switchRow}>
                    <input
                      className={styles.switchInput}
                      type="checkbox"
                      checked={form.isTaxable}
                      onChange={(event) => form.setIsTaxable(event.target.checked)}
                    />
                    <span className={styles.switchLabel}>{form.isTaxable ? "Yes" : "No"}</span>
                  </span>
                </label>
                {isEditing ? (
                  <label className={styles.toggleField}>
                    Archive
                    <span className={styles.switchRow}>
                      <input
                        className={styles.switchInput}
                        type="checkbox"
                        checked={!form.isActive}
                        onChange={(event) => form.setIsActive(!event.target.checked)}
                      />
                      <span className={styles.switchLabel}>{form.isActive ? "Active" : "Archived"}</span>
                    </span>
                  </label>
                ) : null}
                <div className={styles.buttonRow}>
                  <button type="submit" className={styles.primaryButton} disabled={!canMutateCostCodes}>
                    {isEditing ? "Save" : "Create"}
                  </button>
                  {isEditing ? (
                    <button type="button" className={styles.secondaryButton} onClick={form.switchToCreate}>
                      Cancel
                    </button>
                  ) : null}
                </div>
              </form>
            </section>
          </div>
        </div>
      ) : null}
    </section>
  );
}
