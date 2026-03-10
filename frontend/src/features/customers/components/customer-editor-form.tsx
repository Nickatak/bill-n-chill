"use client";

/**
 * Controlled form for editing an existing customer's profile fields (name, contact info,
 * archive status). Rendered inside a modal dialog from CustomersConsole.
 */

import { FormEventHandler } from "react";

import styles from "./customers-console.module.css";

type CustomerEditorFormProps = {
  selectedId: string;
  selectedCustomerName: string;
  displayName: string;
  onDisplayNameChange: (value: string) => void;
  phone: string;
  onPhoneChange: (value: string) => void;
  email: string;
  onEmailChange: (value: string) => void;
  billingAddress: string;
  onBillingAddressChange: (value: string) => void;
  isArchived: boolean;
  onIsArchivedChange: (value: boolean) => void;
  projectCount: number;
  activeProjectCount: number;
  hasActiveOrOnHoldProject: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  readOnly?: boolean;
  formMessage?: string;
};

/** Editable customer detail form with archive-safety guard for active projects. */
export function CustomerEditorForm({
  selectedId,
  selectedCustomerName,
  displayName,
  onDisplayNameChange,
  phone,
  onPhoneChange,
  email,
  onEmailChange,
  billingAddress,
  onBillingAddressChange,
  isArchived,
  onIsArchivedChange,
  projectCount,
  activeProjectCount,
  hasActiveOrOnHoldProject,
  onSubmit,
  readOnly = false,
  formMessage,
}: CustomerEditorFormProps) {
  // Prevent archiving while the customer still has work in progress
  const archiveToggleBlocked = hasActiveOrOnHoldProject && !isArchived;

  return (
    <form className={styles.editorForm} onSubmit={onSubmit}>
      <header className={styles.panelHeader}>
        <h3 className={styles.panelTitle}>Edit Customer</h3>
        <p className={styles.panelSubtle}>
          {selectedId
            ? `Editing #${selectedId}${selectedCustomerName ? ` (${selectedCustomerName})` : ""}.`
            : "Select a customer record to start editing."}
        </p>
      </header>

      {/* Contact info fields */}

      <label className={styles.field}>
        Display name
        <input
          value={displayName}
          onChange={(event) => onDisplayNameChange(event.target.value)}
          disabled={!selectedId}
        />
      </label>
      <label className={styles.field}>
        Phone
        <input
          value={phone}
          onChange={(event) => onPhoneChange(event.target.value)}
          disabled={!selectedId}
        />
      </label>
      <label className={styles.field}>
        Email
        <input
          type="email"
          value={email}
          onChange={(event) => onEmailChange(event.target.value)}
          disabled={!selectedId}
        />
      </label>
      <label className={styles.field}>
        Billing address
        <input
          value={billingAddress}
          onChange={(event) => onBillingAddressChange(event.target.value)}
          disabled={!selectedId}
        />
      </label>

      {/* Archive toggle and project coverage */}

      <label className={styles.toggleField}>
        Archive
        <span className={styles.switchRow}>
          <input
            className={styles.switchInput}
            type="checkbox"
            checked={isArchived}
            onChange={(event) => onIsArchivedChange(event.target.checked)}
            disabled={!selectedId || archiveToggleBlocked}
          />
          <span className={styles.switchLabel}>{isArchived ? "Archived" : "Active"}</span>
        </span>
      </label>
      {selectedId && isArchived ? (
        <p className={styles.inlineWarning}>
          Saving as archived will automatically cancel this customer&apos;s prospect projects.
        </p>
      ) : null}
      <label className={styles.field}>
        Project coverage
        <input value={`${projectCount} total, ${activeProjectCount} active/on hold`} readOnly />
      </label>
      {archiveToggleBlocked ? (
        <p className={styles.inlineWarning}>
          Archive is blocked while this customer has active or on-hold projects.
        </p>
      ) : null}

      {formMessage ? <p className={styles.inlineWarning}>{formMessage}</p> : null}
      <div className={styles.actionRow}>
        <button className={styles.primaryButton} type="submit" disabled={!selectedId || readOnly}>
          Save Customer
        </button>
      </div>
    </form>
  );
}
