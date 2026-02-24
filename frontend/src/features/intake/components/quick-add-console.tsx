"use client";

import { useEffect, useRef } from "react";
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
  const statusMessage = controllerApi.conversionMessage || controllerApi.leadMessage;
  const statusTone = controllerApi.conversionMessage
    ? controllerApi.conversionMessageTone
    : controllerApi.leadMessageTone;
  const statusLiveMode = statusTone === "error" ? "assertive" : "polite";
  const statusAnchorRef = useRef<HTMLDivElement | null>(null);
  const lastScrollKeyRef = useRef("");

  useEffect(() => {
    const duplicateCount = controllerApi.duplicateCandidates.length;
    const nextKey = `${statusMessage}|${duplicateCount}`;
    if (!statusMessage && duplicateCount === 0) {
      return;
    }
    if (nextKey === lastScrollKeyRef.current) {
      return;
    }
    lastScrollKeyRef.current = nextKey;
    statusAnchorRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [controllerApi.duplicateCandidates.length, statusMessage]);

  return (
    <section className={styles.section}>
      <h2>Intake: Quick Add</h2>
      <p>
        Use this page to quickly create a customer and optionally create a project in one step.
      </p>
      <p>
        If we detect a possible duplicate, pick how to resolve it so we do not create overlapping
        customer records.
      </p>
      <p>
        Choose <strong>Create Customer + Project</strong> for the normal flow, or{" "}
        <strong>Create Customer Only</strong> if you are just capturing customer details for now.
      </p>
      {controllerApi.authMessage ? <p>{controllerApi.authMessage}</p> : null}
      <div ref={statusAnchorRef} />
      {statusMessage ? (
        <p
          role={statusTone === "error" ? "alert" : "status"}
          aria-live={statusLiveMode}
          className={`${styles.formStatus} ${
            statusTone === "success"
              ? styles.formStatusSuccess
              : statusTone === "error"
                ? styles.formStatusError
                : styles.formStatusInfo
          }`}
        >
          {statusMessage}
        </p>
      ) : null}

      <DuplicateResolutionPanel
        duplicateCandidates={controllerApi.duplicateCandidates}
        duplicateMatchPayload={controllerApi.duplicateMatchPayload}
        duplicateResolutionIntent={controllerApi.duplicateResolutionIntent}
        selectedDuplicateId={controllerApi.selectedDuplicateId}
        onSelectDuplicateId={controllerApi.setSelectedDuplicateId}
        onResolve={controllerApi.resolveDuplicate}
      />

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

      {controllerApi.lastLead && controllerApi.lastSubmissionIntent ? (
        <div className={styles.summaryCard}>
          <p className={styles.summaryTitle}>
            {controllerApi.lastSubmissionIntent === "contact_and_project"
              ? "Customer + project created."
              : "Customer created."}
          </p>
          <p className={styles.summaryText}>
            Intake record #{controllerApi.lastLead.id}
            {controllerApi.lastConvertedCustomerId !== null ? (
              <>
                {" | "}Customer{" "}
                <Link
                  className={styles.summaryLink}
                  href={`/customers?customer=${controllerApi.lastConvertedCustomerId}`}
                >
                  #{controllerApi.lastConvertedCustomerId}
                </Link>
              </>
            ) : null}
            {controllerApi.lastConvertedProjectId !== null ? (
              <>
                {" | "}Project{" "}
                <Link
                  className={styles.summaryLink}
                  href={`/projects?project=${controllerApi.lastConvertedProjectId}`}
                >
                  #{controllerApi.lastConvertedProjectId}
                </Link>
              </>
            ) : null}
            {" | "}
            {controllerApi.lastLead.full_name}
            {controllerApi.lastSubmissionIntent === "contact_and_project" &&
            controllerApi.lastConvertedProjectId === null ? (
              <> (project creation did not complete)</>
            ) : null}
            .
          </p>
          {duplicateResolutionLabel ? (
            <p className={styles.summaryText}>Duplicate resolution: {duplicateResolutionLabel}.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
