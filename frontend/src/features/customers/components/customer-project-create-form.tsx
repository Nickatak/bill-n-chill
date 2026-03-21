"use client";

/**
 * Controlled form for creating a new project under a specific customer.
 * Allows the user to set a project name, site address, and initial status
 * (prospect/active). Rendered inside a modal dialog.
 *
 * Parent: CustomersConsole (modal)
 */

import { FormEventHandler } from "react";

import styles from "./customers-console.module.css";

type ProjectStatusValue = "prospect" | "active";

type CustomerProjectCreateFormProps = {
  customerName: string;
  projectName: string;
  onProjectNameChange: (value: string) => void;
  projectSiteAddress: string;
  onProjectSiteAddressChange: (value: string) => void;
  projectStatus: ProjectStatusValue;
  onProjectStatusChange: (value: ProjectStatusValue) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  readOnly?: boolean;
  formMessage?: string;
};

/** Project creation form scoped to a single customer, with prospect/active status selector. */
export function CustomerProjectCreateForm({
  customerName,
  projectName,
  onProjectNameChange,
  projectSiteAddress,
  onProjectSiteAddressChange,
  projectStatus,
  onProjectStatusChange,
  onSubmit,
  readOnly = false,
  formMessage,
}: CustomerProjectCreateFormProps) {
  return (
    <form className={styles.editorForm} onSubmit={onSubmit}>
      <header className={styles.panelHeader}>
        <h3 className={styles.panelTitle}>Create Project</h3>
        <p className={styles.panelSubtle}>Creating for {customerName}.</p>
      </header>

      <label className={styles.field}>
        Project name
        <input
          value={projectName}
          onChange={(event) => onProjectNameChange(event.target.value)}
        />
      </label>
      <label className={styles.field}>
        Site address
        <input
          value={projectSiteAddress}
          onChange={(event) => onProjectSiteAddressChange(event.target.value)}
        />
      </label>
      {/* Status selector — only prospect and active are valid for new projects */}

      <label className={styles.field}>
        Status
        <div className={styles.projectStatusSelector} role="group" aria-label="Project status">
          <button
            type="button"
            className={`${styles.projectStatusSelectorButton} ${
              projectStatus === "prospect"
                ? `${styles.projectStatusSelectorButtonActive} ${styles.projectStatusProspect}`
                : styles.projectStatusSelectorButtonInactive
            }`}
            aria-pressed={projectStatus === "prospect"}
            onClick={() => onProjectStatusChange("prospect")}
          >
            Prospect
          </button>
          <button
            type="button"
            className={`${styles.projectStatusSelectorButton} ${
              projectStatus === "active"
                ? `${styles.projectStatusSelectorButtonActive} ${styles.projectStatusActive}`
                : styles.projectStatusSelectorButtonInactive
            }`}
            aria-pressed={projectStatus === "active"}
            onClick={() => onProjectStatusChange("active")}
          >
            Active
          </button>
        </div>
      </label>

      {formMessage ? <p className={styles.inlineWarning}>{formMessage}</p> : null}
      <div className={styles.actionRow}>
        <button className={styles.primaryButton} type="submit" disabled={readOnly}>
          Create Project
        </button>
      </div>
    </form>
  );
}
