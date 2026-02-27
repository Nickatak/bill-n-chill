"use client";

import { FormEventHandler, RefObject } from "react";

import { LeadFieldErrors } from "../hooks/use-quick-add-controller";
import styles from "./quick-add-console.module.css";

type QuickAddFormProps = {
  fullNameRef: RefObject<HTMLInputElement | null>;
  fullName: string;
  onFullNameChange: (value: string) => void;
  phone: string;
  onPhoneChange: (value: string) => void;
  projectAddress: string;
  onProjectAddressChange: (value: string) => void;
  projectName: string;
  onProjectNameChange: (value: string) => void;
  initialContractValue: string;
  onInitialContractValueChange: (value: string) => void;
  projectStatus: string;
  onProjectStatusChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  fieldErrors: LeadFieldErrors;
  onSubmit: FormEventHandler<HTMLFormElement>;
};

export function QuickAddForm({
  fullNameRef,
  fullName,
  onFullNameChange,
  phone,
  onPhoneChange,
  projectAddress,
  onProjectAddressChange,
  projectName,
  onProjectNameChange,
  initialContractValue,
  onInitialContractValueChange,
  projectStatus,
  onProjectStatusChange,
  notes,
  onNotesChange,
  fieldErrors,
  onSubmit,
}: QuickAddFormProps) {
  // Presentational form only: renders fields and emits events; behavior stays in the controller hook.
  return (
    <form className={styles.formGrid} onSubmit={onSubmit}>
      <label className={styles.field}>
        Full name
        <input
          ref={fullNameRef}
          name="full_name"
          value={fullName}
          onChange={(event) => onFullNameChange(event.target.value)}
          autoComplete="name"
          required
        />
        {fieldErrors.full_name ? <p className={styles.errorText}>{fieldErrors.full_name}</p> : null}
      </label>

      <label className={styles.field}>
        Phone (or email)
        <input
          name="phone"
          value={phone}
          onChange={(event) => onPhoneChange(event.target.value)}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="(555) 123-4567 or name@example.com"
        />
        {fieldErrors.phone ? <p className={styles.errorText}>{fieldErrors.phone}</p> : null}
      </label>

      <label className={styles.field}>
        Project address
        <input
          name="project_address"
          value={projectAddress}
          onChange={(event) => onProjectAddressChange(event.target.value)}
          autoComplete="street-address"
          required
        />
        {fieldErrors.project_address ? (
          <p className={styles.errorText}>{fieldErrors.project_address}</p>
        ) : null}
      </label>

      <label className={styles.field}>
        Project name
        <input
          name="project_name"
          value={projectName}
          onChange={(event) => onProjectNameChange(event.target.value)}
          placeholder="Bathroom Remodel"
        />
        {fieldErrors.project_name ? <p className={styles.errorText}>{fieldErrors.project_name}</p> : null}
      </label>

      <details className={`${styles.optionalDetails} ${styles.fullRow}`}>
        <summary>Optional details</summary>
        <div className={styles.optionalBody}>
          <label className={styles.field}>
            Initial contract value
            <input
              name="initial_contract_value"
              value={initialContractValue}
              onChange={(event) => onInitialContractValueChange(event.target.value)}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="25000.00"
            />
          </label>
          <label className={styles.field}>
            Project status
            <div className={styles.projectStatusPills} role="group" aria-label="Project status">
              <button
                type="button"
                className={`${styles.projectStatusPill} ${
                  projectStatus === "prospect"
                    ? `${styles.projectStatusPillActive} ${styles.projectStatusProspect}`
                    : styles.projectStatusPillInactive
                }`}
                aria-pressed={projectStatus === "prospect"}
                onClick={() => onProjectStatusChange("prospect")}
              >
                Prospect
              </button>
              <button
                type="button"
                className={`${styles.projectStatusPill} ${
                  projectStatus === "active"
                    ? `${styles.projectStatusPillActive} ${styles.projectStatusActive}`
                    : styles.projectStatusPillInactive
                }`}
                aria-pressed={projectStatus === "active"}
                onClick={() => onProjectStatusChange("active")}
              >
                Active
              </button>
            </div>
          </label>
          <label className={styles.field}>
            Notes
            <textarea
              name="notes"
              rows={3}
              value={notes}
              onChange={(event) => onNotesChange(event.target.value)}
            />
          </label>
        </div>
      </details>

      <div className={`${styles.stickyActions} ${styles.fullRow}`}>
        <div className={styles.inlineActions}>
          <button className={styles.actionPrimary} type="submit" value="customer_and_project">
            Save Customer + Start Project
          </button>
          <button className={styles.actionSecondary} type="submit" value="customer_only">
            Save Customer Only
          </button>
        </div>
      </div>
    </form>
  );
}
