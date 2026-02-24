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
  const statusMessage = controllerApi.conversionMessage || controllerApi.leadMessage;
  const statusTone = controllerApi.conversionMessage
    ? controllerApi.conversionMessageTone
    : controllerApi.leadMessageTone;
  const statusLiveMode = statusTone === "error" ? "assertive" : "polite";
  const hasCustomerLink = controllerApi.lastConvertedCustomerId !== null;
  const hasProjectLink = controllerApi.lastConvertedProjectId !== null;
  const statusAnchorRef = useRef<HTMLDivElement | null>(null);
  const lastScrollKeyRef = useRef("");

  function renderStatusMessageContent() {
    if (statusTone !== "success") {
      return statusMessage;
    }

    if (hasCustomerLink && hasProjectLink) {
      return (
        <>
          <Link
            className={styles.formStatusLink}
            href={`/customers?customer=${controllerApi.lastConvertedCustomerId}`}
          >
            Customer #{controllerApi.lastConvertedCustomerId}
            {controllerApi.lastConvertedCustomerName
              ? ` (${controllerApi.lastConvertedCustomerName})`
              : ""}
          </Link>
          {" and "}
          <Link
            className={styles.formStatusLink}
            href={`/projects?project=${controllerApi.lastConvertedProjectId}`}
          >
            Project #{controllerApi.lastConvertedProjectId}
            {controllerApi.lastConvertedProjectName
              ? ` (${controllerApi.lastConvertedProjectName})`
              : ""}
          </Link>
          {" created."}
        </>
      );
    }

    if (hasCustomerLink) {
      return (
        <>
          <Link
            className={styles.formStatusLink}
            href={`/customers?customer=${controllerApi.lastConvertedCustomerId}`}
          >
            Customer #{controllerApi.lastConvertedCustomerId}
            {controllerApi.lastConvertedCustomerName
              ? ` (${controllerApi.lastConvertedCustomerName})`
              : ""}
          </Link>
          {" created."}
        </>
      );
    }

    if (hasProjectLink) {
      return (
        <>
          <Link
            className={styles.formStatusLink}
            href={`/projects?project=${controllerApi.lastConvertedProjectId}`}
          >
            Project #{controllerApi.lastConvertedProjectId}
            {controllerApi.lastConvertedProjectName
              ? ` (${controllerApi.lastConvertedProjectName})`
              : ""}
          </Link>
          {" created."}
        </>
      );
    }

    return statusMessage;
  }

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
      <div className={styles.introCard}>
        <p className={styles.introLead}>
          Capture a customer fast, then optionally create a project in the same submit.
        </p>
        <p className={styles.introMeta}>
          If duplicates are detected, resolve them inline so we avoid overlapping customer records.
        </p>
      </div>
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
          {renderStatusMessageContent()}
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
    </section>
  );
}
