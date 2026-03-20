"use client";

/**
 * Top-level customer management page. Lists all customers with search/filter controls,
 * provides modal-based editing of customer details, and supports inline project creation
 * that routes the user into the new project workspace.
 */

import { canDo } from "@/shared/session/rbac";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import Link from "next/link";

import { useCustomerList } from "../hooks/use-customer-list";
import { useCustomerEditor } from "../hooks/use-customer-editor";
import { useProjectCreator } from "../hooks/use-project-creator";

import { CustomerEditorForm } from "./customer-editor-form";
import { CustomersFilters } from "./customers-filters";
import { CustomersList } from "./customers-list";
import { CustomerProjectCreateForm } from "./customer-project-create-form";
import { QuickAddConsole } from "./quick-add-console";
import styles from "./customers-console.module.css";

/** Root console component for customer CRUD, filtering, and project creation. */
export function CustomersConsole() {
  const { token, capabilities, organization } = useSharedSessionAuth();
  const canMutateCustomers = canDo(capabilities, "customers", "create");
  const canMutateProjects = canDo(capabilities, "projects", "create");
  const showOnboarding = organization != null && organization.onboardingCompleted !== true;

  // Editor is declared first so the list hook can call back into it for scoped customers.
  // We use a ref to break the circular dependency (list needs editor.open, editor needs list.rows).
  const editorOpenRef = { current: null as ((id: string) => void) | null };

  const list = useCustomerList(token, {
    onScopedCustomerFound: (customer) => editorOpenRef.current?.(String(customer.id)),
  });

  const editor = useCustomerEditor({
    token,
    normalizedBaseUrl: list.normalizedBaseUrl,
    canMutate: canMutateCustomers,
    rows: list.rows,
    setRows: list.setRows,
    setStatusMessage: list.setStatusMessage,
  });

  editorOpenRef.current = editor.open;

  const projectCreator = useProjectCreator({
    token,
    normalizedBaseUrl: list.normalizedBaseUrl,
    canMutate: canMutateProjects,
    rows: list.rows,
    setStatusMessage: list.setStatusMessage,
  });

  return (
    <section className={styles.section}>
      {showOnboarding ? (
        <div className={styles.onboardingBanner}>
          <span className={styles.onboardingBannerText}>
            New here? Follow the getting started guide to set up your workspace.
          </span>
          <Link href="/onboarding" className={styles.onboardingBannerLink}>
            Get Started
          </Link>
        </div>
      ) : null}

      {/* Quick Add intake form */}
      <div className={styles.quickAddSection}>
        <div className={styles.quickAddHeader}>
          <h3 className={styles.quickAddTitle}>Quick Add Customer</h3>
        </div>
        <QuickAddConsole
          onCustomerCreated={list.refresh}
          onBrowseCustomer={(searchTerm) => {
            list.setQuery(searchTerm);
            list.setPage(1);
            list.setActivityFilter("all");
          }}
        />
      </div>

      {/* Browse — search, filters, customer list, pagination */}
      <div className={styles.browseSection}>
        <h3 className={styles.browseSectionTitle}>Browse Customers</h3>

        <CustomersFilters
          query={list.query}
          onQueryChange={(next) => {
            list.setQuery(next);
            list.setPage(1);
          }}
          activityFilter={list.activityFilter}
          onActivityFilterChange={list.setActivityFilter}
          projectFilter={list.projectFilter}
          onProjectFilterChange={list.setProjectFilter}
        />

        {list.statusMessage ? <p className={styles.statusMessage}>{list.statusMessage}</p> : null}

        <CustomersList
          rows={list.rows}
          filteredRows={list.filteredRows}
          query={list.query}
          projectsByCustomer={list.projectsByCustomer}
          onEdit={(id) => {
            projectCreator.close();
            editor.open(id);
          }}
          onCreateProject={(customer) => {
            editor.close();
            projectCreator.open(customer);
          }}
        />

        {list.totalPages > 1 ? (
          <nav className={styles.pagination} aria-label="Customer list pagination">
            <button
              type="button"
              className={styles.paginationButton}
              disabled={list.page <= 1}
              onClick={() => list.setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span className={styles.paginationInfo}>
              Page {list.page} of {list.totalPages} ({list.totalCount} customers)
            </span>
            <button
              type="button"
              className={styles.paginationButton}
              disabled={list.page >= list.totalPages}
              onClick={() => list.setPage((p) => Math.min(list.totalPages, p + 1))}
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
          onMouseDown={editor.handleOverlayMouseDown}
          onMouseUp={editor.handleOverlayMouseUp}
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
          onMouseDown={editor.handleOverlayMouseDown}
          onMouseUp={editor.handleOverlayMouseUp}
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
              formMessage={list.statusMessage}
            />
          </section>
        </div>
      ) : null}
    </section>
  );
}
