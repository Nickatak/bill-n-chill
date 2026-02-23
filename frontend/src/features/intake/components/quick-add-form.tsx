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
      <h3>Lead Capture + Optional Project</h3>

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
        Project name (required for Create Contact + Project)
        <input
          name="project_name"
          value={projectName}
          onChange={(event) => onProjectNameChange(event.target.value)}
          placeholder="Bathroom Remodel"
        />
        {fieldErrors.project_name ? <p className={styles.errorText}>{fieldErrors.project_name}</p> : null}
      </label>

      <details className={styles.optionalDetails}>
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
            <select value={projectStatus} onChange={(event) => onProjectStatusChange(event.target.value)}>
              <option value="prospect">prospect</option>
              <option value="active">active</option>
              <option value="on_hold">on_hold</option>
              <option value="completed">completed</option>
              <option value="cancelled">cancelled</option>
            </select>
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

      <div className={styles.stickyActions}>
        <div className={styles.inlineActions}>
          <button type="submit" value="contact_only">
            Create Contact Only
          </button>
          <button type="submit" value="contact_and_project">
            Create Contact + Project
          </button>
        </div>
      </div>
    </form>
  );
}
