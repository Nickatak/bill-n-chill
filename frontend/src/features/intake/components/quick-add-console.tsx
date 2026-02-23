"use client";

import Link from "next/link";

import { useSharedSessionAuth } from "../../session/use-shared-session";
import { DuplicateResolutionPanel } from "./duplicate-resolution-panel";
import { QuickAddForm } from "./quick-add-form";
import { useQuickAddController } from "../hooks/use-quick-add-controller";
import styles from "./quick-add-console.module.css";

export function QuickAddConsole() {
  // Composition owner: bridges shared-session auth into the controller before child workflows run.
  const { token, authMessage: baseAuthMessage } = useSharedSessionAuth();
  const controllerApi = useQuickAddController({ token, baseAuthMessage });
  const duplicateResolutionLabel =
    controllerApi.lastDuplicateResolution === "none"
      ? ""
      : controllerApi.lastDuplicateResolution.replaceAll("_", " ");

  return (
    <section className={styles.section}>
      <h2>Intake: Quick Add</h2>
      <p>
        This route gives field and office users a fast way to capture a qualified lead with
        duplicate detection and explicit resolution before bad data spreads.
      </p>
      <p>
        It is the workflow entry point: successful conversion here creates the Customer + Project
        shell used by every downstream route in the financial loop.
      </p>
      <p>Use one form for both capture-only and capture-with-project actions.</p>
      {controllerApi.authMessage ? <p>{controllerApi.authMessage}</p> : null}

      <QuickAddForm
        fullNameRef={controllerApi.fullNameRef}
        fullName={controllerApi.fullName}
        onFullNameChange={controllerApi.setFullName}
        phone={controllerApi.phone}
        onPhoneChange={controllerApi.setPhone}
        projectAddress={controllerApi.projectAddress}
        onProjectAddressChange={controllerApi.setProjectAddress}
        projectName={controllerApi.projectName}
        onProjectNameChange={controllerApi.setProjectName}
        initialContractValue={controllerApi.initialContractValue}
        onInitialContractValueChange={controllerApi.setInitialContractValue}
        projectStatus={controllerApi.projectStatus}
        onProjectStatusChange={controllerApi.setProjectStatus}
        notes={controllerApi.notes}
        onNotesChange={controllerApi.setNotes}
        fieldErrors={controllerApi.fieldErrors}
        onSubmit={controllerApi.handleQuickAdd}
      />

      <DuplicateResolutionPanel
        duplicateCandidates={controllerApi.duplicateCandidates}
        selectedDuplicateId={controllerApi.selectedDuplicateId}
        onSelectDuplicateId={controllerApi.setSelectedDuplicateId}
        onResolve={controllerApi.resolveDuplicate}
      />

      {controllerApi.leadMessage ? <p>{controllerApi.leadMessage}</p> : null}

      {controllerApi.lastLead && controllerApi.lastSubmissionIntent ? (
        <div className={styles.summaryCard}>
          <p className={styles.summaryTitle}>
            {controllerApi.lastSubmissionIntent === "contact_and_project"
              ? "Contact + project created."
              : "Contact created."}
          </p>
          <p className={styles.summaryText}>
            Lead{" "}
            <Link className={styles.summaryLink} href={`/contacts?contact=${controllerApi.lastLead.id}`}>
              #{controllerApi.lastLead.id}
            </Link>{" "}
            ({controllerApi.lastLead.full_name})
            {controllerApi.lastSubmissionIntent === "contact_and_project" &&
            controllerApi.lastConvertedCustomerId !== null &&
            controllerApi.lastConvertedProjectId !== null ? (
              <>
                , Customer{" "}
                <Link
                  className={styles.summaryLink}
                  href={`/contacts?customer=${controllerApi.lastConvertedCustomerId}`}
                >
                  #{controllerApi.lastConvertedCustomerId}
                </Link>
                , Project{" "}
                <Link
                  className={styles.summaryLink}
                  href={`/projects?project=${controllerApi.lastConvertedProjectId}`}
                >
                  #{controllerApi.lastConvertedProjectId}
                </Link>
              </>
            ) : null}
            .
          </p>
          {duplicateResolutionLabel ? (
            <p className={styles.summaryText}>Duplicate resolution: {duplicateResolutionLabel}.</p>
          ) : null}
        </div>
      ) : null}

      {controllerApi.conversionMessage ? <p>{controllerApi.conversionMessage}</p> : null}
    </section>
  );
}
