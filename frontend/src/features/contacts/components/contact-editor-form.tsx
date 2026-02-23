"use client";

import { FormEventHandler } from "react";

import styles from "./contacts-console.module.css";

type ContactEditorFormProps = {
  selectedId: string;
  selectedContactName: string;
  fullName: string;
  onFullNameChange: (value: string) => void;
  phone: string;
  onPhoneChange: (value: string) => void;
  email: string;
  onEmailChange: (value: string) => void;
  projectAddress: string;
  onProjectAddressChange: (value: string) => void;
  source: string;
  onSourceChange: (value: string) => void;
  isArchived: boolean;
  onIsArchivedChange: (value: boolean) => void;
  hasProject: boolean;
  notes: string;
  onNotesChange: (value: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onDelete: () => void;
};

export function ContactEditorForm({
  selectedId,
  selectedContactName,
  fullName,
  onFullNameChange,
  phone,
  onPhoneChange,
  email,
  onEmailChange,
  projectAddress,
  onProjectAddressChange,
  source,
  onSourceChange,
  isArchived,
  onIsArchivedChange,
  hasProject,
  notes,
  onNotesChange,
  onSubmit,
  onDelete,
}: ContactEditorFormProps) {
  return (
    <section className={styles.panel}>
      <header className={styles.panelHeader}>
        <h3 className={styles.panelTitle}>Edit Customer</h3>
        <p className={styles.panelSubtle}>
          {selectedId
            ? `Editing #${selectedId}${selectedContactName ? ` (${selectedContactName})` : ""}.`
            : "Select a customer record to start editing."}
        </p>
      </header>

      <form className={styles.editorForm} onSubmit={onSubmit}>
        <label className={styles.field}>
          Full name
          <input
            value={fullName}
            onChange={(event) => onFullNameChange(event.target.value)}
            required
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
          Project address
          <input
            value={projectAddress}
            onChange={(event) => onProjectAddressChange(event.target.value)}
            required
            disabled={!selectedId}
          />
        </label>
        <label className={styles.field}>
          Source
          <select
            value={source}
            onChange={(event) => onSourceChange(event.target.value)}
            disabled={!selectedId}
          >
            <option value="field_manual">field_manual</option>
            <option value="office_manual">office_manual</option>
            <option value="import">import</option>
            <option value="web_form">web_form</option>
            <option value="referral">referral</option>
            <option value="other">other</option>
          </select>
        </label>
        <label className={styles.toggleField}>
          Archive
          <span className={styles.switchRow}>
            <input
              className={styles.switchInput}
              type="checkbox"
              checked={isArchived}
              onChange={(event) => onIsArchivedChange(event.target.checked)}
              disabled={!selectedId}
            />
            <span className={styles.switchLabel}>{isArchived ? "Inactive" : "Active"}</span>
          </span>
        </label>
        <label className={styles.field}>
          Project link
          <input value={hasProject ? "Linked to a project" : "No project linked"} readOnly />
        </label>
        <label className={styles.field}>
          Notes
          <textarea
            rows={3}
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
            disabled={!selectedId}
          />
        </label>

        <div className={styles.actionRow}>
          <button className={styles.primaryButton} type="submit" disabled={!selectedId}>
            Save Customer
          </button>
          <button className={styles.dangerButton} type="button" disabled={!selectedId} onClick={onDelete}>
            Delete Customer
          </button>
        </div>
      </form>
    </section>
  );
}
