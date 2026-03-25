"use client";

/**
 * Customer management console — root component for the /customers page.
 *
 * Pure orchestrator — owns no domain state itself. Composes single-purpose
 * hooks, wires their outputs into child components, and handles cross-hook
 * coordination (modal mutual exclusion, combined refresh, post-creation focus).
 *
 * Parent: app/customers/page.tsx
 *
 * ## Page layout
 *
 * ┌─────────────────────────────────────────┐
 * │ Onboarding Banner (conditional)         │
 * ├─────────────────────────────────────────┤
 * │ Quick Add Section                       │
 * │   └── QuickAddConsole                   │
 * ├─────────────────────────────────────────┤
 * │ Browse Section                          │
 * │   ├── CustomersFilters                  │
 * │   ├── Status message (conditional)      │
 * │   ├── CustomersList                     │
 * │   └── Pagination (conditional)          │
 * └─────────────────────────────────────────┘
 *
 * Modals (overlay, one at a time):
 *   ├── CustomerEditorForm
 *   └── CustomerProjectCreateForm
 *
 * ## Hook dependency graph
 *
 * useCustomerListFetch (owns customer data — the root)
 *   ├── useCustomerFilters       (reads customerRows)
 *   ├── useCustomerEditor        (reads + writes customerRows, writes statusMessage)
 *   └── useProjectCreator        (reads customerRows, writes statusMessage)
 * useProjectsByCustomer          (independent — own fetch, own refresh)
 *
 * ## Functions
 *
 * - refreshAll()
 *     Calls listFetch.refresh() + projectIndex.refresh(). Passed to
 *     QuickAddConsole so both data sources reload after a new customer.
 *
 * ## Orchestration (in JSX)
 *
 * - Modal mutual exclusion: opening the editor closes the project
 *   creator, and vice versa.
 * - onBrowseCustomer: sets search query, resets page to 1, clears
 *   activity filter to "all" so archived customers are findable.
 * - Pagination: inline prev/next controls wired to listFetch.setPage.
 */

import { canDo } from "@/shared/session/rbac";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { useCustomerListFetch } from "../hooks/use-customer-list-fetch";
import { useCustomerFilters } from "../hooks/use-customer-filters";
import { useProjectsByCustomer } from "../hooks/use-projects-by-customer";
import { useCustomerEditor } from "../hooks/use-customer-editor";
import { useProjectCreator } from "../hooks/use-project-creator";

import { CustomerEditorForm } from "./customer-editor-form";
import { CustomersFilters } from "./customers-filters";
import { CustomersList } from "./customers-list";
import { CustomerProjectCreateForm } from "./customer-project-create-form";
import { QuickAddConsole } from "./quick-add/quick-add-console";
import styles from "./customers-console.module.css";

/** Root console component for customer CRUD, filtering, and project creation. */
export function CustomersConsole() {
  const { token: authToken, capabilities } = useSharedSessionAuth();
  const canMutateCustomers = canDo(capabilities, "customers", "create");
  const canMutateProjects = canDo(capabilities, "projects", "create");


  const listFetch = useCustomerListFetch(authToken);
  const filters = useCustomerFilters(listFetch.customerRows);
  const projectIndex = useProjectsByCustomer(authToken);

  const editor = useCustomerEditor({
    authToken,
    canMutate: canMutateCustomers,
    customerRows: listFetch.customerRows,
    setCustomerRows: listFetch.setCustomerRows,
    setStatusMessage: listFetch.setStatusMessage,
  });

  const projectCreator = useProjectCreator({
    authToken,
    canMutate: canMutateProjects,
    customerRows: listFetch.customerRows,
    setStatusMessage: listFetch.setStatusMessage,
  });

  // Highlight a customer row after creation — auto-clears after animation.
  const [highlightedCustomerId, setHighlightedCustomerId] = useState<number | null>(null);

  useEffect(() => {
    if (highlightedCustomerId == null) return;
    const timer = setTimeout(() => setHighlightedCustomerId(null), 3000);
    return () => clearTimeout(timer);
  }, [highlightedCustomerId]);

  const handleFocusCustomer = useCallback((id: number, name: string) => {
    listFetch.setQuery(name);
    listFetch.setPage(1);
    filters.setActivityFilter("all");
    setHighlightedCustomerId(id);
  }, [listFetch, filters]);

  // URL deep-link: ?customer=<id> searches and highlights the customer row.
  const searchParams = useSearchParams();
  const urlFocusHandledRef = useRef(false);

  useEffect(() => {
    if (urlFocusHandledRef.current) return;
    const param = searchParams.get("customer");
    if (!param || !/^\d+$/.test(param)) return;
    const match = listFetch.customerRows.find((r) => r.id === Number(param));
    if (match) {
      handleFocusCustomer(match.id, match.display_name);
      urlFocusHandledRef.current = true;
    }
  }, [listFetch.customerRows, searchParams, handleFocusCustomer]);

  function refreshAll() {
    listFetch.refresh();
    projectIndex.refresh();
  }

  return (
    <section className={styles.section}>
      {/* Quick Add intake form */}
      <div className={styles.quickAddSection}>
        <div className={styles.quickAddHeader}>
          <h3 className={styles.quickAddTitle}>Quick Add Customer</h3>
        </div>
        <QuickAddConsole
          onCustomerCreated={refreshAll}
          onBrowseCustomer={(searchTerm) => {
            listFetch.setQuery(searchTerm);
            listFetch.setPage(1);
            filters.setActivityFilter("all");
          }}
          onFocusCustomer={handleFocusCustomer}
        />
      </div>

      {/* Browse — search, filters, customer list, pagination */}
      <div className={styles.browseSection}>
        <h3 className={styles.browseSectionTitle}>Browse Customers</h3>

        <CustomersFilters
          query={listFetch.query}
          onQueryChange={(next) => {
            listFetch.setQuery(next);
            listFetch.setPage(1);
          }}
          activityFilter={filters.activityFilter}
          onActivityFilterChange={filters.setActivityFilter}
          projectFilter={filters.projectFilter}
          onProjectFilterChange={filters.setProjectFilter}
        />

        {listFetch.statusMessage ? <p className={styles.statusMessage}>{listFetch.statusMessage}</p> : null}

        <CustomersList
          rows={listFetch.customerRows}
          filteredRows={filters.filteredRows}
          query={listFetch.query}
          projectsByCustomer={projectIndex.projectsByCustomer}
          highlightedCustomerId={highlightedCustomerId}
          onEdit={(id) => {
            projectCreator.close();
            editor.open(id);
          }}
          onCreateProject={(customer) => {
            editor.close();
            projectCreator.open(customer);
          }}
        />

        {listFetch.totalPages > 1 ? (
          <nav className={styles.pagination} aria-label="Customer list pagination">
            <button
              type="button"
              className={styles.paginationButton}
              disabled={listFetch.page <= 1}
              onClick={() => listFetch.setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span className={styles.paginationInfo}>
              Page {listFetch.page} of {listFetch.totalPages} ({listFetch.totalCount} customers)
            </span>
            <button
              type="button"
              className={styles.paginationButton}
              disabled={listFetch.page >= listFetch.totalPages}
              onClick={() => listFetch.setPage((p) => Math.min(listFetch.totalPages, p + 1))}
            >
              Next
            </button>
          </nav>
        ) : null}
      </div>

      {/* Edit customer modal */}

      {editor.isOpen && editor.editingCustomer ? (
        <div
          className={styles.modalOverlay}
          onMouseDown={editor.backdropDismiss.onMouseDown}
          onMouseUp={editor.backdropDismiss.onMouseUp}
        >
          <section className={styles.modalCard} role="dialog" aria-modal="true" aria-label="Edit customer">
            <button type="button" className={styles.modalClose} onClick={editor.close}>
              Close
            </button>
            <CustomerEditorForm
              selectedId={editor.editingId}
              selectedCustomerName={editor.editingCustomer.display_name ?? ""}
              displayName={editor.displayName}
              onDisplayNameChange={editor.setDisplayName}
              phone={editor.phone}
              onPhoneChange={editor.setPhone}
              email={editor.email}
              onEmailChange={editor.setEmail}
              billingAddress={editor.billingAddress}
              onBillingAddressChange={editor.setBillingAddress}
              isArchived={editor.isArchived}
              onIsArchivedChange={editor.setIsArchived}
              hasActiveOrOnHoldProject={Boolean(editor.editingCustomer.has_active_or_on_hold_project)}
              onSubmit={editor.handleSave}
              readOnly={!canMutateCustomers}
            />
          </section>
        </div>
      ) : null}

      {/* Create project modal */}

      {projectCreator.isOpen && projectCreator.customer ? (
        <div
          className={styles.modalOverlay}
          onMouseDown={projectCreator.backdropDismiss.onMouseDown}
          onMouseUp={projectCreator.backdropDismiss.onMouseUp}
        >
          <section className={styles.modalCard} role="dialog" aria-modal="true" aria-label="Create project">
            <button type="button" className={styles.modalClose} onClick={projectCreator.close}>
              Close
            </button>
            <CustomerProjectCreateForm
              customerName={projectCreator.customer.display_name}
              projectName={projectCreator.projectName}
              onProjectNameChange={projectCreator.setProjectName}
              projectSiteAddress={projectCreator.projectSiteAddress}
              onProjectSiteAddressChange={projectCreator.setProjectSiteAddress}
              projectStatus={projectCreator.projectStatus}
              onProjectStatusChange={projectCreator.setProjectStatus}
              onSubmit={projectCreator.handleCreate}
              readOnly={!canMutateProjects}
              formMessage={projectCreator.formMessage}
            />
          </section>
        </div>
      ) : null}
    </section>
  );
}
